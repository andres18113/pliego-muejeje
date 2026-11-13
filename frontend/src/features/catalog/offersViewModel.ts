import type { OfferSummary } from "@/shared/api/catalog";
import { formatUsd } from "./formatters";

/**
 * Presentation of server decisions: no price arithmetic, expiration, filtering or sorting. A card reads the
 * offer as the Ofertas cards and the edition page do — today's price, the previous one struck, the saving,
 * and the days left only through `offerUrgencyLabel` (five or fewer) — so it carries just those values.
 */
export function toOfferViewModel(offer: OfferSummary) {
  return {
    originalPriceLabel: formatUsd(offer.originalPrice), effectivePriceLabel: formatUsd(offer.effectivePrice), discountLabel: formatUsd(offer.savingsAmount),
    daysRemaining: offer.daysRemaining,
  };
}
