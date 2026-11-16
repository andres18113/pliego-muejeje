import { afterEach, describe, expect, it, vi } from "vitest";
import { getOfferRefreshClock } from "./offerRefresh";

const clock = { serverTime: "2026-11-04T12:00:00Z", nextTransitionAt: "2026-11-04T12:00:10Z", revalidateAfterSeconds: 60 };
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

afterEach(() => vi.unstubAllGlobals());

describe("public offer refresh clock", () => {
  it("fetches the public clock without caches or credentials and preserves the database's deadlines", async () => {
    const fetch = vi.fn(async () => json(clock));
    vi.stubGlobal("fetch", fetch);
    const signal = new AbortController().signal;

    await expect(getOfferRefreshClock(signal)).resolves.toEqual(clock);
    expect(fetch).toHaveBeenCalledWith(expect.stringContaining("/api/v1/catalog/offer-refresh"), expect.objectContaining({
      cache: "no-store", credentials: "omit", signal,
    }));
  });

  it("preserves a null deadline when no scheduled transition remains", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => json({ ...clock, nextTransitionAt: null })));
    await expect(getOfferRefreshClock()).resolves.toEqual({ ...clock, nextTransitionAt: null });
  });

  it.each([
    { serverTime: "wrong" }, { nextTransitionAt: "2026-11-04" }, { nextTransitionAt: undefined },
    { revalidateAfterSeconds: 0 }, { revalidateAfterSeconds: 1.5 }, { revalidateAfterSeconds: 301 },
  ])("rejects malformed server clock metadata (%j)", async patch => {
    vi.stubGlobal("fetch", vi.fn(async () => json({ ...clock, ...patch })));
    await expect(getOfferRefreshClock()).rejects.toMatchObject({ code: "INVALID_OFFER_REFRESH_RESPONSE" });
  });

  it("preserves the server's machine-readable failure", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => json({ code: "DATABASE_ERROR", title: "Servicio no disponible", detail: "Inténtalo otra vez." }, 503)));
    await expect(getOfferRefreshClock()).rejects.toMatchObject({ status: 503, code: "DATABASE_ERROR" });
  });
});
