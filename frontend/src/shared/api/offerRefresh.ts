import { z } from "zod";
import { apiUrl } from "./client";
import { ApiRequestError, toApiRequestError } from "./errors";
import type { components } from "./generated";

const timestamp = z.string().datetime({ offset: true }).refine(value => Number.isFinite(Date.parse(value)));
export type OfferRefreshClock = components["schemas"]["OfferRefreshResponse"];

const clockSchema: z.ZodType<OfferRefreshClock> = z.object({
  serverTime: timestamp,
  nextTransitionAt: timestamp.nullable(),
  revalidateAfterSeconds: z.number().int().positive().max(300),
});

/** A public timing hint. Prices and offer validity always come from fresh REST projections. */
export async function getOfferRefreshClock(signal?: AbortSignal): Promise<OfferRefreshClock> {
  const response = await fetch(apiUrl("/api/v1/catalog/offer-refresh"), {
    signal, cache: "no-store", credentials: "omit", headers: { Accept: "application/json, application/problem+json" },
  });
  const data: unknown = await response.json().catch(() => undefined);
  if (!response.ok) throw toApiRequestError(response.status, data, "No pudimos actualizar las ofertas", "Revisa tu conexión e inténtalo otra vez.");
  const parsed = clockSchema.safeParse(data);
  if (!parsed.success) throw new ApiRequestError(502, "INVALID_OFFER_REFRESH_RESPONSE", "Ofertas no disponibles", "Recibimos una respuesta incompleta.");
  return parsed.data;
}
