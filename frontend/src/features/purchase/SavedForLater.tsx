import type { UseQueryResult } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { BookCover } from "@/features/catalog/BookCover";
import { StockStatus } from "@/features/catalog/StockStatus";
import surface from "@/features/catalog/availabilitySurface.module.css";
import { formatEdition, formatUsd } from "@/features/catalog/formatters";
import { resolveStockStatus } from "@/features/catalog/stockStatusModel";
import type { SavedItem, SavedList } from "@/shared/api/cart";
import { DigitalConflictLink } from "@/features/library/DigitalConflictLink";
import { DigitalCopyNote } from "./DigitalCopyNote";
import classes from "./cart.module.css";

/** Why a move failed; `reason` is the server code, so a digital conflict can lead to the library or the order. */
export type SavedFeedback = { savedItemId: string; message: string; reason?: string };

/**
 * "Guardado para después" (ADR 0045): the customer's own list beside the cart, independent of Favoritos. Each
 * row reads like a cart line — the book, the quantity it will come back with, what it costs today — and moves
 * back with "Mover al carrito". It never counts in the cart's totals. The page owns the moves; this only shows.
 */
export function SavedForLater({ query, busyId, locked, feedback, onMoveToCart, onRemove }: {
  query: UseQueryResult<SavedList>;
  busyId?: string;
  locked: boolean;
  feedback: SavedFeedback | null;
  onMoveToCart: (item: SavedItem) => void;
  onRemove: (item: SavedItem) => void;
}) {
  const saved = query.data;
  return (
    <section className={classes.saved} aria-labelledby="cart-saved-heading" data-cart-saved>
      <header className={classes.savedHead}>
        <h2 id="cart-saved-heading" tabIndex={-1}>Guardado para después</h2>
        <p>Los libros que no comprarás hoy. No cuentan en el total.</p>
      </header>
      {query.isPending ? (
        <p className={classes.savedQuiet} role="status">Consultando tus libros guardados…</p>
      ) : !saved ? (
        <p className={classes.savedQuiet}>
          No pudimos consultar tus libros guardados.{" "}
          <Button variant="text" type="button" onClick={() => void query.refetch()}>Volver a intentar</Button>
        </p>
      ) : saved.items.length === 0 ? (
        <div className={classes.savedEmpty}>
          <strong>No hay libros guardados</strong>
          <p>Guarda aquí los libros que no comprarás hoy.</p>
        </div>
      ) : (
        <ul className={classes.list}>
          {saved.items.map((item) => (
            <li key={item.savedItemId}>
              <SavedItemRow item={item} busy={busyId === item.savedItemId} locked={locked}
                feedback={feedback?.savedItemId === item.savedItemId ? feedback : null}
                onMoveToCart={() => onMoveToCart(item)} onRemove={() => onRemove(item)} />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function SavedItemRow({ item, busy, locked, feedback, onMoveToCart, onRemove }: {
  item: SavedItem; busy: boolean; locked: boolean; feedback: SavedFeedback | null; onMoveToCart: () => void; onRemove: () => void;
}) {
  const stock = resolveStockStatus(item);
  const stockId = `saved-line-stock-${item.savedItemId}`;
  const statusId = `saved-line-status-${item.savedItemId}`;
  return (
    <article className={classes.item} data-saved-item data-edition-id={item.editionId} data-unavailable={stock.canAddToCart ? undefined : ""} aria-busy={busy}>
      <Link className={classes.cover} to={`/catalog/editions/${item.editionId}`} tabIndex={-1} aria-hidden="true">
        <BookCover url={item.coverUrl} license={null} attribution={null} title={item.title} size="compact" />
      </Link>
      <div className={classes.identity} data-purchase="line-copy">
        <h3><Link id={`saved-line-link-${item.savedItemId}`} aria-describedby={stock.canAddToCart ? undefined : stockId} to={`/catalog/editions/${item.editionId}`}>{item.title}</Link></h3>
        {item.authors && <p className={classes.authors}>{item.authors}</p>}
        {item.format && <p>{formatEdition(item.format)}</p>}
      </div>
      <div className={classes.buy}>
        <div className={classes.quantity}>
          {item.requiresPhysicalFulfillment ? (
            // The quantity it will come back with, read like the cart's ("Cant. 2").
            <p className={classes.quantityStatic}>
              <span className="visually-hidden">Cantidad: {item.quantity}</span>
              <span aria-hidden="true"><span className={classes.quantityCaption}>Cant.</span> <span className={classes.quantityValue}>{item.quantity}</span></span>
            </p>
          ) : <p className={classes.quantityDigital}><DigitalCopyNote /></p>}
        </div>
        <div className={classes.amount}>
          {item.requiresPhysicalFulfillment && item.quantity > 1 && <p className={classes.unitPrice}>{formatUsd(item.currentPrice)} c/u</p>}
          <p className={classes.price}><span className={classes.subtotal}>{formatUsd(item.currentSubtotal)}</span></p>
        </div>
      </div>
      {!stock.canAddToCart && <div className={classes.problem}>
        <StockStatus available={item.available} unavailabilityReason={item.unavailabilityReason} id={stockId} className={surface.status} />
      </div>}
      <div className={classes.actions}>
        <DigitalConflictLink reason={!item.available ? item.unavailabilityReason : feedback?.reason} />
        <Button variant="text" type="button" aria-label={`Mover ${item.title} al carrito`} aria-describedby={statusId}
          aria-disabled={locked || !stock.canAddToCart || undefined} onClick={() => !locked && stock.canAddToCart && onMoveToCart()}>
          Mover al carrito
        </Button>
        <Button variant="text" type="button" aria-label={`Quitar ${item.title} de guardados`} aria-disabled={locked || undefined} onClick={() => !locked && onRemove()}>
          Quitar
        </Button>
      </div>
      <p id={statusId} className={classes.feedback} data-tone={feedback ? "error" : undefined}>
        {(busy || feedback) && <span role={feedback ? "alert" : "status"}>{feedback?.message ?? "Actualizando…"}</span>}
      </p>
    </article>
  );
}
