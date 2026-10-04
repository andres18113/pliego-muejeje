import { useState, type MouseEventHandler } from "react";
import { Link } from "react-router-dom";
import { Button, UnstyledButton } from "@mantine/core";
import type { QueryKey } from "@tanstack/react-query";
import type { EditionSummary } from "@/shared/api/catalog";
import { MaterialSymbol } from "@/shared/ui/MaterialSymbol";
import { BookCover } from "./BookCover";
import { StockStatus } from "./StockStatus";
import { bookCardNavigationState, favoriteActionLabel, toBookCardData, type BookCardFeedback } from "./bookCardModel";
import { formatEdition } from "./formatters";
import { useCartControl, useFavoriteControl } from "./useBookCardActions";
import classes from "./homeNextReading.module.css";

/**
 * One book as an editorial scene. Presentation only: price, stock, favorite and cart
 * come from the same model and hooks as BookCard.
 */
export function HomeReadingScene({ edition, position, total, active, detailHref, returnHref, isFavorite, favoriteReady, favoriteQueryKey, onOpen }: {
  edition: EditionSummary; position: number; total: number; active: boolean; detailHref: string; returnHref: string;
  isFavorite: boolean; favoriteReady: boolean; favoriteQueryKey: QueryKey; onOpen: MouseEventHandler<HTMLAnchorElement>;
}) {
  const [feedback, setFeedback] = useState<BookCardFeedback | null>(null);
  const book = toBookCardData(edition);
  const favorite = useFavoriteControl({ editionId: book.id, isFavorite, ready: favoriteReady, queryKey: favoriteQueryKey, returnHref, onFeedback: setFeedback });
  const cart = useCartControl({ editionId: book.id, available: book.available, returnHref, onFeedback: setFeedback });
  const navigationState = bookCardNavigationState(book, true);
  const favoriteLabel = favoriteActionLabel(favorite);
  const saved = "selected" in favorite && favorite.selected;
  const cartText = !book.available ? "Agregar al carrito" : cart.state === "pending" ? "Agregando…"
    : cart.state === "success" ? "Agregado al carrito" : cart.state === "uncertain" ? "Consulta el carrito" : "Agregar al carrito";
  const cartLabel = book.available && cart.state === "success" ? "Agregado al carrito. Agregar otra unidad" : cartText;
  const cartIcon = !book.available ? "shopping_cart_off" : cart.state === "success" ? "check" : cart.state === "pending" ? "schedule" : "add_shopping_cart";
  const reasons = [...new Set(["reason" in favorite ? favorite.reason : null, "reason" in cart ? cart.reason : null]
    .filter((reason): reason is string => Boolean(reason) && reason !== feedback?.message))];

  return <article className={classes.scene} inert={!active} aria-label={`Libro ${position} de ${total}`} data-reading-scene data-edition-id={book.id}>
    <Link to={detailHref} state={navigationState} onClick={onOpen} className={classes.art} tabIndex={-1} aria-hidden="true">
      <BookCover url={book.cover.url} license={null} attribution={null} title={book.title} size="card" decorative loading={position <= 2 ? "eager" : "lazy"} />
    </Link>
    <div className={classes.info}>
      <p className={classes.author}>{book.authors}</p>
      <h3 className={classes.title}><Link to={detailHref} state={navigationState} onClick={onOpen} data-reading-title>{book.title}</Link></h3>
      <p className={classes.edition}>{book.publisher}, {formatEdition(edition.format).toLocaleLowerCase("es")}</p>
      <div className={classes.commerce}>
        <p className={classes.price} data-reading-price>{book.priceLabel}</p>
        <StockStatus available={book.available} variant="text" className={classes.stock} />
      </div>
      <div className={classes.actions}>
        <Button type="button" className={classes.cart} leftSection={<MaterialSymbol name={cartIcon} size={22} />}
          aria-label={`${cartLabel}: ${book.title}`} aria-busy={cart.state === "pending" || undefined}
          disabled={!book.available || !("onPress" in cart)} onClick={"onPress" in cart ? cart.onPress : undefined} data-reading-cart>{cartText}</Button>
        <UnstyledButton className={classes.favorite} aria-label={`${favoriteLabel}: ${book.title}`} aria-pressed={"selected" in favorite ? favorite.selected : undefined}
          aria-busy={favorite.state === "pending" || undefined} disabled={favorite.state !== "ready"} onClick={"onPress" in favorite ? favorite.onPress : undefined} data-reading-favorite>
          <MaterialSymbol name={saved ? "favorite" : "favorite_border"} fill={saved} size={22} />
          <span className={classes.favoriteText}>{saved ? "Guardado" : "Guardar"}</span>
        </UnstyledButton>
      </div>
      {(reasons.length > 0 || feedback || cart.state === "uncertain") && <div className={classes.feedback}>
        {reasons.map((reason) => <p key={reason}>{reason}</p>)}
        {feedback && <p role={feedback.kind === "error" ? "alert" : "status"} aria-atomic="true">{feedback.message}</p>}
        {cart.state === "uncertain" && <Link to={cart.recoveryTo}>Consultar carrito</Link>}
      </div>}
    </div>
  </article>;
}
