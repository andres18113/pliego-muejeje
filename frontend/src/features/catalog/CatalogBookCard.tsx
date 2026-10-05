import { useState, type MouseEventHandler } from "react";
import type { QueryKey } from "@tanstack/react-query";
import { BookCard } from "./BookCard";
import { toBookCardData, bookCardNavigationState, type BookCardEditionSource, type BookCardFeedback } from "./bookCardModel";
import { useFavoriteControl, useCartControl } from "./useBookCardActions";

export function CatalogBookCard({ edition, detailHref, returnHref, isFavorite, favoriteReady, favoriteQueryKey, catalogReturn = false, onOpen }: {
  edition: BookCardEditionSource; detailHref: string; returnHref: string; isFavorite: boolean; favoriteReady: boolean;
  favoriteQueryKey: QueryKey; catalogReturn?: boolean; onOpen?: MouseEventHandler<HTMLAnchorElement>;
}) {
  const [feedback, setFeedback] = useState<BookCardFeedback | null>(null);
  const book = toBookCardData(edition);
  const favorite = useFavoriteControl({ editionId: book.id, isFavorite, ready: favoriteReady, queryKey: favoriteQueryKey, returnHref, onFeedback: setFeedback });
  const cart = useCartControl({ editionId: book.id, available: book.available, format: edition.format, returnHref, onFeedback: setFeedback });
  return <BookCard book={book} to={detailHref} navigationState={bookCardNavigationState(book, catalogReturn)} onNavigate={onOpen} favorite={favorite} cart={cart} feedback={feedback} />;
}
