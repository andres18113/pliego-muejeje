import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { useMutation } from "@tanstack/react-query";
import { Link, useLocation } from "react-router-dom";
import { Drawer } from "@mantine/core";
import { useMediaQuery, useReducedMotion } from "@mantine/hooks";
import { Button } from "@/components/ui/button";
import { useSession } from "@/app/session";
import { BookCover } from "@/features/catalog/BookCover";
import { StockStatus } from "@/features/catalog/StockStatus";
import { resolveStockStatus } from "@/features/catalog/stockStatusModel";
import { formatEdition, formatUsd } from "@/features/catalog/formatters";
import { updateCartItemQuantity, type CartLine } from "@/shared/api/cart";
import { ApiRequestError, fieldErrorMessages } from "@/shared/api/errors";
import { MaterialSymbol } from "@/shared/ui/MaterialSymbol";
import { QuantityPicker } from "@/shared/ui/QuantityPicker";
import { cartQuantityChoices, useCustomerCart } from "./cartQuery";
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
  return <Drawer opened={opened} onClose={onClose} title="Tu carrito" position="right" size={phone ? "100%" : 420}
    closeButtonProps={{ "aria-label": "Cerrar carrito", size: 44 }}
    transitionProps={{ duration: reduceMotion ? 0 : 280, timingFunction: "cubic-bezier(.32, .94, .6, 1)" }}
    overlayProps={{ backgroundOpacity: 0.28, color: "#252740" }}
    classNames={{ content: `${classes.drawer} storefront-panel`, header: classes.header, title: classes.title, body: classes.body }}>
    {opened && <CartPreviewContent addedEditionId={addedEditionId} />}
  </Drawer>;
}

function CartPreviewContent({ addedEditionId }: { addedEditionId: string | null }) {
  const { clear: clearSession } = useSession();
  // The add already re-read the cart; this read only refreshes when that copy is old.
  const cartQuery = useCustomerCart(true, { fresh: false });
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

  const data = cartQuery.data;
  if (cartQuery.isPending) return <p className={classes.status} role="status">Consultando tu carrito…</p>;
  if (!data) return <div className={classes.status} role="alert">
    <p>No pudimos consultar tu carrito.</p>
    <Button variant="secondary" type="button" onClick={() => void cartQuery.refetch()}>Volver a intentar</Button>
  </div>;

  const added = data.items.find((line) => line.editionId === addedEditionId);
  const blocked = data.items.some((line) => !resolveStockStatus(line).canAddToCart);
  const totals = [
    ...(data.subtotal ? [{ label: "Subtotal", value: formatUsd(data.subtotal) }] : []),
    ...(data.taxAmount ? [{ label: ivaLabel(data.taxRate), value: formatUsd(data.taxAmount) }] : []),
    ...(data.shippingAmount ? [{ label: "Envío", value: formatUsd(data.shippingAmount) }] : []),
  ];

  return <>
    <div className={classes.scroll}>
      {/* Focus lands here when the drawer opens, so the confirmation is the first thing read. */}
      <p className={classes.confirmation} tabIndex={-1} data-autofocus role="status">
        <MaterialSymbol name="check_circle" size={22} fill />
        <span>{added ? <>Agregaste <strong>{added.title}</strong></> : "Agregado al carrito"}</span>
      </p>
      {cartQuery.isError && <p className={classes.notice} role="alert">No pudimos actualizar el carrito. Lo que ves puede estar desactualizado.</p>}
      <ul className={classes.lines} aria-label="Libros en tu carrito">
        {data.items.map((line) => <li key={line.cartItemId}>
          <PreviewLine line={line} added={line.editionId === addedEditionId} busy={change.isPending}
            feedback={feedback?.cartItemId === line.cartItemId ? feedback : null}
            onQuantity={(quantity) => { if (change.isPending) return; setFeedback(null); change.mutate({ line, quantity }); }} />
        </li>)}
      </ul>
    </div>
    <div className={classes.footer}>
      <dl className={classes.totals}>
        {totals.map((row) => <div key={row.label}><dt>{row.label}</dt><dd>{row.value}</dd></div>)}
        <div className={classes.total}><dt>Total</dt><dd>{formatUsd(data.total ?? data.totalCurrent)}</dd></div>
      </dl>
      {blocked && <p className={classes.blocker} role="status">Ajusta o quita los libros no disponibles en el carrito para continuar con la compra.</p>}
      <div className={classes.actions}>
        {!blocked && <Link className={classes.primary} to="/checkout">Continuar con la compra</Link>}
        <Link className={classes.secondary} to="/cart">Ver carrito</Link>
      </div>
    </div>
  </>;
}

function PreviewLine({ line, added, busy, feedback, onQuantity }: {
  line: CartLine; added: boolean; busy: boolean;
  feedback: { tone: "success" | "error"; message: string } | null; onQuantity: (quantity: number) => void;
}) {
  const stock = resolveStockStatus(line);
  const statusId = `cart-preview-status-${line.cartItemId}`;
  return <article className={classes.line} data-added={added || undefined} aria-busy={busy || undefined}>
    <Link className={classes.cover} to={`/catalog/editions/${line.editionId}`} tabIndex={-1} aria-hidden="true">
      <BookCover url={line.coverUrl} license={null} attribution={null} title={line.title} size="compact" />
    </Link>
    <div className={classes.identity}>
      <h3><Link to={`/catalog/editions/${line.editionId}`}>{line.title}</Link></h3>
      {line.authors && <p className={classes.muted}>{line.authors}</p>}
      {line.format && <p className={classes.muted}>{formatEdition(line.format)}</p>}
      {!stock.canAddToCart && <StockStatus available={line.available} unavailabilityReason={line.unavailabilityReason} size="compact" />}
      <div className={classes.buy}>
        {stock.canChangeQuantity && line.quantityEditable
          ? <QuantityPicker label={`Cantidad de ${line.title}`} describedBy={statusId} value={line.quantity} choices={cartQuantityChoices(line)} busy={busy} onChange={onQuantity} />
          : <p className={classes.muted}>Cantidad: {line.quantity}</p>}
        <p className={classes.subtotal}><span className="visually-hidden">Subtotal: </span>{formatUsd(line.currentSubtotal)}</p>
      </div>
      <p id={statusId} className={classes.feedback} data-tone={feedback?.tone}>
        {feedback && <span role={feedback.tone === "error" ? "alert" : "status"}>{feedback.message}</span>}
      </p>
    </div>
  </article>;
}
