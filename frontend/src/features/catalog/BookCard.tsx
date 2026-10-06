import { useAvailabilityFocus } from "@/features/catalog/useAvailabilityFocus";
import { useId } from "react";
import { Link } from "react-router-dom";
import { ActionIcon, Anchor, Button, Text, Tooltip } from "@mantine/core";
import { MaterialSymbol } from "@/shared/ui/MaterialSymbol";
import { BookCover } from "./BookCover";
import { StockStatus } from "./StockStatus";
import { favoriteActionLabel, resolveCartAction, type BookCardProps } from "./bookCardModel";
import { offerEndLabel, savingsPercentLabel } from "./offersPresentation";
import classes from "./BookCard.module.css";
export type { BookCardProps, BookCardData, FavoriteControl, CartControl, BookCardFeedback } from "./bookCardModel";

/**
 * One product, read top to bottom like a Home reading scene at shelf scale: the cover standing on
 * the paper and the identity form the link to the edition; price and stock share a baseline; the
 * cart action and the quieter favorite close the card as one line. Buttons never nest in the link.
 * Without a cart control (the catalog's browse card) there is no action line: the product link leads
 * to the edition, where buying happens, and the favorite sits in the cover stage's top-right corner.
 */
export function BookCard({ book, to, navigationState, onNavigate, favorite, cart, feedback, headingOrder = 3, showEdition = false, media, className }: BookCardProps) {
  const uid = useId();
  const favoriteLabel = favoriteActionLabel(favorite);
  const selected = "selected" in favorite ? favorite.selected : undefined;
  const cartAction = cart ? resolveCartAction(book, cart, "card") : null;
  const cartFocus = useAvailabilityFocus(cartAction ? !cartAction.unavailable : true, () => {
    const favorite = document.getElementById(`${uid}-favorite-action`) as HTMLButtonElement | null;
    return favorite && !favorite.disabled ? favorite : document.getElementById(`${uid}-edition-link`);
  });
  const reasons = [...new Set(["reason" in favorite ? favorite.reason : null, cart && "reason" in cart ? cart.reason : null].filter((reason): reason is string => Boolean(reason)))];
  const reasonId = (reason: string) => feedback?.message === reason ? `${uid}-feedback` : `${uid}-reason-${reasons.indexOf(reason)}`;
  const Heading = headingOrder === 4 ? "h4" : "h3";
  const savingsPercent = book.offer ? savingsPercentLabel(book.offer.savingsPercent) : null;
  const favoriteControl = (
  <Tooltip label={favoriteLabel} events={{ hover: true, focus: true, touch: false }} position="top" multiline maw="calc(100vw - 32px)" withArrow>
    <ActionIcon id={`${uid}-favorite-action`} type="button" size={44} radius="md" variant="transparent"
      aria-label={`${favoriteLabel}: ${book.title}`} aria-pressed={selected} aria-busy={favorite.state === "pending" || undefined}
      aria-describedby={`${uid}-authors${"reason" in favorite ? ` ${reasonId(favorite.reason)}` : ""}`}
      disabled={!("onPress" in favorite) && favorite.state !== "pending"} aria-disabled={favorite.state === "pending" || undefined} onClick={"onPress" in favorite ? favorite.onPress : undefined} className={classes.favorite} data-bookcard-favorite>
      <MaterialSymbol name={selected ? "favorite" : "favorite_border"} fill={selected} size={22} />
    </ActionIcon>
  </Tooltip>
  );

  return <article className={[classes.card, className].filter(Boolean).join(" ")} data-bookcard data-edition-id={book.id} data-media={media} data-unavailable={!book.available || undefined}>
    <Anchor id={`${uid}-edition-link`} component={Link} to={to} state={navigationState} onClick={onNavigate} underline="never" className={classes.mainLink}
      aria-label={`Ver edición: ${book.title}. ${book.publisher}, ${book.editionLabel}`} aria-describedby={`${uid}-authors ${uid}-price ${uid}-availability`} data-bookcard-link>
      <div className={classes.shelf} data-bookcard-shelf>
        <BookCover url={book.cover.url} license={null} attribution={null} title={book.title} size="card" decorative loading="lazy" />
      </div>
      <div className={classes.identity} data-bookcard-identity>
        <Text component={Heading} lineClamp={4} className={classes.bookTitle} id={`${uid}-title`} data-bookcard-title>{book.title}</Text>
        <Text component="p" lineClamp={2} className={classes.authors} id={`${uid}-authors`}>{book.authors}</Text>
        {showEdition && <p className={classes.edition}>{book.editionLabel}</p>}
      </div>
    </Anchor>
    {!cart && <div className={classes.favoriteCorner}>{favoriteControl}</div>}

    {/* Price in display type over its stock line (as in the Home scenes); the action line pairs the
        primary cart action with the quieter favorite, Home's "Agregar · Guardar" at shelf scale. */}
    <div className={classes.commercial} data-bookcard-commercial>
      <div className={classes.pricing} data-bookcard-pricing>
        <div className={classes.priceLine}>
          <p className={classes.price} id={`${uid}-price`} data-bookcard-price>{book.priceLabel}</p>
          {book.originalPriceLabel && <p className={classes.was}><span className="visually-hidden">Precio anterior </span><s>{book.originalPriceLabel}</s></p>}
        </div>
        {book.originalPriceLabel && <p className={classes.saving}>Ahorras {book.discountLabel}{savingsPercent && <span> ({savingsPercent})</span>}</p>}
        {book.offer && <div className={classes.offer} data-bookcard-offer>
          {book.offer.offerCopy && <p className={classes.offerCopy}>{book.offer.offerCopy}</p>}
          <p className={classes.offerTime} data-ending-soon={book.offer.endingSoon || undefined}><MaterialSymbol name="schedule" size={16} /><span>{book.offer.remainingLabel}</span></p>
          <p className={classes.offerEnds}>Termina el <time dateTime={book.offer.endsAt}>{offerEndLabel(book.offer.endsAt)}</time></p>
          {book.offer.terms && <details className={classes.terms}><summary>Términos de la oferta</summary><p>{book.offer.terms}</p></details>}
        </div>}
      </div>
      <p className={classes.availability} id={`${uid}-availability`} data-bookcard-availability><StockStatus available={book.available} size="compact" variant="quiet" /></p>
      {cart && cartAction ? <div className={classes.actionLine}><div className={classes.actions} data-bookcard-actions>
          <Button type="button" radius="md" variant="filled" className={classes.cart}
            leftSection={<MaterialSymbol name={cartAction.icon} size={20} />}
            aria-label={`${cartAction.label}: ${book.title}`} aria-busy={cartAction.busy || undefined}
            aria-describedby={`${uid}-authors ${uid}-price ${uid}-availability${"reason" in cart ? ` ${reasonId(cart.reason)}` : ""}`}
            disabled={cartAction.unavailable || (!cartAction.enabled && !cartAction.busy)} aria-disabled={!cartAction.enabled || undefined} {...cartFocus} onClick={"onPress" in cart ? cart.onPress : undefined}
            data-unavailable={cartAction.unavailable || undefined} data-state={cartAction.unavailable ? undefined : cart.state} data-bookcard-cart>
            <span id={`${uid}-cart-text`}>{cartAction.text}</span>
          </Button>
          {favoriteControl}
        </div></div> : <div className={classes.actionLine} />}
    </div>

    <div className={classes.supplementary}>
      {reasons.filter((reason) => reason !== feedback?.message).map((reason) => <Text size="xs" className={classes.feedback} key={reason} id={reasonId(reason)}>{reason}</Text>)}
      {feedback && <Text size="xs" className={classes.feedback} id={`${uid}-feedback`} role={feedback.kind === "error" ? "alert" : "status"} aria-atomic="true" data-bookcard-feedback>{feedback.message}</Text>}
      {cart?.state === "uncertain" && <Anchor component={Link} to={cart.recoveryTo} size="sm" className={classes.recovery}>Consultar carrito</Anchor>}
    </div>
  </article>;
}
