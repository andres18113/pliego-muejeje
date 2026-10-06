import { MaterialSymbol } from "@/shared/ui/MaterialSymbol";
import { useId, useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { Button, ButtonLink } from "@/components/ui/button";
import { useSession } from "@/app/session";
import { BookCover } from "@/features/catalog/BookCover";
import { resolveStockStatus } from "@/features/catalog/stockStatusModel";
import { StockStatus } from "@/features/catalog/StockStatus";
import surface from "@/features/catalog/availabilitySurface.module.css";
import { formatEdition, formatUsd } from "@/features/catalog/formatters";
import { addEditionToCart, removeCartItem, updateCartItemQuantity, type CartLine } from "@/shared/api/cart";
import { ApiRequestError, fieldErrorMessages } from "@/shared/api/errors";
import { addCustomerFavorite } from "@/shared/api/favorites";
import { QuantityPicker } from "@/shared/ui/QuantityPicker";
import { UndoToast, type UndoToastMessage } from "@/shared/ui/UndoToast";
import { SavedForLater } from "./SavedForLater";
import { cartQuantityChoices, useCustomerCart } from "./cartQuery";
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
type CartToast = Omit<UndoToastMessage, "action"> & { departed?: Departed; retry?: boolean };


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
  const { clear: clearSession } = useSession();
  const queryClient = useQueryClient();
  const cartQuery = useCustomerCart(true);
  const commandLock = useRef(false);
  const toastKey = useRef(0);
  const [lineFeedback, setLineFeedback] = useState<LineFeedback | null>(null);
  const [toast, setToast] = useState<CartToast | null>(null);

  const command = useMutation({
    mutationFn: async (next: CartCommand) => {
      if (next.kind === "quantity") { await updateCartItemQuantity(next.line.cartItemId, next.quantity); return; }
      if (next.kind === "save") {
        await addCustomerFavorite(next.line.editionId);
        void queryClient.invalidateQueries({ queryKey: ["customer-favorites"] });
        void queryClient.invalidateQueries({ queryKey: ["customer-favorite-status"] });
      }
      await removeCartItem(next.line.cartItemId);
    },
    retry: false,
    onSuccess: async (_, next) => {
      const index = cartQuery.data?.items.findIndex((item) => item.cartItemId === next.line.cartItemId) ?? 0;
      await cartQuery.refetch();
      if (next.kind === "quantity") {
        setLineFeedback({
          cartItemId: next.line.cartItemId,
          tone: "success",
          message: `Cantidad actualizada: ${unitsLabel(next.quantity)}.`,
        });
        return;
      }
      setLineFeedback(null);
      setToast({
        key: ++toastKey.current,
        message: next.kind === "save" ? "Guardado en Favoritos" : "Quitado del carrito",
        detail: next.line.title,
        departed: { editionId: next.line.editionId, title: next.line.title, quantity: next.line.quantity },
      });
      focusAfterDeparture(index);
    },
    onError: async (error: Error, next) => {
      if (error instanceof ApiRequestError && error.status === 401) {
        clearSession("expired");
        return;
      }
      const code = error instanceof ApiRequestError ? error.code : undefined;
      const index = cartQuery.data?.items.findIndex((item) => item.cartItemId === next.line.cartItemId) ?? 0;
      const refreshed = await cartQuery.refetch();
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
    mutationFn: (departed: Departed) => addEditionToCart(departed.editionId, departed.quantity),
    retry: false,
    onSuccess: async (added, departed) => {
      await cartQuery.refetch();
      setToast({ key: ++toastKey.current, message: "Devuelto al carrito", detail: departed.title });
      window.requestAnimationFrame(() => document.getElementById(`cart-line-link-${added.cartItemId}`)?.focus());
    },
    onError: async (error: Error, departed) => {
      if (error instanceof ApiRequestError && error.status === 401) { clearSession("expired"); return; }
      await cartQuery.refetch();
      const definitive = error instanceof ApiRequestError && error.status < 500;
      setToast({
        key: ++toastKey.current,
        message: definitive ? "Ya no se puede devolver al carrito" : "No pudimos devolverlo al carrito",
        detail: departed.title,
        ...(definitive ? {} : { departed, retry: true }),
      });
    },
  });

  function run(next: CartCommand) {
    if (commandLock.current || restore.isPending) return;
    commandLock.current = true;
    setToast(null);
    setLineFeedback(null);
    command.mutate(next);
  }

  /** The line's controls leave the DOM: keep keyboard users in the cart, on the line that took its place. */
  function focusAfterDeparture(index: number) {
    window.requestAnimationFrame(() => {
      const links = document.querySelectorAll<HTMLElement>("[data-cart-line] h2 a");
      (links[Math.min(index, links.length - 1)] ?? document.getElementById("cart-empty-heading"))?.focus();
    });
  }

  const data = cartQuery.data;
  const busyLineId = command.isPending ? command.variables?.line.cartItemId : undefined;
  const blocked = Boolean(data?.items.some((line) => !resolveStockStatus(line).canAddToCart));

  return (
    <PurchaseFlow stage="cart">
      {cartQuery.isPending ? (
        <p className={classes.status} role="status">Consultando tu carrito…</p>
      ) : cartQuery.isError && !data ? (
        <ReadFailure onRetry={() => void cartQuery.refetch()} retrying={cartQuery.isFetching} />
      ) : data && data.items.length === 0 ? (
        <>
          <section className={classes.empty} aria-labelledby="cart-empty-heading">
            <MaterialSymbol name="shopping_cart" size={34} />
            <h1 id="cart-empty-heading" tabIndex={-1}>Tu carrito está vacío.</h1>
            <p>Explora el catálogo para encontrar tu próxima lectura.</p>
            <ButtonLink variant="primary" to="/catalog">Ir al catálogo</ButtonLink>
          </section>
          <div className={cart.savedAlone}><SavedForLater /></div>
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
                ...(data.subtotal ? [{ label: "Subtotal", value: formatUsd(data.subtotal) }] : []),
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
              <SavedForLater />
            </section>
          </PurchaseLayout>
        </>
      ) : null}
      <UndoToast onDismiss={() => setToast(null)} toast={toast && {
        key: toast.key,
        message: toast.message,
        detail: toast.detail,
        action: toast.departed ? {
          label: toast.retry ? "Reintentar" : "Deshacer",
          busyLabel: "Devolviendo…",
          busy: restore.isPending,
          onPress: () => { if (!command.isPending) restore.mutate(toast.departed!); },
        } : undefined,
      }} />
    </PurchaseFlow>
  );
}

/** One purchase unit: the book, what it costs at this quantity, its availability and its own actions. */
function CartLineItem({ line, busy, locked, feedback, onQuantity, onSave, onRemove }: {
  line: CartLine;
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
            />
          ) : (
            <p className={cart.quantityStatic}>Cantidad: {line.quantity}</p>
          )}
        </div>
        <div className={cart.amount}>
          <p className={cart.subtotal}><span className="visually-hidden">Subtotal: </span>{formatUsd(line.currentSubtotal)}</p>
          <p className={cart.unit}>{formatUsd(line.currentPrice)} por unidad</p>
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
      <p id={statusId} className={cart.feedback} data-tone={feedback?.tone}>
        {(busy || feedback) && <span role={feedback?.tone === "error" ? "alert" : "status"}>
          {feedback?.message ?? (busy ? "Actualizando el carrito…" : "")}
        </span>}
      </p>
    </article>
  );
}

export function ReadFailure({ onRetry, retrying, title = "No pudimos consultar tu carrito." }: {
  onRetry: () => void;
  retrying: boolean;
  title?: string;
}) {
  const headingId = useId();
  return (
    <section className="purchase-error" role="alert" aria-labelledby={headingId}>
      <h2 id={headingId}>{title}</h2>
      <p>Comprueba tu conexión e inténtalo otra vez.</p>
      <Button variant="secondary" type="button" onClick={onRetry} aria-disabled={retrying || undefined}>
        {retrying ? "Consultando…" : "Volver a intentar"}
      </Button>
    </section>
  );
}
