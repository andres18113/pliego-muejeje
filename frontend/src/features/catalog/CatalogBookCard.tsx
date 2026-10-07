import { useState, type MouseEventHandler } from "react";
import type { QueryKey } from "@tanstack/react-query";
import { BookCard } from "./BookCard";
import { toBookCardData, bookCardNavigationState, type BookCardEditionSource, type BookCardFeedback } from "./bookCardModel";
import { useFavoriteControl, useCartControl } from "./useBookCardActions";
import { mediaOfFormat, type CatalogMedia } from "./catalogMedia";

type CatalogBookCardProps = {
  edition: BookCardEditionSource; detailHref: string; returnHref: string; isFavorite: boolean; favoriteReady: boolean;
  favoriteQueryKey: QueryKey; catalogReturn?: boolean; showEdition?: boolean;
  /** The catalog's browse card: no cart action (buying happens on the edition page), favorite on the cover stage. */
  media?: CatalogMedia;
  onOpen?: MouseEventHandler<HTMLAnchorElement>;
};

export function CatalogBookCard(props: CatalogBookCardProps) {
  return props.media ? <BrowseBookCard {...props} /> : <PurchasableBookCard {...props} />;
}

function BrowseBookCard({ edition, detailHref, returnHref, isFavorite, favoriteReady, favoriteQueryKey, catalogReturn = false, showEdition = false, media, onOpen }: CatalogBookCardProps) {
  const [feedback, setFeedback] = useState<BookCardFeedback | null>(null);
  const book = toBookCardData(edition);
  const favorite = useFavoriteControl({ editionId: book.id, isFavorite, ready: favoriteReady, queryKey: favoriteQueryKey, returnHref, onFeedback: setFeedback });
  return <BookCard book={book} to={detailHref} navigationState={bookCardNavigationState(book, catalogReturn, mediaOfFormat(edition.format))} onNavigate={onOpen} favorite={favorite} feedback={feedback} showEdition={showEdition} media={media} />;
}

function PurchasableBookCard({ edition, detailHref, returnHref, isFavorite, favoriteReady, favoriteQueryKey, catalogReturn = false, showEdition = false, onOpen }: CatalogBookCardProps) {
  const [feedback, setFeedback] = useState<BookCardFeedback | null>(null);
  const book = toBookCardData(edition);
  const favorite = useFavoriteControl({ editionId: book.id, isFavorite, ready: favoriteReady, queryKey: favoriteQueryKey, returnHref, onFeedback: setFeedback });
  const cart = useCartControl({ editionId: book.id, available: book.available, format: edition.format, returnHref, onFeedback: setFeedback });
  return <BookCard book={book} to={detailHref} navigationState={bookCardNavigationState(book, catalogReturn, mediaOfFormat(edition.format))} onNavigate={onOpen} favorite={favorite} cart={cart} feedback={feedback} showEdition={showEdition} />;
}
