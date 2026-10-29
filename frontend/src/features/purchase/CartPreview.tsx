import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useMutation } from "@tanstack/react-query";
import { Link, useLocation } from "react-router-dom";
import { Drawer } from "@mantine/core";
import { useMediaQuery, useReducedMotion } from "@mantine/hooks";
import { Button } from "@/components/ui/button";
import { useSession } from "@/app/session";
import { useSessionOperationScope, type SessionOperationScope } from "@/app/sessionOperation";
import { BookCover } from "@/features/catalog/BookCover";
import { useBlockedDigitalEligibility } from "@/features/library/digitalEligibilityQuery";
import type { DigitalEligibility } from "@/shared/api/digitalEligibility";
import { DigitalConflictLink } from "@/features/library/DigitalConflictLink";
import { StockStatus } from "@/features/catalog/StockStatus";
import { resolveStockStatus } from "@/features/catalog/stockStatusModel";
import { formatEdition, formatUsd } from "@/features/catalog/formatters";
import { removeCartItem, updateCartItemQuantity, type CartLine } from "@/shared/api/cart";
import { ApiRequestError, fieldErrorMessages } from "@/shared/api/errors";
import { ConfirmDialog } from "@/shared/ui/ConfirmDialog";
import { MaterialSymbol } from "@/shared/ui/MaterialSymbol";
import { QuantityPicker } from "@/shared/ui/QuantityPicker";
import { cartQuantityChoices, isSingleDigitalCopy, useCustomerCart } from "./cartQuery";
import { DigitalCopyNote } from "./DigitalCopyNote";
import { hasSaving, toCartPricingViewModel, type CartLinePricingViewModel } from "./cartPricingViewModel";
import { ivaLabel, unitsLabel } from "./purchaseText";
import classes from "./cartPreview.module.css";

type CartPreview = { open: (editionId: string) => void };
const CartPreviewContext = createContext<CartPreview | null>(null);

/** Opens the cart preview after a confirmed add. Null outside the storefront layout: callers simply stay put. */
export function useCartPreview() {
  return useContext(CartPreviewContext);
}

/**
 * PLIEGO's one add-to-cart answer: the shopper stays on the shelf and the cart comes in from the right,
 * showing the server's cart (lines, quantities, totals) — never a client-side copy of it. A later add
 * reopens the same drawer on the newly added edition; leaving the page closes it.
 */
export function CartPreviewProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<{ opened: boolean; editionId: string | null }>({ opened: false, editionId: null });
  const { pathname } = useLocation();
  const close = useCallback(() => setState((current) => ({ ...current, opened: false })), []);
  useEffect(close, [pathname, close]);
  const value = useMemo<CartPreview>(() => ({ open: (editionId) => setState({ opened: true, editionId }) }), []);

  return <CartPreviewContext.Provider value={value}>
    {children}
    <CartPreviewDrawer opened={state.opened} addedEditionId={state.editionId} onClose={close} />
  </CartPreviewContext.Provider>;
}

function CartPreviewDrawer({ opened, addedEditionId, onClose }: { opened: boolean; addedEditionId: string | null; onClose: () => void }) {
  const phone = useMediaQuery("(max-width: 599px)");
  const reduceMotion = useReducedMotion();
  // While "¿Quitar del carrito?" is open, Escape answers the question only; the drawer stays.
  const [confirming, setConfirming] = useState(false);
  return <Drawer opened={opened} onClose={onClose} closeOnEscape={!confirming} title="Tu carrito" position="right" size={phone ? "100%" : 420}
    closeButtonProps={{ "aria-label": "Cerrar carrito", size: 44 }}
    transitionProps={{ duration: reduceMotion ? 0 : 280, timingFunction: "cubic-bezier(.32, .94, .6, 1)" }}
    overlayProps={{ backgroundOpacity: 0.28, color: "#252740" }}
    classNames={{ content: `${classes.drawer} storefront-panel`, header: classes.header, title: classes.title, body: classes.body }}>
    {opened && <CartPreviewContent addedEditionId={addedEditionId} onConfirmingChange={setConfirming} />}
  </Drawer>;
}

function CartPreviewContent({ addedEditionId, onConfirmingChange }: { addedEditionId: string | null; onConfirmingChange: (confirming: boolean) => void }) {
  const { clear: clearSession } = useSession();
  const scope = useSessionOperationScope("cart");
  // The add already re-read the cart; this read only refreshes when that copy is old.
  const cartQuery = useCustomerCart(true, { fresh: false });
  const digitalEligibility = useBlockedDigitalEligibility(cartQuery.data?.items);
  const [feedback, setFeedback] = useState<{ cartItemId: string; tone: "success" | "error"; message: string } | null>(null);
  const change = useMutation({
    mutationFn: ({ line, quantity }: { line: CartLine; quantity: number }) => updateCartItemQuantity(line.cartItemId, quantity),
    retry: false,
    onSuccess: async (_, { line, quantity }) => {
      await cartQuery.refetch();
      setFeedback({ cartItemId: line.cartItemId, tone: "success", message: `Cantidad actualizada: ${unitsLabel(quantity)}.` });
    },
    onError: async (error: Error, { line, quantity }) => {
      if (error instanceof ApiRequestError && error.status === 401) { clearSession("expired"); return; }
      await cartQuery.refetch();
      const code = error instanceof ApiRequestError ? error.code : undefined;
      setFeedback({ cartItemId: line.cartItemId, tone: "error", message: fieldErrorMessages(error, "quantity") ?? (code === "P3002"
        ? `No hay existencias suficientes para ${unitsLabel(quantity)}. La cantidad no cambió.`
        : code === "P2042" || code === "P2043"
        ? "Esta edición ya no está a la venta. Puedes quitarla desde el carrito."
        : error instanceof ApiRequestError && error.status < 500
        ? `${error.title}. ${error.detail}`
        : "No pudimos confirmar el cambio. Mostramos el estado actual del carrito.") });
    },
  });
  // The line waiting for "¿Quitar del carrito?", and the last one removed (it replaces the "Agregaste" line).
  const [removing, setRemoving] = useState<CartLine | null>(null);
  const [removed, setRemoved] = useState<string | null>(null);
  const confirmationRef = useRef<HTMLParagraphElement>(null);
  useEffect(() => { onConfirmingChange(removing !== null); }, [removing, onConfirmingChange]);
  useEffect(() => () => onConfirmingChange(false), [onConfirmingChange]);
  /** Keyboard focus after the question: back to that line's control, or to its neighbour once it is gone. */
  function focusRemoveControl(cartItemId: string | null, index: number) {
    window.requestAnimationFrame(() => {
      const controls = [...document.querySelectorAll<HTMLElement>("[data-cart-preview-remove]")];
      const target = (cartItemId ? controls.find((control) => control.dataset.cartPreviewRemove === cartItemId) : undefined)
        ?? controls[Math.min(index, controls.length - 1)] ?? confirmationRef.current;
      target?.focus({ preventScroll: false });
    });
  }
  const remove = useMutation({
    meta: { authRequired: true },
    mutationFn: ({ line, scope: issued }: { line: CartLine; scope: SessionOperationScope }) => { issued.assertCurrent(); return removeCartItem(line.cartItemId); },
    retry: false,
    onSuccess: async (_, { line, scope: issued }) => {
      if (!issued.isCurrent()) return;
      const index = cartQuery.data?.items.findIndex((item) => item.cartItemId === line.cartItemId) ?? 0;
      await cartQuery.refetch();
      if (!issued.isCurrent()) return;
      setRemoving(null); setFeedback(null); setRemoved(line.title);
      focusRemoveControl(null, Math.max(index, 0));
    },
    onError: async (error: Error, { line, scope: issued }) => {
      if (!issued.isCurrent()) return;
      setRemoving(null);
      if (error instanceof ApiRequestError && error.status === 401) { clearSession("expired"); return; }
      const index = cartQuery.data?.items.findIndex((item) => item.cartItemId === line.cartItemId) ?? 0;
      const refreshed = await cartQuery.refetch();
      if (!issued.isCurrent()) return;
      // Already gone (another tab, or an earlier attempt that did reach the server): the cart shows the truth.
      if (refreshed.data && !refreshed.data.items.some((item) => item.cartItemId === line.cartItemId)) {
        setFeedback(null); setRemoved(line.title); focusRemoveControl(null, Math.max(index, 0)); return;
      }
      setFeedback({ cartItemId: line.cartItemId, tone: "error", message: "No pudimos quitar este libro. Sigue en tu carrito; inténtalo otra vez." });
      focusRemoveControl(line.cartItemId, index);
    },
  });
  const busy = change.isPending || remove.isPending;

  const data = cartQuery.data;
  if (cartQuery.isPending) return <p className={classes.status} role="status">Consultando tu carrito…</p>;
  if (!data) return <div className={classes.status} role="alert">
    <p>No pudimos consultar tu carrito.</p>
    <Button variant="secondary" type="button" onClick={() => void cartQuery.refetch()}>Volver a intentar</Button>
  </div>;

  const added = data.items.find((line) => line.editionId === addedEditionId);
  const blocked = data.items.some((line) => !resolveStockStatus(line).canAddToCart);
  // As in the cart: with the server's saving, the subtotal before offers and that saving; otherwise the plain subtotal.
  const pricing = toCartPricingViewModel(data);
  const summarySaving = pricing.summary.savingsTotal && hasSaving(pricing.summary.savingsTotal.rawValue) ? pricing.summary.savingsTotal : null;
  const totals: { label: string; value: string; tone?: "savings" }[] = [
    ...(summarySaving && pricing.summary.originalSubtotal
      ? [{ label: "Subtotal", value: pricing.summary.originalSubtotal.formattedValue },
        { label: "Ahorro total hoy", value: `-${summarySaving.formattedValue}`, tone: "savings" as const }]
      : data.subtotal ? [{ label: "Subtotal", value: formatUsd(data.subtotal) }] : []),
    ...(data.taxAmount ? [{ label: ivaLabel(data.taxRate), value: formatUsd(data.taxAmount) }] : []),
    ...(data.shippingAmount ? [{ label: "Envío", value: formatUsd(data.shippingAmount) }] : []),
  ];

  return <>
    <div className={classes.scroll}>
      {/* Focus lands here when the drawer opens, so the confirmation is the first thing read. */}
      <p className={classes.confirmation} ref={confirmationRef} tabIndex={-1} data-autofocus role="status">
        <MaterialSymbol name="check_circle" size={22} fill />
        <span>{removed ? <>Quitaste <strong>{removed}</strong> del carrito</> : added ? <>Agregaste <strong>{added.title}</strong></> : "Agregado al carrito"}</span>
      </p>
      {cartQuery.isError && <p className={classes.notice} role="alert">No pudimos actualizar el carrito. Lo que ves puede estar desactualizado.</p>}
      {data.items.length === 0 && <p className={classes.empty}>Tu carrito está vacío.</p>}
      {data.items.length > 0 && <ul className={classes.lines} aria-label="Libros en tu carrito">
        {data.items.map((line) => <li key={line.cartItemId}>
          <PreviewLine eligibility={digitalEligibility.byEdition.get(line.editionId)} line={line} pricing={pricing.lines.find((entry) => entry.cartItemId === line.cartItemId)} added={line.editionId === addedEditionId} busy={busy}
            feedback={feedback?.cartItemId === line.cartItemId ? feedback : null}
            onQuantity={(quantity) => { if (busy) return; setFeedback(null); change.mutate({ line, quantity }); }}
            onRemove={() => { if (busy) return; setFeedback(null); setRemoving(line); }} />
        </li>)}
      </ul>}
    </div>
    <div className={classes.footer}>
      {data.items.length > 0 && <dl className={classes.totals}>
        {totals.map((row) => <div key={row.label} data-tone={row.tone}><dt>{row.label}</dt><dd>{row.value}</dd></div>)}
        <div className={classes.total}><dt>Total</dt><dd>{formatUsd(data.total ?? data.totalCurrent)}</dd></div>
      </dl>}
      {blocked && <p className={classes.blocker} role="status">Ajusta o quita los libros no disponibles en el carrito para continuar con la compra.</p>}
      <div className={classes.actions}>
        {!blocked && data.items.length > 0 && <Link className={classes.primary} to="/checkout">Continuar con la compra</Link>}
        <Link className={classes.secondary} to="/cart">Ver carrito</Link>
      </div>
    </div>
    <ConfirmDialog opened={removing !== null} zIndex={300} title="¿Quitar del carrito?" pill destructive
      confirmLabel="Quitar" keepLabel="Cancelar" busyLabel="Quitando…" busy={remove.isPending}
      onConfirm={() => { if (removing) remove.mutate({ line: removing, scope }); }}
      onKeep={() => { const line = removing; setRemoving(null); if (line) focusRemoveControl(line.cartItemId, 0); }}>
      <p>Se quitará <strong>{removing?.title}</strong> de tu carrito.</p>
    </ConfirmDialog>
  </>;
}

function PreviewLine({ line, eligibility, pricing, added, busy, feedback, onQuantity, onRemove }: {
  eligibility?: DigitalEligibility;
  line: CartLine; pricing: CartLinePricingViewModel | undefined; added: boolean; busy: boolean;
  feedback: { tone: "success" | "error"; message: string } | null; onQuantity: (quantity: number) => void; onRemove: () => void;
}) {
  const stock = resolveStockStatus(line);
  const statusId = `cart-preview-status-${line.cartItemId}`;
  // The server's line saving (already for this quantity): today's subtotal leads, the one before the offer struck.
  const saving = pricing?.lineSavings && hasSaving(pricing.lineSavings.rawValue) ? pricing.lineSavings : null;
  return <article className={classes.line} data-added={added || undefined} aria-busy={busy || undefined}>
    <Link className={classes.cover} to={`/catalog/editions/${line.editionId}`} tabIndex={-1} aria-hidden="true">
      <BookCover url={line.coverUrl} license={null} attribution={null} title={line.title} size="compact" />
    </Link>
    <div className={classes.identity}>
      <h3><Link to={`/catalog/editions/${line.editionId}`}>{line.title}</Link></h3>
      {line.authors && <p className={classes.muted}>{line.authors}</p>}
      {line.format && <p className={classes.muted}>{formatEdition(line.format)}</p>}
      {!stock.canAddToCart && <StockStatus available={line.available} unavailabilityReason={line.unavailabilityReason} size="compact" />}
      {!line.available && <DigitalConflictLink reason={line.unavailabilityReason} eligibility={eligibility} />}
      <div className={classes.buy}>
        {stock.canChangeQuantity && line.quantityEditable
          ? <QuantityPicker label={`Cantidad de ${line.title}`} describedBy={statusId} value={line.quantity} choices={cartQuantityChoices(line)} busy={busy} onChange={onQuantity} />
          : <p className={classes.muted}>{isSingleDigitalCopy(line) ? <DigitalCopyNote /> : `Cant. ${line.quantity}`}</p>}
        <button type="button" className={classes.remove} data-cart-preview-remove={line.cartItemId}
          aria-label={`Quitar ${line.title} del carrito`} title="Quitar del carrito" aria-disabled={busy || undefined}
          onClick={() => { if (!busy) onRemove(); }}>
          <MaterialSymbol name="delete" size={20} />
        </button>
        <p className={classes.subtotal}>
          {saving && pricing?.originalSubtotal && <s className={classes.was}><span className="visually-hidden">Precio anterior: </span>{pricing.originalSubtotal.formattedValue}</s>}
          <span><span className="visually-hidden">Subtotal: </span>{formatUsd(line.currentSubtotal)}</span>
        </p>
      </div>
      <p id={statusId} className={classes.feedback} data-tone={feedback?.tone}>
        {feedback && <span role={feedback.tone === "error" ? "alert" : "status"}>{feedback.message}</span>}
      </p>
    </div>
  </article>;
}
