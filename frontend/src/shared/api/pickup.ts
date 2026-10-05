import { z } from "zod";
import { apiClient } from "./client";
import { toApiRequestError } from "./errors";

const timeSchema = z.string().regex(/^\d{2}:\d{2}:\d{2}(?:\.\d+)?$/);
export const pickupLocationSchema = z.object({
  id: z.string().min(1), name: z.string().min(1), address: z.string().min(1),
  city: z.string(), province: z.string(), countryCode: z.string(), postalCode: z.string().nullable(),
  latitude: z.number().min(-90).max(90), longitude: z.number().min(-180).max(180),
  timezone: z.string().refine(value => {
    try { new Intl.DateTimeFormat("es-EC", { timeZone: value }); return true; } catch { return false; }
  }),
  openingHours: z.object({ opensAt: timeSchema, closesAt: timeSchema }),
  active: z.boolean(), preparationMinutes: z.number().int().nonnegative(),
});
export type PickupLocation = z.infer<typeof pickupLocationSchema>;

export const fulfillmentSchema = z.object({
  method: z.string(),
  pickup: z.object({
    location: pickupLocationSchema,
    estimatedAt: z.iso.datetime({ offset: true }), readyAt: z.iso.datetime({ offset: true }),
    preparationMinutes: z.number().int().nonnegative(), pickupCode: z.string().min(1),
  }).nullish(),
  state: z.string().nullish(), collectedAt: z.iso.datetime({ offset: true }).nullish(),
}).superRefine((value, context) => {
  if (value.method === "STORE_PICKUP" && !value.pickup) {
    context.addIssue({ code: "custom", path: ["pickup"], message: "Faltan los datos de retiro del pedido." });
  }
});
export type OrderPickup = NonNullable<z.infer<typeof fulfillmentSchema>["pickup"]>;

export const pickupLocationsQueryKey = ["pickup-locations"] as const;
export async function listPickupLocations(signal?: AbortSignal): Promise<PickupLocation[]> {
  const { data, error, response } = await apiClient.GET("/api/v1/pickup-locations", { signal });
  if (!response.ok) throw toApiRequestError(response.status, error, "No pudimos consultar los puntos de retiro", "Comprueba tu conexión e inténtalo otra vez.");
  const parsed = z.array(pickupLocationSchema).safeParse(data);
  if (!parsed.success) throw toApiRequestError(502, {}, "No pudimos consultar los puntos de retiro", "La respuesta del servidor está incompleta. Inténtalo otra vez.");
  return parsed.data;
}
