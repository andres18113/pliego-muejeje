import type { QueryClient } from "@tanstack/react-query";
import { getOfferRefreshClock, type OfferRefreshClock } from "@/shared/api/offerRefresh";
import { isOfferPriceKey } from "./realtimeInvalidation";

/**
 * ADR 0058: when an open page must re-read its prices. The server's refresh clock names the next offer start or end
 * (`nextTransitionAt`) and an upper bound for asking again (`revalidateAfterSeconds`). Prices never come from here:
 * at a change the mounted price views simply re-read their REST resources, exactly as a reload would.
 */
export type TimedClock = { clock: OfferRefreshClock; receivedAt: number };

/** After a boundary, wait this long so the server's own clock is past it (offers are half-open `[start, end)`). */
const TRANSITION_MARGIN_MS = 500;
const MIN_DELAY_MS = 1_000;
const MAX_TIMER_MS = 2_147_483_647;
export const OFFER_REFRESH_RETRY_MS = 60_000;

/**
 * Milliseconds until the next check: the earlier of the next transition and the revalidation bound. The transition is
 * measured server-relative (`nextTransitionAt − serverTime`), never against the browser's wall clock, minus the time
 * already spent since the answer arrived. Clamped so it never loops at zero delay or overflows a timer.
 */
export function nextOfferCheckDelay(clock: OfferRefreshClock, elapsedSinceReceiptMs = 0) {
  const revalidate = clock.revalidateAfterSeconds * 1_000;
  const transition = clock.nextTransitionAt === null ? Number.POSITIVE_INFINITY
    : Date.parse(clock.nextTransitionAt) - Date.parse(clock.serverTime) + TRANSITION_MARGIN_MS;
  return Math.min(MAX_TIMER_MS, Math.max(MIN_DELAY_MS, Math.min(revalidate, transition) - elapsedSinceReceiptMs));
}

/** Re-reads every mounted price view (catalog, offers, edition, navigation counts, cart, saved, favorites); others go stale. */
export function invalidateOfferPriceViews(queryClient: QueryClient) {
  return queryClient.invalidateQueries({ predicate: query => isOfferPriceKey(query.queryKey) });
}

export async function readTimedOfferClock(signal?: AbortSignal): Promise<TimedClock> {
  const clock = await getOfferRefreshClock(signal);
  return { clock, receivedAt: performance.now() };
}

let primed: Promise<TimedClock> | null = null;

/**
 * Asks for the clock before the app renders, so the server observes it before any price read: a boundary after that
 * instant is then always the clock's `nextTransitionAt`, and a page can never keep a price read across an unseen change.
 */
export function primeOfferRefreshClock() {
  if (!primed) {
    const request = readTimedOfferClock();
    request.catch(() => undefined);
    primed = request;
  }
  return primed;
}

/** The primed answer for the first observer (shared by StrictMode's remount), else a fresh read. */
export function initialOfferClock() {
  const request = primed ?? readTimedOfferClock();
  void request.finally(() => { if (primed === request) primed = null; }).catch(() => undefined);
  return request;
}
