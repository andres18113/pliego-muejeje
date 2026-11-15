import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// ADR 0058: reads that carry prices and start before the session restore (the storefront projection) wait until the
// server has answered the first offer clock request, so they can never be observed before it.
describe("offerClockSettled", () => {
  let answer: ((response: Response) => void) | null;
  let fail: ((error: Error) => void) | null;

  beforeEach(() => {
    vi.resetModules();
    answer = null; fail = null;
    vi.stubGlobal("fetch", vi.fn(() => new Promise<Response>((resolve, reject) => { answer = resolve; fail = reject; })));
  });
  afterEach(() => { vi.unstubAllGlobals(); });

  const flush = () => new Promise(resolve => setTimeout(resolve, 0));
  const clockBody = { serverTime: "2026-11-15T12:00:00Z", nextTransitionAt: null, revalidateAfterSeconds: 60 };

  it("stays pending while the first clock request is in flight, then settles once it is answered", async () => {
    const { primeOfferRefreshClock, offerClockSettled } = await import("./offerRefresh");
    primeOfferRefreshClock();
    const settled = vi.fn();
    void offerClockSettled().then(settled);
    await flush();
    expect(settled).not.toHaveBeenCalled();

    answer!(new Response(JSON.stringify(clockBody), { status: 200, headers: { "Content-Type": "application/json" } }));
    await flush();
    expect(settled).toHaveBeenCalledTimes(1);
  });

  it("also settles when the clock request fails, so public reads are never blocked by it", async () => {
    const { primeOfferRefreshClock, offerClockSettled } = await import("./offerRefresh");
    primeOfferRefreshClock();
    const settled = vi.fn();
    void offerClockSettled().then(settled);
    fail!(new TypeError("network"));
    await flush();
    expect(settled).toHaveBeenCalledTimes(1);
  });
});
