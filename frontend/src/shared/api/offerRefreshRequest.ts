/**
 * The one way the offer clock is requested (ADR 0058): public, never cached, never with credentials. Shared by the
 * bundle and by the build, which inlines the same request into index.html (build/earlyOfferClock.ts) so it starts
 * while the entry code is still downloading. Dependency-free for that reason.
 */
export const OFFER_REFRESH_PATH = "/api/v1/catalog/offer-refresh";
export const OFFER_REFRESH_REQUEST = {
  cache: "no-store",
  credentials: "omit",
  headers: { Accept: "application/json, application/problem+json" },
} as const satisfies RequestInit;

/** What index.html's early request leaves on `window.__pliegoOfferClock`: the answer as text, or null if it never arrived. */
export interface EarlyOfferClockAnswer { ok: boolean; status: number; body: string; receivedAt: number }
