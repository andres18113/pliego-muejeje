import { orderDateLabel } from "@/features/purchase/purchaseText";
import type { MaterialSymbolName } from "@/shared/ui/MaterialSymbol";
import type { OwnedItemViewModel } from "./libraryViewModel";

/** Presentation only: how server values read on the page. Ownership, states and actions stay in the view model. */
export const acquiredDateLabel = orderDateLabel;

export function mediaSymbol(productType: OwnedItemViewModel["productType"]): MaterialSymbolName {
  return productType === "EBOOK" ? "mobile" : "headphones";
}

export function durationLabel(seconds: number) {
  const minutes = Math.round(seconds / 60);
  if (minutes < 1) return "Menos de 1 min";
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return hours === 0 ? `${rest} min` : rest === 0 ? `${hours} h` : `${hours} h ${rest} min`;
}

/** Publication dates are calendar days: formatted in UTC so the day never shifts with the reader's zone. */
export function publicationDateLabel(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isNaN(date.valueOf()) ? value : new Intl.DateTimeFormat("es-EC", { dateStyle: "long", timeZone: "UTC" }).format(date);
}

export function languageLabel(value: string) {
  if (!/^[a-z]{2,3}(-[A-Za-z]{2,4})?$/.test(value)) return value;
  try {
    const name = new Intl.DisplayNames(["es"], { type: "language", fallback: "none" }).of(value);
    return name ? name.charAt(0).toUpperCase() + name.slice(1) : value;
  } catch {
    return value;
  }
}

/** The view model decides which facts exist and their order; this only makes their values readable. */
export function editionFacts(item: OwnedItemViewModel) {
  return item.bibliographicMetadata.map(row => {
    if (row.label === "Idioma") return { label: row.label, value: languageLabel(row.value) };
    if (row.label === "Publicación") return { label: row.label, value: publicationDateLabel(row.value) };
    if (row.label === "Formato bibliográfico") return { label: "Formato", value: row.value };
    if (row.label === "Duración (segundos)" && item.metadata.audioDurationSeconds !== null) return { label: "Duración", value: durationLabel(item.metadata.audioDurationSeconds) };
    return row;
  });
}

export function titlesCountLabel(totalCount: string) {
  return totalCount === "1" ? "1 título" : `${totalCount} títulos`;
}
