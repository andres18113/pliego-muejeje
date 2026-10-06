import { afterEach, describe, expect, it, vi } from "vitest";
import { logoutSession, refreshSession } from "./auth";

let releasePending: (() => void) | undefined;
afterEach(async () => {
  releasePending?.();
  releasePending = undefined;
  await vi.advanceTimersByTimeAsync(0);
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

function immediateLock() {
  vi.stubGlobal("navigator", { locks: { request: (_name: string, _options: LockOptions, operation: () => Promise<unknown>) => operation() } });
}

function stalledFetch() {
  let signal: AbortSignal | undefined;
  const fetch = vi.fn((request: Request) => {
    signal = request.signal;
    return new Promise<Response>((_resolve, reject) => {
      releasePending = () => reject(new DOMException("Test cleanup", "AbortError"));
      request.signal.addEventListener("abort", () => reject(request.signal.reason), { once: true });
    });
  });
  vi.stubGlobal("fetch", fetch);
  return { fetch, signal: () => signal };
}

describe("bounded session restoration", () => {
  it("aborts a stalled refresh, deduplicates concurrent restores and permits a fresh retry", async () => {
    vi.useFakeTimers();
    immediateLock();
    const transport = stalledFetch();
    const outcomes: unknown[] = [];
    const first = refreshSession().catch(error => { outcomes.push(error); });
    const concurrent = refreshSession().catch(error => { outcomes.push(error); });
    await vi.advanceTimersByTimeAsync(0);
    expect(transport.fetch).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(10_000);
    expect(outcomes).toHaveLength(2);
    expect(outcomes[0]).toMatchObject({ name: "TimeoutError" });
    expect(transport.signal()?.aborted).toBe(true);
    await Promise.all([first, concurrent]);

    transport.fetch.mockResolvedValueOnce(new Response(null, { status: 204 }));
    await expect(refreshSession()).resolves.toBeNull();
    expect(transport.fetch).toHaveBeenCalledTimes(2);
  });

  it("cancels a queued cross-tab session lock before making a refresh request", async () => {
    vi.useFakeTimers();
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    vi.stubGlobal("navigator", { locks: { request: (_name: string, options: LockOptions) => new Promise((_resolve, reject) => {
      releasePending = () => reject(new DOMException("Test cleanup", "AbortError"));
      options.signal?.addEventListener("abort", () => reject(options.signal?.reason), { once: true });
    }) } });
    let failure: unknown;
    const restore = refreshSession().catch(error => { failure = error; });
    await vi.advanceTimersByTimeAsync(10_000);
    expect(failure).toMatchObject({ name: "TimeoutError" });
    expect(fetch).not.toHaveBeenCalled();
    await restore;
  });

  it("also aborts a stalled logout so it cannot hold the shared session lock forever", async () => {
    vi.useFakeTimers();
    immediateLock();
    const transport = stalledFetch();
    let failure: unknown;
    const logout = logoutSession().catch(error => { failure = error; });
    await vi.advanceTimersByTimeAsync(10_000);
    expect(failure).toMatchObject({ name: "TimeoutError" });
    expect(transport.signal()?.aborted).toBe(true);
    await logout;
  });
});
