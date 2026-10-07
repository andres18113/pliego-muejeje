import { MaterialSymbol } from "@/shared/ui/MaterialSymbol";
import { useEffect, useId, useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { Button, ButtonLink } from "@/components/ui/button";
import { useSession } from "@/app/session";
import { useSessionOperationScope, type SessionOperationScope } from "@/app/sessionOperation";
import { BookCover } from "@/features/catalog/BookCover";
import { resolveStockStatus } from "@/features/catalog/stockStatusModel";
import { StockStatus } from "@/features/catalog/StockStatus";
import surface from "@/features/catalog/availabilitySurface.module.css";
import { formatEdition, formatUsd } from "@/features/catalog/formatters";
import { addEditionToCart, removeCartItem, updateCartItemQuantity, type CartLine } from "@/shared/api/cart";
import { ApiRequestError, fieldErrorMessages, readRecoveryDetail } from "@/shared/api/errors";
import { addCustomerFavorite } from "@/shared/api/favorites";
import { QuantityPicker } from "@/shared/ui/QuantityPicker";
import { UndoToast, type UndoToastMessage } from "@/shared/ui/UndoToast";
import { SavedForLater } from "./SavedForLater";
import { cartQuantityChoices, useCustomerCart } from "./cartQuery";
import { hasSaving, toCartPricingViewModel, type CartLinePricingViewModel } from "./cartPricingViewModel";
import { CustomerOnly, PurchasePage } from "./PurchaseChrome";
import { ivaLabel, unitsLabel } from "./purchaseText";
import { PurchaseFlow, PurchaseLayout, PurchaseSummary } from "./PurchaseFlow";
import classes from "./purchaseFlow.module.css";
import cart from "./cart.module.css";

type LineFeedback = { cartItemId: string; tone: "success" | "error"; message: string };
type CartCommand =
  | { kind: "quantity"; line: CartLine; quantity: number }
  | { kind: "remove"; line: CartLine }
  /** "Guardar para después" is PLIEGO's Favoritos: the edition is saved there, then leaves the cart. */
  | { kind: "save"; line: CartLine };
type Departed = { editionId: string; title: string; quantity: number };
type CartToast = Omit<UndoToastMessage, "action"> & { departed?: Departed; unknownOutcome?: boolean };


export function CartPage() {
  return (
    <PurchasePage title="Tu carrito">
      <CustomerOnly intent="/cart" task="ver tu carrito">
        <CartContent />
      </CustomerOnly>
    </PurchasePage>
  );
}

function CartContent() {
  const scope = useSessionOperationScope("cart");
  const { clear: clearSession } = useSession();
  const queryClient = useQueryClient();
  const cartQuery = useCustomerCart(true);
  const commandLock = useRef(false);
  const toastKey = useRef(0);
  const [lineFeedback, setLineFeedback] = useState<LineFeedback | null>(null);
  const [toast, setToast] = useState<CartToast | null>(null);
  /** Quantities of lines saved for later during this visit, so moving one back restores the same line. */
  const [savedQuantities, setSavedQuantities] = useState<ReadonlyMap<string, number>>(() => new Map());

  const command = useMutation({
    meta: { authRequired: true },
    mutationFn: async (next: CartCommand & {scope:SessionOperationScope}) => {
      next.scope.assertCurrent();
      if (next.kind === "quantity") { await updateCartItemQuantity(next.line.cartItemId, next.quantity); return; }
      if (next.kind === "save") {
        await addCustomerFavorite(next.line.editionId);
        next.scope.assertCurrent();
        void queryClient.invalidateQueries({ queryKey: ["customer-favorites"] });
        void queryClient.invalidateQueries({ queryKey: ["customer-favorite-status"] });
      }
      await removeCartItem(next.line.cartItemId);
    },
    retry: false,
    onSuccess: async (_, next) => {
      if (!next.scope.isCurrent()) return;
      const index = cartQuery.data?.items.findIndex((item) => item.cartItemId === next.line.cartItemId) ?? 0;
      await cartQuery.refetch();
      if (!next.scope.isCurrent()) return;
      if (next.kind === "quantity") {
        setLineFeedback({
          cartItemId: next.line.cartItemId,
          tone: "success",
          message: `Cantidad actualizada: ${unitsLabel(next.quantity)}.`,
        });
        return;
      }
      setLineFeedback(null);
      if (next.kind === "save") setSavedQuantities((current) => new Map(current).set(next.line.editionId, next.line.quantity));
      setToast({
        key: ++toastKey.current,
        message: next.kind === "save" ? "Guardado en Favoritos" : "Quitado del carrito",
        detail: next.line.title,
        departed: { editionId: next.line.editionId, title: next.line.title, quantity: next.line.quantity },
      });
      focusAfterDeparture(index);
    },
    onError: async (error: Error, next) => {
      if (!next.scope.isCurrent()) return;
      if (error instanceof ApiRequestError && error.status === 401) {
        clearSession("expired");
        return;
      }
      const code = error instanceof ApiRequestError ? error.code : undefined;
      const index = cartQuery.data?.items.findIndex((item) => item.cartItemId === next.line.cartItemId) ?? 0;
      const refreshed = await cartQuery.refetch();
      if (!next.scope.isCurrent()) return;
      if (code === "P4003" || code === "P4001") {
        setToast({ key: ++toastKey.current, message: "Ese artículo ya no estaba en tu carrito. Mostramos el carrito actual." });
        focusAfterDeparture(index);
        return;
      }
      const stillInCart = refreshed.data?.items.some((item) => item.cartItemId === next.line.cartItemId);
      const message = fieldErrorMessages(error,"quantity") ?? (code === "P3002"
        ? `No hay existencias suficientes para ${next.kind === "quantity" ? unitsLabel(next.quantity) : "esta cantidad"}. La cantidad no cambió.`
        : code === "P2042" || code === "P2043"
        ? "Esta edición ya no está a la venta. Puedes quitarla del carrito."
        : next.kind === "save" && error instanceof ApiRequestError && error.status < 500
        ? `${error.title}. Sigue en tu carrito.`
        : error instanceof ApiRequestError && error.status < 500
        ? `${error.title}. ${error.detail}`
        : "No pudimos confirmar el cambio. Mostramos el estado actual del carrito; revísalo antes de intentarlo otra vez.");
      if (stillInCart === false) setToast({ key: ++toastKey.current, message });
      else setLineFeedback({ cartItemId: next.line.cartItemId, tone: "error", message });
    },
    onSettled: () => {
      commandLock.current = false;
    },
  });

  /** Undo for "Quitar" and "Guardar para después": the same edition and quantity go back through the cart API. */
  const restore = useMutation({
    meta: { authRequired: true },
    mutationFn: (departed: Departed & {scope:SessionOperationScope}) => { departed.scope.assertCurrent(); return addEditionToCart(departed.editionId, departed.quantity); },
    retry: false,
    onSuccess: async (added, departed) => {
      if (!departed.scope.isCurrent()) return;
      setSavedQuantities((current) => { const next = new Map(current); next.delete(departed.editionId); return next; });
      await cartQuery.refetch();
      if (!departed.scope.isCurrent()) return;
      setToast({ key: ++toastKey.current, message: "Devuelto al carrito", detail: departed.title });
      window.requestAnimationFrame(() => { if (departed.scope.isCurrent()) document.getElementById(`cart-line-link-${added.cartItemId}`)?.focus(); });
    },
    onError: async (error: Error, departed) => {
      if (!departed.scope.isCurrent()) return;
      if (error instanceof ApiRequestError && error.status === 401) { clearSession("expired"); return; }
      await cartQuery.refetch();
      if (!departed.scope.isCurrent()) return;
      const definitive = error instanceof ApiRequestError && error.status < 500;
      setToast({
        key: ++toastKey.current,
        message: definitive ? "Ya no se puede devolver al carrito" : "No pudimos confirmar el cambio. Consulta el carrito antes de volver a añadirlo.",
        detail: departed.title,
        ...(definitive ? {} : { departed, unknownOutcome: true }),
      });
    },
  });

  // A lost additive POST can already have committed. Recovery only reads its outcome.
  const reconcileRestore = useMutation({
    meta: { authRequired: true },
    mutationFn: async (issued:SessionOperationScope) => {
      issued.assertCurrent();
      const refreshed = await cartQuery.refetch();
      issued.assertCurrent();
      if (refreshed.isError) throw refreshed.error;
      return refreshed.data;
    },
    retry: false,
    onSuccess: (current, issued) => {
      if (!issued.isCurrent()) return;
      setToast(previous => !previous?.departed || current?.items.some(item => item.editionId === previous.departed?.editionId)
        ? null : { key: ++toastKey.current, message: "El artículo no aparece en el carrito. Revisa el catálogo para volver a añadirlo." });
    },
  });

  /** A saved line went back to the cart from the saved list: forget its quantity and withdraw a stale undo. */
  function restoredFromSaved(editionId: string) {
    setSavedQuantities((current) => { const next = new Map(current); next.delete(editionId); return next; });
    setToast((current) => current?.departed?.editionId === editionId ? null : current);
  }

  function run(next: CartCommand) {
    if (commandLock.current || restore.isPending) return;
    commandLock.current = true;
    setToast(null);
    setLineFeedback(null);
    command.mutate({...next,scope});
  }

  /** The line's controls leave the DOM: keep keyboard users in the cart, on the line that took its place. */
  function focusAfterDeparture(index: number) {
    window.requestAnimationFrame(() => {
      if (!scope.isCurrent()) return;
      const links = document.querySelectorAll<HTMLElement>("[data-cart-line] h2 a");
      (links[Math.min(index, links.length - 1)] ?? document.getElementById("cart-empty-heading"))?.focus();
    });
  }

  const data = cartQuery.data;
  // The server's pricing, worded for display: no sums, discounts or tax are worked out here.
  const pricing = data ? toCartPricingViewModel(data) : undefined;
  const summarySaving = pricing?.summary.savingsTotal && hasSaving(pricing.summary.savingsTotal.rawValue) ? pricing.summary.savingsTotal : null;
  const busyLineId = command.isPending ? command.variables?.line.cartItemId : undefined;
  const blocked = Boolean(data?.items.some((line) => !resolveStockStatus(line).canAddToCart));
  // An undo for an edition that is already back in the cart (by any route) would add it a second time.
  const departedBack = Boolean(toast?.departed && data?.items.some((line) => line.editionId === toast.departed?.editionId));
  useEffect(() => { if (departedBack) setToast(null); }, [departedBack]);

  return (
    <PurchaseFlow stage="cart">
      {cartQuery.isPending ? (
        <p className={classes.status} role="status">Consultando tu carrito…</p>
      ) : cartQuery.isError && !data ? (
        <ReadFailure error={cartQuery.error} onRetry={() => void cartQuery.refetch()} retrying={cartQuery.isFetching} />
      ) : data && data.items.length === 0 ? (
        <>
          <section className={classes.empty} aria-labelledby="cart-empty-heading">
            <MaterialSymbol name="shopping_cart" size={34} />
            <h1 id="cart-empty-heading" tabIndex={-1}>Tu carrito está vacío.</h1>
            <p>Explora el catálogo para encontrar tu próxima lectura.</p>
            <ButtonLink variant="primary" to="/catalog">Ir al catálogo</ButtonLink>
          </section>
          <div className={cart.savedAlone}><SavedForLater savedQuantities={savedQuantities} onRestored={restoredFromSaved} /></div>
        </>
      ) : data ? (
        <>
          <h1 className="visually-hidden">Tu carrito</h1>
          <Link className={cart.back} to="/catalog">
            <MaterialSymbol name="home" aria-hidden="true" size={22} /><span>Seguir comprando</span>
          </Link>
          <PurchaseLayout summary={
            <PurchaseSummary
              headingId="cart-summary-heading"
              title="Resumen del pedido"
              totals={[
                // With offers: the subtotal before them and the server's total saving; without, the plain subtotal.
                ...(summarySaving && pricing?.summary.originalSubtotal
                  ? [{ label: "Subtotal", value: pricing.summary.originalSubtotal.formattedValue },
                    { label: "Ahorro total hoy", value: `-${summarySaving.formattedValue}`, tone: "savings" as const }]
                  : data.subtotal ? [{ label: "Subtotal", value: formatUsd(data.subtotal) }] : []),
                ...(data.taxAmount ? [{ label: ivaLabel(data.taxRate), value: formatUsd(data.taxAmount) }] : []),
                ...(data.shippingAmount ? [{ label: "Envío", value: formatUsd(data.shippingAmount) }] : []),
                { label: "Total", value: formatUsd(data.total ?? data.totalCurrent), total: true },
              ]}
            >
              {blocked ? (
                <p className={classes.blocker} role="status">
                  Ajusta o quita los libros no disponibles para continuar con la compra.
                </p>
              ) : (
                <ButtonLink variant="primary" to="/checkout">Continuar con la compra</ButtonLink>
              )}
            </PurchaseSummary>
          }>
            <section className={cart.items} aria-labelledby="cart-lines-heading">
              <h2 id="cart-lines-heading" className="visually-hidden">Libros en tu carrito</h2>
              {cartQuery.isError && (
                <p className={classes.notice} data-tone="error" role="alert">
                  No pudimos actualizar el carrito. Lo que ves puede estar desactualizado.{" "}
                  <Button variant="text" type="button" onClick={() => void cartQuery.refetch()}>Volver a consultar</Button>
                </p>
              )}
              <ul className={cart.list}>
                {data.items.map((line) => (
                  <li key={line.cartItemId}>
                    <CartLineItem
                      line={line}
                      pricing={pricing?.lines.find((linePricing) => linePricing.cartItemId === line.cartItemId)}
                      busy={busyLineId === line.cartItemId}
                      locked={command.isPending || restore.isPending}
                      feedback={lineFeedback?.cartItemId === line.cartItemId ? lineFeedback : null}
                      onQuantity={(quantity) => run({ kind: "quantity", line, quantity })}
                      onSave={() => run({ kind: "save", line })}
                      onRemove={() => run({ kind: "remove", line })}
                    />
                  </li>
                ))}
              </ul>
              <SavedForLater savedQuantities={savedQuantities} onRestored={restoredFromSaved} />
            </section>
          </PurchaseLayout>
        </>
      ) : null}
      <UndoToast onDismiss={() => setToast(null)} toast={toast && {
        key: toast.key,
        message: toast.message,
        detail: toast.detail,
        action: toast.departed ? {
          label: toast.unknownOutcome ? "Consultar carrito" : "Deshacer",
          busyLabel: toast.unknownOutcome ? "Consultando…" : "Devolviendo…",
          busy: restore.isPending || reconcileRestore.isPending,
          onPress: () => {
            if (command.isPending || restore.isPending || reconcileRestore.isPending) return;
            if (toast.unknownOutcome) reconcileRestore.mutate(scope);
            else restore.mutate({...toast.departed!,scope});
          },
        } : undefined,
      }} />
    </PurchaseFlow>
  );
}

/** One purchase unit: the book, what it costs at this quantity, its availability and its own actions. */
function CartLineItem({ line, pricing, busy, locked, feedback, onQuantity, onSave, onRemove }: {
  line: CartLine;
  pricing?: CartLinePricingViewModel;
  busy: boolean;
  locked: boolean;
  feedback: LineFeedback | null;
  onQuantity: (quantity: number) => void;
  onSave: () => void;
  onRemove: () => void;
}) {
  const stock = resolveStockStatus(line);
  const stockId = `cart-line-stock-${line.cartItemId}`;
  const statusId = `cart-line-status-${line.cartItemId}`;
  const choices = cartQuantityChoices(line);
  // The server's own line saving (already for this quantity); shown only when there is one.
  const saving = pricing?.lineSavings && hasSaving(pricing.lineSavings.rawValue) ? pricing.lineSavings : null;

  return (
    <article className={cart.item} data-cart-line data-unavailable={stock.canAddToCart ? undefined : ""} aria-busy={busy}>
      <Link className={cart.cover} to={`/catalog/editions/${line.editionId}`} tabIndex={-1} aria-hidden="true">
        <BookCover url={line.coverUrl} license={null} attribution={null} title={line.title} size="compact" />
      </Link>
      <div className={cart.identity} data-purchase="line-copy">
        <h2><Link id={`cart-line-link-${line.cartItemId}`} aria-describedby={stock.canAddToCart ? undefined : stockId} to={`/catalog/editions/${line.editionId}`}>{line.title}</Link></h2>
        {line.authors && <p className={cart.authors}>{line.authors}</p>}
        {line.format && <p>{formatEdition(line.format)}</p>}
      </div>
      {/* Quantity beside what it costs; the amount drops below when the line is too narrow for both. */}
      <div className={cart.buy}>
        <div className={cart.quantity}>
          {stock.canChangeQuantity && line.quantityEditable ? (
            <QuantityPicker
              label={`Cantidad de ${line.title}`}
              describedBy={stock.canAddToCart ? statusId : `${stockId} ${statusId}`}
              value={line.quantity}
              choices={choices}
              busy={locked}
              onChange={onQuantity}
              appearance="quiet"
            />
          ) : (
            // Read like the picker beside it ("Cant. 1"); assistive technology hears the full word.
            <p className={cart.quantityStatic}>
              <span className="visually-hidden">Cantidad: {line.quantity}</span>
              <span aria-hidden="true"><span className={cart.quantityCaption}>Cant.</span> <span className={cart.quantityValue}>{line.quantity}</span></span>
            </p>
          )}
        </div>
        <div className={cart.amount}>
          <p className={cart.price}>
            <span className={cart.subtotal}><span className="visually-hidden">Subtotal: </span>{formatUsd(line.currentSubtotal)}</span>
            {saving && pricing?.originalSubtotal && <s className={cart.was}><span className="visually-hidden">Precio anterior: </span>{pricing.originalSubtotal.formattedValue}</s>}
          </p>
        </div>
      </div>
      {/* Being in the cart already says the book can be bought: only a problem is worth a line. */}
      {!stock.canAddToCart && <div className={cart.problem}>
        <StockStatus available={line.available} unavailabilityReason={line.unavailabilityReason} id={stockId} className={surface.status} />
      </div>}
      <div className={cart.actions}>
        <Button variant="text" type="button" aria-label={`Guardar ${line.title} para después`} aria-disabled={locked || undefined} onClick={() => !locked && onSave()}>
          Guardar para después
        </Button>
        <Button variant="text" type="button" aria-label={`Quitar ${line.title} del carrito`} aria-disabled={locked || undefined} onClick={() => !locked && onRemove()}>
          Quitar
        </Button>
      </div>
      {saving && <p className={cart.saving} data-cart-saving><MaterialSymbol name="sell" size={20} aria-hidden="true" /><span>Ahorras {saving.formattedValue} en este artículo</span></p>}
      <p id={statusId} className={cart.feedback} data-tone={feedback?.tone}>
        {(busy || feedback) && <span role={feedback?.tone === "error" ? "alert" : "status"}>
          {feedback?.message ?? (busy ? "Actualizando el carrito…" : "")}
        </span>}
      </p>
    </article>
  );
}

export function ReadFailure({ onRetry, retrying, error, title = "No pudimos consultar tu carrito." }: {
  onRetry: () => void;
  retrying: boolean;
  title?: string;
  error?: unknown;
}) {
  const headingId = useId();
  const status = error instanceof ApiRequestError ? error.status : undefined;
  const detail = readRecoveryDetail(error);
  return (
    <section className="purchase-error" role="alert" aria-labelledby={headingId}>
      <h2 id={headingId}>{title}</h2>
      <p>{detail}</p>
      {status === 403 || status === 404 ? <ButtonLink variant="secondary" to="/catalog">Volver al catálogo</ButtonLink> : <Button variant="secondary" type="button" onClick={() => { if (!retrying) onRetry(); }} aria-disabled={retrying || undefined}>
        {retrying ? "Consultando…" : "Volver a intentar"}
      </Button>}
    </section>
  );
}
