import { useAvailabilityFocus } from "@/features/catalog/useAvailabilityFocus";
import { useId, useRef, useState } from "react";
import { Link } from "react-router-dom";
import type { QueryKey } from "@tanstack/react-query";
import { ConfirmDialog } from "@/shared/ui/ConfirmDialog";
import { MaterialSymbol } from "@/shared/ui/MaterialSymbol";
import { BookCover } from "@/features/catalog/BookCover";
import { StockStatus } from "@/features/catalog/StockStatus";
import { favoriteActionLabel, resolveCartAction, toBookCardData, type BookCardEditionSource, type BookCardFeedback } from "@/features/catalog/bookCardModel";
import { useCartControl, useFavoriteControl } from "@/features/catalog/useBookCardActions";
import classes from "./favorites.module.css";

/**
 * One saved edition as a reading-list row: the cover and identity link to the edition; price and
 * stock sit beside them; the cart action and the favorite toggle close the row. The commercial
 * rules (price, stock, favorite, cart) come from the shared BookCard sources — only the
 * presentation is specific to a saved collection. Removal refreshes the authoritative list; its page owns focus recovery when a row disappears.
 */
export function FavoriteRow({ edition, detailHref, returnHref, queryKey, onRemoved, cartQuantity, onAddedToCart, confirmRemoval = false }: {
  edition: BookCardEditionSource; detailHref: string; returnHref: string; queryKey: QueryKey;
  /** Units the cart action adds (the cart's saved list restores a line with the quantity it had). */
  cartQuantity?: number;
  /** The server confirmed the add. */
  onAddedToCart?: (editionId: string) => void;
  /** The server confirmed the removal: the page offers to undo it. */
  onRemoved?: () => void;
  /** Ask before removing (the Favoritos page). Elsewhere the toggle stays immediate. */
  confirmRemoval?: boolean;
}) {
  const uid = useId();
  const [feedback, setFeedback] = useState<BookCardFeedback | null>(null);
  const [confirming, setConfirming] = useState(false);
  const favoriteButton = useRef<HTMLButtonElement>(null);
  const book = toBookCardData(edition);
  const favorite = useFavoriteControl({ editionId: book.id, isFavorite: true, ready: true, queryKey, returnHref, onFeedback: setFeedback, onChanged: (saved) => { if (!saved) onRemoved?.(); } });
  const cart = useCartControl({ editionId: book.id, available: book.available, format: edition.format, returnHref, onFeedback: setFeedback, quantity: cartQuantity, onAdded: onAddedToCart });
  const selected = "selected" in favorite ? favorite.selected : undefined;
  const favoriteLabel = favoriteActionLabel(favorite);
  const cartAction = resolveCartAction(book, cart, "row");
  const cartFocus = useAvailabilityFocus(!cartAction.unavailable, () => {
    const favorite = document.getElementById(`${uid}-favorite-action`) as HTMLButtonElement | null;
    return favorite && !favorite.disabled ? favorite : document.getElementById(`${uid}-edition-link`);
  });
  const pressFavorite = "onPress" in favorite ? favorite.onPress : undefined;
  // Focus goes back to the row's own control before anything else happens: kept, it stays there; removed, the
  // page sees which row lost it and moves on to the next one.
  const answer = (remove: boolean) => {
    setConfirming(false);
    favoriteButton.current?.focus({ preventScroll: true });
    if (remove) pressFavorite?.();
  };
  const reasons = [...new Set(["reason" in favorite ? favorite.reason : null, "reason" in cart ? cart.reason : null].filter((reason): reason is string => Boolean(reason)))];

  return <article className={classes.row} data-favorite-row data-edition-id={book.id} data-removed={selected === false || undefined}>
    <Link id={`${uid}-edition-link`} to={detailHref} className={classes.identityLink} aria-label={`Ver edición: ${book.title}. ${book.publisher}, ${book.editionLabel}`} aria-describedby={`${uid}-authors ${uid}-price ${uid}-stock`} data-bookcard-link>
      <span className={classes.cover}><BookCover url={book.cover.url} license={null} attribution={null} title={book.title} size="compact" decorative loading="lazy" /></span>
      <span className={classes.identity}>
        <h3 className={classes.title} data-bookcard-title>{book.title}</h3>
        <span className={classes.authors} id={`${uid}-authors`}>{book.authors}</span>
        <span className={classes.edition}>{book.publisher}, {book.editionLabel}</span>
      </span>
    </Link>
    <div className={classes.commerce}>
      <p className={classes.price} id={`${uid}-price`} data-bookcard-price>{book.priceLabel}</p>
      <p className={classes.stock} id={`${uid}-stock`}><StockStatus available={book.available} size="compact" variant="quiet" /></p>
    </div>
    <div className={classes.actions} data-bookcard-actions>
      <button type="button" className={classes.cart}
        aria-label={`${cartAction.label}: ${book.title}`} aria-busy={cartAction.busy || undefined}
        aria-describedby={`${uid}-price ${uid}-stock`}
        disabled={cartAction.unavailable || (!cartAction.enabled && !cartAction.busy)} aria-disabled={!cartAction.enabled || undefined} {...cartFocus} onClick={"onPress" in cart ? cart.onPress : undefined}
        data-unavailable={cartAction.unavailable || undefined} data-bookcard-cart>
        <MaterialSymbol name={cartAction.icon} size={20} aria-hidden="true" /><span>{cartAction.text}</span>
      </button>
      <button ref={favoriteButton} id={`${uid}-favorite-action`} type="button" className={classes.favorite}
        aria-label={`${favoriteLabel}: ${book.title}`} aria-pressed={"selected" in favorite ? favorite.selected : undefined} aria-busy={favorite.state === "pending" || undefined}
        disabled={!("onPress" in favorite) && favorite.state !== "pending"} aria-disabled={favorite.state === "pending" || undefined} onClick={pressFavorite ? (confirmRemoval && selected === true ? () => setConfirming(true) : pressFavorite) : undefined} data-bookcard-favorite>
        <MaterialSymbol name={selected ? "favorite" : "favorite_border"} fill={selected} size={20} aria-hidden="true" />
        <span className={classes.favoriteText}>{favorite.state === "uncertain" ? "Consultar" : selected === false ? "Guardar de nuevo" : "Quitar"}</span>
      </button>
    </div>
    {(reasons.length > 0 || feedback || cart.state === "uncertain") && <div className={classes.feedback}>
      {reasons.filter((reason) => reason !== feedback?.message).map((reason) => <p key={reason}>{reason}</p>)}
      {feedback && <p role={feedback.kind === "error" ? "alert" : "status"} aria-atomic="true" data-bookcard-feedback>{feedback.message}</p>}
      {cart.state === "uncertain" && <Link to={cart.recoveryTo}>Consultar carrito</Link>}
    </div>}
    {confirmRemoval && <ConfirmDialog opened={confirming} destructive title="¿Quitar de Favoritos?" confirmLabel="Quitar de Favoritos" keepLabel="Conservar"
      onConfirm={() => answer(true)} onKeep={() => answer(false)}>
      <p>«{book.title}» dejará de estar en tu lista de favoritos.</p>
      <p>Puedes volver a guardarlo desde el catálogo cuando quieras.</p>
    </ConfirmDialog>}
  </article>;
}
