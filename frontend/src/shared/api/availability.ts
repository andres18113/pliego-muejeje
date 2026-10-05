import type { components } from "./generated";

/** Canonical read reasons supplied by the cart API; no stock rules are derived here. */
export type StockUnavailabilityReason = NonNullable<components["schemas"]["CartItem"]["unavailabilityReason"]> | "P4004";
export const stockUnavailabilityReasons = ["P2043", "P2042", "P3002", "P4004"] as const satisfies readonly StockUnavailabilityReason[];

export interface StockAvailability {
  available: boolean;
  unavailabilityReason?: StockUnavailabilityReason | null;
}
