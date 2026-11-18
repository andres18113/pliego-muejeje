import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// ADR 0058: price views mount once the server has answered the offer clock — but a stalled clock never keeps the
// page from opening.
describe("useOfferClockSettled", () => {
  let answer: ((response: Response) => void) | null;

  beforeEach(() => {
    vi.resetModules();
    answer = null;
    vi.stubGlobal("fetch", vi.fn(() => new Promise<Response>(resolve => { answer = resolve; })));
  });
  afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

  const clockResponse = () => new Response(JSON.stringify({ serverTime: "2026-11-15T12:00:00Z", nextTransitionAt: null, revalidateAfterSeconds: 60 }), { status: 200, headers: { "Content-Type": "application/json" } });

  it("is settled at once when no clock was asked for", async () => {
    const { useOfferClockSettled } = await import("./useOfferClockSettled");
    expect(renderHook(() => useOfferClockSettled()).result.current).toBe(true);
  });

  it("waits for the first clock answer, then opens", async () => {
    const { primeOfferRefreshClock } = await import("./offerRefresh");
    const { useOfferClockSettled } = await import("./useOfferClockSettled");
    primeOfferRefreshClock();
    const { result } = renderHook(() => useOfferClockSettled());
    expect(result.current).toBe(false);
    await act(async () => { answer!(clockResponse()); await new Promise(resolve => setTimeout(resolve, 0)); });
    expect(result.current).toBe(true);
  });

  it("opens after its deadline when the clock never answers", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const { primeOfferRefreshClock } = await import("./offerRefresh");
    const { useOfferClockSettled } = await import("./useOfferClockSettled");
    primeOfferRefreshClock();
    const { result } = renderHook(() => useOfferClockSettled());
    act(() => { vi.advanceTimersByTime(2_999); });
    expect(result.current).toBe(false);
    act(() => { vi.advanceTimersByTime(1); });
    expect(result.current).toBe(true);
  });
});
