import { render } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { nextOfferCheckDelay } from "./offerRefresh";
import { OfferRefreshSync } from "./OfferRefreshSync";

const T = Date.parse("2026-11-05T17:21:50-05:00");
const iso = (ms: number) => new Date(ms).toISOString();
const clock = (serverMs: number, nextMs: number | null, revalidateAfterSeconds = 60) =>
  ({ serverTime: iso(serverMs), nextTransitionAt: nextMs === null ? null : iso(nextMs), revalidateAfterSeconds });

describe("nextOfferCheckDelay", () => {
  it("waits for the next transition measured on the server's clock, plus a small margin", () => {
    expect(nextOfferCheckDelay(clock(T, T + 5_000))).toBe(5_500);
  });

  it("never trusts the browser's wall clock", () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date("2031-01-01T00:00:00Z"));
    try { expect(nextOfferCheckDelay(clock(T, T + 5_000))).toBe(5_500); } finally { vi.useRealTimers(); }
  });

  it("is bounded by the revalidation interval, with or without a known transition", () => {
    expect(nextOfferCheckDelay(clock(T, null))).toBe(60_000);
    expect(nextOfferCheckDelay(clock(T, T + 86_400_000))).toBe(60_000);
  });

  it("subtracts the time already spent since the answer arrived and never loops at zero", () => {
    expect(nextOfferCheckDelay(clock(T, T + 5_000), 2_000)).toBe(3_500);
    expect(nextOfferCheckDelay(clock(T, T + 100), 10_000)).toBe(1_000);
  });
});

describe("OfferRefreshSync", () => {
  let answers: Array<() => Response>;
  let requests: number;
  let visibility: DocumentVisibilityState;

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    requests = 0; answers = []; visibility = "visible";
    vi.spyOn(document, "visibilityState", "get").mockImplementation(() => visibility);
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      expect(String(input)).toMatch(/\/api\/v1\/catalog\/offer-refresh$/);
      requests += 1;
      const next = answers.shift();
      if (!next) throw new Error("unexpected offer-refresh read");
      return next();
    }));
  });
  afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

  const json = (body: unknown, status = 200) => () => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
  function mount() {
    const client = new QueryClient();
    for (const key of [["public-catalog", "editions", 1], ["storefront-navigation"], ["customer-cart"], ["reference-countries"]]) client.setQueryData(key, 1);
    const view = render(<QueryClientProvider client={client}><OfferRefreshSync /></QueryClientProvider>);
    return { client, view, stale: (key: unknown[]) => client.getQueryState(key)?.isInvalidated };
  }
  const settle = async (ms = 0) => { await vi.advanceTimersByTimeAsync(ms); };

  it("re-reads the mounted price views right after an offer ends, and only then", async () => {
    answers.push(json(clock(T, T + 10_000)), json(clock(T + 10_500, T + 3_600_000)));
    const { stale } = mount();
    await settle();
    expect(requests).toBe(1);
    await settle(10_400);
    expect(requests).toBe(1);
    expect(stale(["public-catalog", "editions", 1])).toBe(false);
    await settle(200);
    expect(requests).toBe(2);
    expect(stale(["public-catalog", "editions", 1])).toBe(true);
    expect(stale(["storefront-navigation"])).toBe(true);
    expect(stale(["customer-cart"])).toBe(true);
    expect(stale(["reference-countries"])).toBe(false);
  });

  it("revalidates within the bound and stays quiet while nothing changed; an administrative edit re-reads prices", async () => {
    answers.push(json(clock(T, null)), json(clock(T + 60_000, null)), json(clock(T + 120_000, T + 900_000)));
    const { stale } = mount();
    await settle();
    await settle(60_000);
    expect(requests).toBe(2);
    expect(stale(["public-catalog", "editions", 1])).toBe(false);
    await settle(60_000);
    expect(requests).toBe(3);
    expect(stale(["public-catalog", "editions", 1])).toBe(true);
  });

  it("does not ask while the tab is hidden and checks once when it is shown", async () => {
    answers.push(json(clock(T, null)));
    mount();
    await settle();
    visibility = "hidden";
    await settle(180_000);
    expect(requests).toBe(1);
    answers.push(json(clock(T + 180_000, null)));
    visibility = "visible";
    document.dispatchEvent(new Event("visibilitychange"));
    await settle();
    expect(requests).toBe(2);
  });

  it("retries quietly after a failed read, renders nothing and stops when unmounted", async () => {
    answers.push(json({ title: "Error" }, 503), json(clock(T, null)));
    const { view } = mount();
    await settle();
    expect(view.container).toBeEmptyDOMElement();
    expect(requests).toBe(1);
    await settle(60_000);
    expect(requests).toBe(2);
    view.unmount();
    await settle(600_000);
    expect(requests).toBe(2);
  });
});
