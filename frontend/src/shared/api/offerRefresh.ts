import { z } from "zod";
import { apiUrl } from "./client";
import { OFFER_REFRESH_PATH, OFFER_REFRESH_REQUEST } from "./offerRefreshRequest";
import { ApiRequestError, toApiRequestError } from "./errors";
import type { components } from "./generated";

const timestamp = z.string().datetime({ offset: true }).refine(value => Number.isFinite(Date.parse(value)));
export type OfferRefreshClock = components["schemas"]["OfferRefreshResponse"];

const clockSchema: z.ZodType<OfferRefreshClock> = z.object({
  serverTime: timestamp,
  nextTransitionAt: timestamp.nullable(),
  revalidateAfterSeconds: z.number().int().positive().max(300),
});

/** An answer to the clock request as text, so the bundle and index.html's early request share one reading of it. */
export interface OfferRefreshAnswer { ok: boolean; status: number; body: string }

/** Reads one answer: a problem becomes an ApiRequestError (Spanish feedback), an incomplete clock a 502. */
export function readOfferRefreshAnswer({ ok, status, body }: OfferRefreshAnswer): OfferRefreshClock {
  let data: unknown;
  try { data = JSON.parse(body); } catch { data = undefined; }
  if (!ok) throw toApiRequestError(status, data, "No pudimos actualizar las ofertas", "Revisa tu conexión e inténtalo otra vez.");
  const parsed = clockSchema.safeParse(data);
  if (!parsed.success) throw new ApiRequestError(502, "INVALID_OFFER_REFRESH_RESPONSE", "Ofertas no disponibles", "Recibimos una respuesta incompleta.");
  return parsed.data;
}

/** A public timing hint. Prices and offer validity always come from fresh REST projections. */
export async function getOfferRefreshClock(signal?: AbortSignal): Promise<OfferRefreshClock> {
  const response = await fetch(apiUrl(OFFER_REFRESH_PATH), { signal, ...OFFER_REFRESH_REQUEST });
  const body = await response.text().catch(() => "");
  return readOfferRefreshAnswer({ ok: response.ok, status: response.status, body });
}
