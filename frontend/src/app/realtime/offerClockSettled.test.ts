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

  describe("index.html's early request", () => {
    afterEach(() => { delete window.__pliegoOfferClock; });

    it("is adopted with the moment it arrived instead of asking again, and settles the clock", async () => {
      window.__pliegoOfferClock = Promise.resolve({ ok: true, status: 200, body: JSON.stringify(clockBody), receivedAt: 1234.5 });
      const { primeOfferRefreshClock, offerClockSettled } = await import("./offerRefresh");
      await expect(primeOfferRefreshClock()).resolves.toEqual({ clock: clockBody, receivedAt: 1234.5 });
      await offerClockSettled();
      expect(fetch).not.toHaveBeenCalled();
      expect(window.__pliegoOfferClock).toBeUndefined();
    });

    it("is asked again from the bundle when the early request never arrived", async () => {
      window.__pliegoOfferClock = Promise.resolve(null);
      const { primeOfferRefreshClock, offerClockSettled } = await import("./offerRefresh");
      primeOfferRefreshClock();
      const settled = vi.fn();
      void offerClockSettled().then(settled);
      await flush();
      expect(fetch).toHaveBeenCalledTimes(1);
      expect(fetch).toHaveBeenCalledWith(expect.stringContaining("/api/v1/catalog/offer-refresh"), expect.objectContaining({ credentials: "omit", cache: "no-store" }));
      expect(settled).not.toHaveBeenCalled();
      answer!(new Response(JSON.stringify(clockBody), { status: 200 }));
      await flush();
      expect(settled).toHaveBeenCalledTimes(1);
    });

    it("settles without a clock when the early answer is a problem, exactly as a failed bundle request", async () => {
      window.__pliegoOfferClock = Promise.resolve({ ok: false, status: 503, body: JSON.stringify({ code: "DATABASE_ERROR", title: "Servicio no disponible", detail: "Inténtalo otra vez." }), receivedAt: 10 });
      const { primeOfferRefreshClock, offerClockSettled, isOfferClockSettled } = await import("./offerRefresh");
      await expect(primeOfferRefreshClock()).rejects.toMatchObject({ status: 503 });
      await offerClockSettled();
      expect(isOfferClockSettled()).toBe(true);
      expect(fetch).not.toHaveBeenCalled();
    });
  });
});
