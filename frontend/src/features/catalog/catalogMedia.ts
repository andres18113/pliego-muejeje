import type { CatalogCriteria } from "./catalogUrl";

/**
 * PLIEGO sells three media through one commerce system. They share layout, type, controls and
 * behavior; each brings its own stage color behind the covers: Libros a warm paper gray, eBooks
 * lavender, Audiolibros pale yellow. The medium is a fact of the edition (its format) or of the
 * collection being browsed (the `productType` criterion) — never a per-route style.
 */
export type CatalogMedia = "physical" | "ebook" | "audiobook";

export function mediaOfProductType(productType: CatalogCriteria["productType"]): CatalogMedia | null {
  return productType === "PHYSICAL" ? "physical" : productType === "EBOOK" ? "ebook" : productType === "AUDIOBOOK" ? "audiobook" : null;
}

export function mediaOfFormat(format: string | null | undefined): CatalogMedia {
  return format === "EBOOK" ? "ebook" : format === "AUDIOBOOK" ? "audiobook" : "physical";
}

export function mediaTitle(media: CatalogMedia | null) {
  return media === "physical" ? "Libros" : media === "ebook" ? "eBooks" : media === "audiobook" ? "Audiolibros" : "Todos los libros";
}
