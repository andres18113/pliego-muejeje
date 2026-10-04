import { useId } from "react";
import { Link } from "react-router-dom";
import { ActionIcon, Anchor, Button, Text, Tooltip } from "@mantine/core";
import { MaterialSymbol } from "@/shared/ui/MaterialSymbol";
import { BookCover } from "./BookCover";
import { StockStatus } from "./StockStatus";
import { favoriteActionLabel, type BookCardProps } from "./bookCardModel";
import classes from "./BookCard.module.css";
export type { BookCardProps, BookCardData, FavoriteControl, CartControl, BookCardFeedback } from "./bookCardModel";

/**
 * One product, read top to bottom like a Home reading scene at shelf scale: the cover standing on
 * the paper and the identity form the link to the edition; price and stock share a baseline; the
 * cart action and the quieter favorite close the card as one line. Buttons never nest in the link.
 */
export function BookCard({ book, to, navigationState, onNavigate, favorite, cart, feedback, headingOrder = 3, className }: BookCardProps) {
  const uid = useId();
  const favoriteLabel = favoriteActionLabel(favorite);
  const selected = "selected" in favorite ? favorite.selected : undefined;
  const cartLabel = !book.available ? "Agregar al carrito"
    : cart.state === "pending" ? "Agregando…" : cart.state === "success" ? "Agregado al carrito. Agregar otra unidad"
      : cart.state === "uncertain" ? "Consulta el carrito antes de reintentar" : "Agregar al carrito";
  const cartIcon = !book.available ? "shopping_cart_off" : cart.state === "success" ? "check"
    : cart.state === "pending" ? "schedule" : cart.state === "uncertain" ? "info" : "add_shopping_cart";
  const cartText = !book.available ? "Agregar" : cart.state === "pending" ? "Agregando…"
    : cart.state === "success" ? "Agregado" : cart.state === "uncertain" ? "Sin confirmar" : "Agregar";
  const reasons = [...new Set(["reason" in favorite ? favorite.reason : null, "reason" in cart ? cart.reason : null].filter((reason): reason is string => Boolean(reason)))];
  const reasonId = (reason: string) => feedback?.message === reason ? `${uid}-feedback` : `${uid}-reason-${reasons.indexOf(reason)}`;
  const Heading = headingOrder === 4 ? "h4" : "h3";

  return <article className={[classes.card, className].filter(Boolean).join(" ")} data-bookcard data-edition-id={book.id}>
    <Anchor component={Link} to={to} state={navigationState} onClick={onNavigate} underline="never" className={classes.mainLink}
      aria-label={`Ver edición: ${book.title}. ${book.publisher}, ${book.editionLabel}`} aria-describedby={`${uid}-authors ${uid}-price ${uid}-availability`} data-bookcard-link>
      <div className={classes.shelf} data-bookcard-shelf>
        <BookCover url={book.cover.url} license={null} attribution={null} title={book.title} size="card" decorative loading="lazy" />
      </div>
      <div className={classes.identity} data-bookcard-identity>
        <Text component={Heading} lineClamp={4} className={classes.bookTitle} id={`${uid}-title`} data-bookcard-title>{book.title}</Text>
        <Text component="p" lineClamp={2} className={classes.authors} id={`${uid}-authors`}>{book.authors}</Text>
      </div>
    </Anchor>

    {/* Price in display type over its stock line (as in the Home scenes); the action line pairs the
        primary cart action with the quieter favorite, Home's "Agregar · Guardar" at shelf scale. */}
    <div className={classes.commercial} data-bookcard-commercial>
      <p className={classes.price} id={`${uid}-price`} data-bookcard-price>{book.priceLabel}</p>
      <p className={classes.availability} id={`${uid}-availability`} data-bookcard-availability><StockStatus available={book.available} size="compact" /></p>
      <div className={classes.actionLine}><div className={classes.actions} data-bookcard-actions>
        <Button type="button" radius="md" variant="filled" className={classes.cart}
          leftSection={<MaterialSymbol name={cartIcon} size={20} />}
          aria-label={`${cartLabel}: ${book.title}`} aria-busy={cart.state === "pending" || undefined}
          aria-describedby={`${uid}-authors ${uid}-price ${uid}-availability${"reason" in cart ? ` ${reasonId(cart.reason)}` : ""}`}
          disabled={!book.available || !("onPress" in cart)} onClick={"onPress" in cart ? cart.onPress : undefined}
          data-unavailable={!book.available || undefined} data-state={book.available ? cart.state : undefined} data-bookcard-cart>
          <span id={`${uid}-cart-text`}>{cartText}</span>
        </Button>
        <Tooltip label={favoriteLabel} events={{ hover: true, focus: true, touch: false }} position="top" multiline maw="calc(100vw - 32px)" withArrow>
          <ActionIcon type="button" size={44} radius="md" variant="transparent"
            aria-label={`${favoriteLabel}: ${book.title}`} aria-pressed={selected} aria-busy={favorite.state === "pending" || undefined}
            aria-describedby={`${uid}-authors${"reason" in favorite ? ` ${reasonId(favorite.reason)}` : ""}`}
            disabled={favorite.state !== "ready"} onClick={"onPress" in favorite ? favorite.onPress : undefined} className={classes.favorite} data-bookcard-favorite>
            <MaterialSymbol name={selected ? "favorite" : "favorite_border"} fill={selected} size={22} />
          </ActionIcon>
        </Tooltip>
      </div></div>
    </div>

    <div className={classes.supplementary}>
      {reasons.filter((reason) => reason !== feedback?.message).map((reason) => <Text size="xs" className={classes.feedback} key={reason} id={reasonId(reason)}>{reason}</Text>)}
      {feedback && <Text size="xs" className={classes.feedback} id={`${uid}-feedback`} role={feedback.kind === "error" ? "alert" : "status"} aria-atomic="true" data-bookcard-feedback>{feedback.message}</Text>}
      {cart.state === "uncertain" && <Anchor component={Link} to={cart.recoveryTo} size="sm" className={classes.recovery}>Consultar carrito</Anchor>}
    </div>
  </article>;
}
