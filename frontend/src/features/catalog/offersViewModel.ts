import type { OfferSummary } from "@/shared/api/catalog";
import { formatUsd } from "./formatters";

/** Presentation of server decisions: no price arithmetic, expiration, filtering or sorting. */
export function toOfferViewModel(offer: OfferSummary) {
  return {
    originalPriceLabel: formatUsd(offer.originalPrice), effectivePriceLabel: formatUsd(offer.effectivePrice), discountLabel: formatUsd(offer.savingsAmount), savingsPercent: offer.savingsPercent,
    remainingLabel: offer.daysRemaining === 0 ? "Termina hoy" : offer.daysRemaining === 1 ? "Queda 1 día" : `Quedan ${offer.daysRemaining} días`,
    endingSoon: offer.endingSoon, endsAt: offer.endsAt,
    endsLabel: formatOfferEnd(offer.endsAt), offerCopy: offer.offerCopy ?? null, terms: offer.terms ?? null,
  };
}

function formatOfferEnd(value: string) {
  // Preserve the API's Ecuador offset when formatting its date; browser timezone never changes it.
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}:\d{2})(?::\d{2}(?:\.\d+)?)?(Z|[+-]\d{2}:\d{2})$/.exec(value);
  return match ? `${match[3]}/${match[2]}/${match[1]}, ${match[4]} UTC${match[5] === "Z" ? "+00:00" : match[5]}` : value;
}
