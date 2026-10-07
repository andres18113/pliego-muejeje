import type { MouseEventHandler } from "react";
import type { To } from "react-router-dom";
import type { EditionSummary } from "@/shared/api/catalog";
import { resolveStockStatus, type StockAvailability } from "./stockStatusModel";
import { formatAuthorNames, formatEdition, formatLanguage, formatUsd } from "./formatters";
import type { CatalogMedia } from "./catalogMedia";
import { toOfferViewModel } from "./offersViewModel";

export type BookCardEditionSource = Pick<EditionSummary, "editionId" | "title" | "authors" | "publisher" | "format" | "language" | "price" | "available" | "coverUrl" | "coverLicense" | "coverAttribution" | "offer">;
export interface BookCardData {
  id: string;
  title: string;
  authors: string;
  publisher: string;
  editionLabel: string;
  priceLabel: string;
  originalPriceLabel?: string;
  discountLabel?: string;
  offer?: ReturnType<typeof toOfferViewModel>;
  available: boolean;
  cover: { url: string | null; license: string | null; attribution: string | null };
}
export type FavoriteControl =
  | { state: "ready"; selected: boolean; onPress: () => void }
  | { state: "pending"; selected?: boolean; label?: string }
  | { state: "unconfirmed" | "restricted"; reason: string }
  | { state: "uncertain"; reason: string; onPress: () => void };
export type CartControl =
  | { state: "ready" | "success"; onPress: () => void }
  | { state: "pending" }
  | { state: "restricted"; reason: string }
  | { state: "uncertain"; recoveryTo: To };
export interface BookCardFeedback { kind: "success" | "error"; message: string }
/** What the edition page can show at once while its record loads; `media` is the edition's own medium. */
export interface CoverPreview { editionId: string; url: string | null; license: string | null; attribution: string | null; title: string; media?: CatalogMedia }
export interface BookCardProps {
  book: BookCardData;
  to: To;
  navigationState?: { catalogReturn?: boolean; coverPreview?: CoverPreview };
  onNavigate?: MouseEventHandler<HTMLAnchorElement>;
  favorite: FavoriteControl;
  /** Omitted on the catalog's browse card: buying happens on the edition page. */
  cart?: CartControl;
  feedback?: BookCardFeedback | null;
  headingOrder?: 3 | 4;
  /** Shows the edition line (format and language) under the authors, where the media type is part of the reading. */
  showEdition?: boolean;
  /**
   * The commerce presentation (catalog shelves): the cover stands on a stage in its medium's color and
   * the identity, price and stock read on the page below it. Without it the card keeps the bounded
   * scene used by Ofertas and the diagnostics.
   */
  media?: CatalogMedia;
  className?: string;
}

export function toBookCardData(edition: BookCardEditionSource): BookCardData {
  return { id: edition.editionId, title: edition.title, authors: formatAuthorNames(edition.authors), publisher: edition.publisher,
    editionLabel: `${formatEdition(edition.format)} · ${formatLanguage(edition.language)}`,
    priceLabel: formatUsd(edition.price), available: edition.available,
    ...(edition.offer ? { originalPriceLabel: formatUsd(edition.offer.originalPrice), discountLabel: formatUsd(edition.offer.savingsAmount), offer: toOfferViewModel(edition.offer) } : {}),
    cover: { url: edition.coverUrl, license: edition.coverLicense, attribution: edition.coverAttribution } };
}

export function bookCardNavigationState(book: BookCardData, catalogReturn = false, media?: CatalogMedia) {
  return { ...(catalogReturn ? { catalogReturn: true } : {}), coverPreview: {
    editionId: book.id, url: book.cover.url, license: book.cover.license, attribution: book.cover.attribution, title: book.title,
    ...(media ? { media } : {}),
  } };
}

export function favoriteActionLabel(control: FavoriteControl) {
  if (control.state === "uncertain") return "Consultar favorito";
  if (control.state === "pending") return control.label ?? "Guardando favorito…";
  if (control.state === "unconfirmed") return "Favoritos sin confirmar";
  return control.state === "ready" && control.selected ? "Quitar de favoritos" : "Agregar a favoritos";
}

/** Presentation varies by surface; stock eligibility and action state are interpreted once. */
export function resolveCartAction(availability: StockAvailability, cart: CartControl, appearance: "card" | "row" | "scene" = "card") {
  const stock = resolveStockStatus(availability);
  const unavailable = !stock.canAddToCart;
  const idleText = appearance === "card" ? "Agregar" : "Agregar al carrito";
  const text = unavailable ? (appearance === "row" ? stock.label : idleText)
    : cart.state === "pending" ? "Agregando…"
    : cart.state === "success" ? (appearance === "scene" ? "Agregado al carrito" : "Agregado")
    : cart.state === "uncertain" ? (appearance === "scene" ? "Consulta el carrito" : "Sin confirmar") : idleText;
  const label = unavailable ? (appearance === "row" ? stock.label : "Agregar al carrito")
    : cart.state === "pending" ? text
    : cart.state === "success" ? "Agregado al carrito. Agregar otra unidad"
    : cart.state === "uncertain" ? `${text}. Consulta el carrito antes de reintentar` : "Agregar al carrito";
  const icon = unavailable ? "shopping_cart_off" : cart.state === "success" ? "check" : cart.state === "pending" ? "schedule" : cart.state === "uncertain" ? "info" : "add_shopping_cart";
  return { text, label, icon, unavailable, enabled: stock.canAddToCart && "onPress" in cart, busy: cart.state === "pending" } as const;
}
