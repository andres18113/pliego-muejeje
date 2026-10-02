import type { components } from "./generated";

/** Canonical read reasons supplied by the cart API; no stock rules are derived here. */
export type StockUnavailabilityReason = NonNullable<components["schemas"]["CartItem"]["unavailabilityReason"]>;
export const stockUnavailabilityReasons = ["P2043", "P2042", "P3002"] as const satisfies readonly StockUnavailabilityReason[];

export interface StockAvailability {
  available: boolean;
  unavailabilityReason?: StockUnavailabilityReason | null;
}
