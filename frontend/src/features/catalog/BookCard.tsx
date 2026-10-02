import { useId } from "react";
import { Link } from "react-router-dom";
import { ActionIcon, Anchor, Button, Group, Paper, Text, Tooltip } from "@mantine/core";
import { MaterialSymbol } from "@/shared/ui/MaterialSymbol";
import { BookCover } from "./BookCover";
import { StockStatus } from "./StockStatus";
import { favoriteActionLabel, type BookCardProps } from "./bookCardModel";
import classes from "./BookCard.module.css";
export type { BookCardProps, BookCardData, FavoriteControl, CartControl, BookCardFeedback } from "./bookCardModel";

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

  return <Paper component="article" radius="md" className={[classes.card, className].filter(Boolean).join(" ")} data-bookcard data-edition-id={book.id}>
    <Anchor component={Link} to={to} state={navigationState} onClick={onNavigate} underline="never" className={classes.mainLink}
      aria-label={`Ver edición: ${book.title}. ${book.publisher}, ${book.editionLabel}`} aria-describedby={`${uid}-authors ${uid}-price ${uid}-availability`} data-bookcard-link>
      <div className={classes.cover}>
        <span className={classes.coverAffordance} aria-hidden="true" data-bookcard-cover-affordance><MaterialSymbol name="visibility" /></span>
        <BookCover url={book.cover.url} license={null} attribution={null} title={book.title} size="card" decorative loading="lazy" />
      </div>
      <div className={classes.identity} data-bookcard-identity>
        <Text component={headingOrder === 4 ? "h4" : "h3"} size="md" fw={600} lineClamp={2} className={classes.bookTitle} id={`${uid}-title`} data-bookcard-title>{book.title}</Text>
        <Text component="p" size="sm" lineClamp={2} className={classes.authors} id={`${uid}-authors`}>{book.authors}</Text>
      </div>
      <div className={classes.commercial} data-bookcard-commercial>
        <Text component="p" size="lg" fw={600} className={classes.price} id={`${uid}-price`} data-bookcard-price>{book.priceLabel}</Text>
        <Text component="p" size="xs" className={classes.availability} id={`${uid}-availability`} data-bookcard-availability><StockStatus available={book.available} size="compact" variant="badge" /></Text>
      </div>
    </Anchor>
    <div className={classes.actionRegion}>
    <Group gap="xs" wrap="nowrap" className={classes.actions} data-bookcard-actions>
      <Tooltip label={favoriteLabel} events={{ hover: true, focus: true, touch: false }} withArrow>
        <ActionIcon type="button" size={44} radius="sm" variant="default" color="pliego"
          aria-label={`${favoriteLabel}: ${book.title}`} aria-pressed={selected} aria-busy={favorite.state === "pending" || undefined}
          aria-describedby={`${uid}-authors${"reason" in favorite ? ` ${reasonId(favorite.reason)}` : ""}`}
          disabled={favorite.state !== "ready"} onClick={"onPress" in favorite ? favorite.onPress : undefined} className={classes.favorite} data-bookcard-favorite>
          <MaterialSymbol name={selected ? "favorite" : "favorite_border"} fill={selected} className={classes.icon} />
        </ActionIcon>
      </Tooltip>
      <Tooltip label={cartLabel} events={{ hover: true, focus: true, touch: false }} withArrow>
        <Button type="button" size="sm" fw={500} radius="sm" variant="subtle" color="pliego" px="2xs" className={classes.cart}
          aria-label={`${cartLabel}: ${book.title}`} aria-busy={cart.state === "pending" || undefined}
          aria-describedby={`${uid}-authors ${uid}-price ${uid}-availability${"reason" in cart ? ` ${reasonId(cart.reason)}` : ""}`}
          disabled={!book.available || !("onPress" in cart)} onClick={"onPress" in cart ? cart.onPress : undefined} data-unavailable={!book.available || undefined} data-bookcard-cart>
          <MaterialSymbol name={cartIcon} className={classes.icon} />
          <span className={classes.cartLabel} id={`${uid}-cart-text`}>{cartText}</span>
        </Button>
      </Tooltip>
    </Group>
    </div>
    <div className={classes.supplementary}>
    {reasons.filter((reason) => reason !== feedback?.message).map((reason) => <Text size="xs" className={classes.feedback} key={reason} id={reasonId(reason)}>{reason}</Text>)}
    {feedback && <Text size="xs" className={classes.feedback} id={`${uid}-feedback`} role={feedback.kind === "error" ? "alert" : "status"} aria-atomic="true" data-bookcard-feedback>{feedback.message}</Text>}
    {cart.state === "uncertain" && <Anchor component={Link} to={cart.recoveryTo} size="sm" className={classes.recovery}>Consultar carrito</Anchor>}
    </div>
  </Paper>;
}
