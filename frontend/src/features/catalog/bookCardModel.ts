import type { MouseEventHandler } from "react";
import type { To } from "react-router-dom";
import type { EditionSummary } from "@/shared/api/catalog";
import { formatEdition, formatLanguage, formatUsd } from "./formatters";

export type BookCardEditionSource = Pick<EditionSummary, "editionId" | "title" | "authors" | "publisher" | "format" | "language" | "price" | "available" | "coverUrl" | "coverLicense" | "coverAttribution">;
export interface BookCardData {
  id: string;
  title: string;
  authors: string;
  publisher: string;
  editionLabel: string;
  priceLabel: string;
  available: boolean;
  cover: { url: string | null; license: string | null; attribution: string | null };
}
export type FavoriteControl =
  | { state: "ready"; selected: boolean; onPress: () => void }
  | { state: "pending"; selected: boolean }
  | { state: "unconfirmed" | "restricted"; reason: string };
export type CartControl =
  | { state: "ready" | "success"; onPress: () => void }
  | { state: "pending" }
  | { state: "restricted"; reason: string }
  | { state: "uncertain"; recoveryTo: To };
export interface BookCardFeedback { kind: "success" | "error"; message: string }
export interface CoverPreview { editionId: string; url: string | null; license: string | null; attribution: string | null; title: string }
export interface BookCardProps {
  book: BookCardData;
  to: To;
  navigationState?: { catalogReturn?: boolean; coverPreview?: CoverPreview };
  onNavigate?: MouseEventHandler<HTMLAnchorElement>;
  favorite: FavoriteControl;
  cart: CartControl;
  feedback?: BookCardFeedback | null;
  headingOrder?: 3 | 4;
  className?: string;
}

export function toBookCardData(edition: BookCardEditionSource): BookCardData {
  return { id: edition.editionId, title: edition.title, authors: edition.authors, publisher: edition.publisher,
    editionLabel: `${formatEdition(edition.format)} · ${formatLanguage(edition.language)}`,
    priceLabel: formatUsd(edition.price), available: edition.available,
    cover: { url: edition.coverUrl, license: edition.coverLicense, attribution: edition.coverAttribution } };
}

export function bookCardNavigationState(book: BookCardData, catalogReturn = false) {
  return { ...(catalogReturn ? { catalogReturn: true } : {}), coverPreview: {
    editionId: book.id, url: book.cover.url, license: book.cover.license, attribution: book.cover.attribution, title: book.title,
  } };
}

export function favoriteActionLabel(control: FavoriteControl) {
  if (control.state === "pending") return "Guardando favorito…";
  if (control.state === "unconfirmed") return "Favoritos sin confirmar";
  return control.state === "ready" && control.selected ? "Quitar de favoritos" : "Agregar a favoritos";
}
