import { z } from "zod";
import type { components } from "./generated";

/** Why an edition cannot be bought, as the catalog and favorites reads state it (the database decides; never derived here). */
export type EditionUnavailabilityReason = NonNullable<components["schemas"]["CatalogEditionDetailResponse"]["unavailabilityReason"]>;
export const editionUnavailabilityReasons = ["OUT_OF_STOCK", "P2042", "P2043"] as const satisfies readonly EditionUnavailabilityReason[];
/** A reason this client does not know, or a server that does not send one yet, reads as no reason: plain "No disponible". */
export const editionUnavailabilityReasonSchema = z.enum(editionUnavailabilityReasons).nullable().optional().catch(null);

/** Canonical read reasons supplied by the cart and catalog APIs; no stock rules are derived here. */
export type StockUnavailabilityReason = NonNullable<components["schemas"]["CartItem"]["unavailabilityReason"]> | EditionUnavailabilityReason | "P4004";
export const stockUnavailabilityReasons = ["P2043", "P2042", "P3002", "P4004"] as const satisfies readonly StockUnavailabilityReason[];

export interface StockAvailability {
  available: boolean;
  unavailabilityReason?: StockUnavailabilityReason | null;
}
