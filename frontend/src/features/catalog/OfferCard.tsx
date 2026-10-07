import { useId, useState, type MouseEventHandler } from "react";
import type { QueryKey } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { ActionIcon, Tooltip } from "@mantine/core";
import { MaterialSymbol } from "@/shared/ui/MaterialSymbol";
import { BookCover } from "./BookCover";
import { bookCardNavigationState, favoriteActionLabel, toBookCardData, type BookCardEditionSource, type BookCardFeedback } from "./bookCardModel";
import { mediaOfFormat } from "./catalogMedia";
import { SavingsChip, UrgencyChip } from "./OfferChips";
import { offerUrgencyLabel } from "./offersPresentation";
import { useFavoriteControl } from "./useBookCardActions";
import classes from "./OfferCard.module.css";

type OfferCardProps = {
  edition: BookCardEditionSource; detailHref: string; returnHref: string; isFavorite: boolean; favoriteReady: boolean;
  favoriteQueryKey: QueryKey; onOpen?: MouseEventHandler<HTMLAnchorElement>;
};

const mediaCue = { physical: null, ebook: "eBook", audiobook: "Audiolibro" } as const;

/**
 * Ofertas' own merchandising card (Google Store offers): one white stage where the jacket leads, an urgency
 * chip only when the server says the offer ends within five days, a quiet heart; then the title, today's
 * price with the previous one struck and the saving as one green chip, and "Ver oferta". The whole card is
 * one link to the edition, where buying happens. Prices, savings and days left are the API's.
 */
export function OfferCard({ edition, detailHref, returnHref, isFavorite, favoriteReady, favoriteQueryKey, onOpen }: OfferCardProps) {
  const uid = useId();
  const [feedback, setFeedback] = useState<BookCardFeedback | null>(null);
  const book = toBookCardData(edition);
  const media = mediaOfFormat(edition.format);
  const favorite = useFavoriteControl({ editionId: book.id, isFavorite, ready: favoriteReady, queryKey: favoriteQueryKey, returnHref, onFeedback: setFeedback });
  const favoriteLabel = favoriteActionLabel(favorite);
  const selected = "selected" in favorite ? favorite.selected : undefined;
  const reason = "reason" in favorite && favorite.reason !== feedback?.message ? favorite.reason : null;
  const urgency = edition.offer ? offerUrgencyLabel(edition.offer.daysRemaining) : null;
  const cue = mediaCue[media];

  return <article className={classes.card} data-offer-card data-edition-id={book.id} data-unavailable={!book.available || undefined}>
    <div className={classes.stage}>
      <BookCover url={book.cover.url} license={null} attribution={null} title={book.title} size="card" decorative loading="lazy" />
      {urgency && <UrgencyChip label={urgency} className={classes.urgency} data-offer-urgency />}
      {cue && <p className={classes.cue}>{cue}</p>}
      <Tooltip label={favoriteLabel} events={{ hover: true, focus: true, touch: false }} position="top" multiline maw="calc(100vw - 32px)" withArrow>
        <ActionIcon type="button" size={40} radius="xl" variant="transparent" className={classes.favorite}
          aria-label={`${favoriteLabel}: ${book.title}`} aria-pressed={selected} aria-busy={favorite.state === "pending" || undefined}
          aria-describedby={reason ? `${uid}-reason` : undefined}
          disabled={!("onPress" in favorite) && favorite.state !== "pending"} aria-disabled={favorite.state === "pending" || undefined}
          onClick={"onPress" in favorite ? favorite.onPress : undefined} data-bookcard-favorite>
          <MaterialSymbol name={selected ? "favorite" : "favorite_border"} fill={selected} size={20} />
        </ActionIcon>
      </Tooltip>
    </div>

    <div className={classes.identity}>
      {/* The card's one link: its hit area covers the card; only the heart sits above it; "Ver oferta" is part of it. */}
      <Link id={`${uid}-edition-link`} to={detailHref} state={bookCardNavigationState(book, true, media)} onClick={onOpen} className={classes.link}
        aria-label={`Ver edición: ${book.title}. ${book.publisher}, ${book.editionLabel}`} aria-describedby={`${uid}-price`} data-bookcard-link>
        <h3 className={classes.title}>{book.title}</h3>
      </Link>
    </div>

    <div className={classes.pricing}>
      <p className={classes.price} id={`${uid}-price`} data-bookcard-price>{book.priceLabel}</p>
      {book.originalPriceLabel && <p className={classes.was}><span className="visually-hidden">Precio anterior </span><s>{book.originalPriceLabel}</s></p>}
      {book.discountLabel && <SavingsChip amountLabel={book.discountLabel} />}
      {!book.available && <p className={classes.unavailable}>Sin existencias</p>}
    </div>

    {/* A visual cue only: the card's link already covers it, so it adds no second stop for the same edition. */}
    <div className={classes.more}>
      <span className={classes.action} aria-hidden="true">Ver oferta<MaterialSymbol name="arrow_forward" size={18} /></span>
    </div>

    <div className={classes.feedbackRow}>
      {reason && <p className={classes.feedback} id={`${uid}-reason`}>{reason}</p>}
      {feedback && <p className={classes.feedback} role={feedback.kind === "error" ? "alert" : "status"} aria-atomic="true" data-bookcard-feedback>{feedback.message}</p>}
    </div>

  </article>;
}
