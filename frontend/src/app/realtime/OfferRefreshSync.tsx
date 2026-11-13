import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { initialOfferClock, invalidateOfferPriceViews, nextOfferCheckDelay, OFFER_REFRESH_RETRY_MS, readTimedOfferClock, type TimedClock } from "./offerRefresh";

/**
 * Keeps every open page's offers and prices current without a reload, for guests and signed-in customers alike
 * (ADR 0058). It renders nothing: at the next offer start or end the server named — or when that answer changes
 * because an administrator edited an offer — the mounted price views re-read, with no toast or motion. A hidden tab
 * does not ask; it checks once when it is shown again, and again when the connection returns.
 */
export function OfferRefreshSync() {
  const queryClient = useQueryClient();
  useEffect(() => {
    let disposed = false;
    let known: string | null | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let current: AbortController | null = null;
    let due = false;

    const schedule = (ms: number) => { clearTimeout(timer); timer = setTimeout(() => void check(), ms); };
    const observe = ({ clock, receivedAt }: TimedClock) => {
      if (disposed) return;
      // A passed boundary moves `nextTransitionAt`, and so does an administrative edit: either way, re-read prices.
      if (known !== undefined && known !== clock.nextTransitionAt) void invalidateOfferPriceViews(queryClient);
      known = clock.nextTransitionAt;
      schedule(nextOfferCheckDelay(clock, performance.now() - receivedAt));
    };
    async function check() {
      if (disposed) return;
      if (document.visibilityState === "hidden") { due = true; return; }
      due = false;
      current?.abort();
      const mine = new AbortController();
      current = mine;
      try {
        observe(await readTimedOfferClock(mine.signal));
      } catch {
        if (!mine.signal.aborted && !disposed) schedule(OFFER_REFRESH_RETRY_MS);
      }
    }

    initialOfferClock().then(observe, () => { if (!disposed) schedule(OFFER_REFRESH_RETRY_MS); });
    const onVisible = () => { if (document.visibilityState === "visible" && (due || known !== undefined)) void check(); };
    const onOnline = () => void check();
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("online", onOnline);
    return () => {
      disposed = true;
      clearTimeout(timer);
      current?.abort();
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("online", onOnline);
    };
  }, [queryClient]);
  return null;
}
