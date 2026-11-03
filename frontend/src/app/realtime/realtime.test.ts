import { QueryClient } from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";
import { reconnectDelay, startRealtime, type RealtimeEnvironment } from "./realtimeConnection";
import { applyRealtimeHint, parseRealtimeHint, realtimeQueryKeys } from "./realtimeInvalidation";

class FakeSource {
  static CLOSED = 2;
  static instances: FakeSource[] = [];
  readyState = 0;
  listeners = new Map<string, ((event: MessageEvent) => void)[]>();
  onopen: (() => void) | null = null;
  onerror: (() => void) | null = null;
  closed = false;
  constructor(readonly url: string, readonly init?: EventSourceInit) { FakeSource.instances.push(this); }
  addEventListener(name: string, listener: (event: MessageEvent) => void) { this.listeners.set(name, [...this.listeners.get(name) ?? [], listener]); }
  emit(name: string, data: string) { for (const listener of this.listeners.get(name) ?? []) listener({ data } as MessageEvent); }
  close() { this.closed = true; this.readyState = 2; }
}

/** A same-process stand-in for BroadcastChannel: every channel with the name hears the others, never itself. */
function channelBus() {
  const channels: FakeChannel[] = [];
  class FakeChannel {
    onmessage: ((event: MessageEvent) => void) | null = null;
    constructor(readonly name: string) { channels.push(this); }
    postMessage(data: unknown) { for (const other of channels) if (other !== this && other.name === this.name) other.onmessage?.({ data } as MessageEvent); }
    close() { channels.splice(channels.indexOf(this), 1); }
  }
  return FakeChannel;
}

/** One exclusive lock per name, granted in request order, released when the holder's promise settles or on abort. */
function lockManager() {
  const held = new Set<string>();
  const queue: { name: string; run: () => void }[] = [];
  const next = () => {
    for (const waiting of [...queue]) if (!held.has(waiting.name)) { queue.splice(queue.indexOf(waiting), 1); waiting.run(); }
  };
  return {
    request(name: string, options: { signal?: AbortSignal }, callback: () => Promise<void>) {
      return new Promise<void>((resolve, reject) => {
        const entry = { name, run: () => { held.add(name); void callback().finally(() => { held.delete(name); resolve(); next(); }); } };
        options.signal?.addEventListener("abort", () => { const index = queue.indexOf(entry); if (index >= 0) { queue.splice(index, 1); reject(new DOMException("aborted", "AbortError")); } }, { once: true });
        queue.push(entry);
        next();
      });
    },
  } as unknown as LockManager;
}

function environment(overrides: Partial<RealtimeEnvironment> = {}) {
  const timers: { callback: () => void; ms: number }[] = [];
  const online: (() => void)[] = [];
  const env: RealtimeEnvironment = {
    EventSource: FakeSource as unknown as typeof EventSource,
    setTimeout: (callback, ms) => { const timer = { callback, ms }; timers.push(timer); return timer; },
    clearTimeout: handle => { const index = timers.indexOf(handle as typeof timers[number]); if (index >= 0) timers.splice(index, 1); },
    addOnline: listener => { online.push(listener); return () => online.splice(online.indexOf(listener), 1); },
    random: () => 0.5,
    ...overrides,
  };
  return { env, timers, online };
}

const flush = () => new Promise(resolve => setTimeout(resolve, 0));

describe("realtime hints", () => {
  it("accepts only known events with an internal numeric resource", () => {
    expect(parseRealtimeHint("order.changed", '{"resourceType":"order","resourceId":"42"}')).toEqual({ event: "order.changed", resourceType: "order", resourceId: "42" });
    expect(parseRealtimeHint("resync", '{"reason":"replay-unavailable"}')).toEqual({ event: "resync" });
    expect(parseRealtimeHint("order.changed", '{"resourceType":"order","resourceId":"../1"}')).toBeNull();
    expect(parseRealtimeHint("order.changed", "not json")).toBeNull();
    expect(parseRealtimeHint("order.deleted", '{"resourceType":"order","resourceId":"1"}')).toBeNull();
  });

  it("maps each hint to the views that own the resource, per role", () => {
    const decided = parseRealtimeHint("identity.correction.decided", '{"resourceType":"billingIdentity","resourceId":"7"}')!;
    expect(realtimeQueryKeys("CUSTOMER", decided)).toEqual([["customer-billing-identity"]]);
    expect(realtimeQueryKeys("ADMIN", decided)).toEqual([["admin-identity-corrections"]]);
    const acknowledged = { ...decided, event: "identity.correction.acknowledged" as const };
    expect(realtimeQueryKeys("ADMIN", acknowledged)).toEqual([]);
    const expired = parseRealtimeHint("order.cancellation-window.expired", '{"resourceType":"order","resourceId":"9"}')!;
    expect(realtimeQueryKeys("CUSTOMER", expired)).toContainEqual(["customer-order", "9"]);
    expect(realtimeQueryKeys("CUSTOMER", expired)).toContainEqual(["customer-orders"]);
    expect(realtimeQueryKeys("ADMIN", expired)).toEqual([["admin-pickups"], ["admin-pickup", "9"]]);
    const library = parseRealtimeHint("library.changed", '{"resourceType":"library","resourceId":"3"}')!;
    expect(realtimeQueryKeys("CUSTOMER", library)).toEqual([["customer-library"], ["customer-cart", "digital-eligibility"]]);
  });

  it("refetches only the concerned private views; resync refetches every private view and never the catalog", async () => {
    const client = new QueryClient();
    for (const key of [["customer-order", "9"], ["customer-order", "10"], ["customer-billing-identity"], ["public-catalog", "x"], ["admin-pickups"]]) client.setQueryData(key, 1);
    await applyRealtimeHint(client, "CUSTOMER", parseRealtimeHint("order.changed", '{"resourceType":"order","resourceId":"9"}')!);
    const stale = (key: string[]) => client.getQueryState(key)?.isInvalidated;
    expect(stale(["customer-order", "9"])).toBe(true);
    expect(stale(["customer-order", "10"])).toBe(false);
    expect(stale(["customer-billing-identity"])).toBe(false);
    await applyRealtimeHint(client, "CUSTOMER", { event: "resync" });
    expect(stale(["customer-order", "10"])).toBe(true);
    expect(stale(["customer-billing-identity"])).toBe(true);
    expect(stale(["admin-pickups"])).toBe(true);
    expect(stale(["public-catalog", "x"])).toBe(false);
  });
});

describe("realtime connection", () => {
  it("backs off from 3s to the 60s cap", () => {
    expect([0, 1, 2, 3, 4, 5, 9].map(attempt => reconnectDelay(attempt, () => 0.5))).toEqual([3000, 6000, 12000, 24000, 48000, 60000, 60000]);
  });

  it("opens one stream per browser, relays hints to the other tabs and hands over when the leader closes", async () => {
    FakeSource.instances = [];
    const Channel = channelBus() as unknown as typeof BroadcastChannel;
    const locks = lockManager();
    const first = vi.fn(), second = vi.fn();
    const stopFirst = startRealtime({ userId: "u1", url: "/api/v1/auth/events", onHint: first, env: environment({ BroadcastChannel: Channel, locks }).env });
    const stopSecond = startRealtime({ userId: "u1", url: "/api/v1/auth/events", onHint: second, env: environment({ BroadcastChannel: Channel, locks }).env });
    await flush();
    expect(FakeSource.instances).toHaveLength(1);
    expect(FakeSource.instances[0].init).toEqual({ withCredentials: true });
    FakeSource.instances[0].emit("identity.correction.decided", '{"resourceType":"billingIdentity","resourceId":"7"}');
    expect(first).toHaveBeenCalledWith({ event: "identity.correction.decided", resourceType: "billingIdentity", resourceId: "7" });
    expect(second).toHaveBeenCalledWith({ event: "identity.correction.decided", resourceType: "billingIdentity", resourceId: "7" });
    stopFirst();
    await flush();
    expect(FakeSource.instances[0].closed).toBe(true);
    expect(FakeSource.instances).toHaveLength(2);
    expect(FakeSource.instances[1].closed).toBe(false);
    stopSecond();
    await flush();
    expect(FakeSource.instances[1].closed).toBe(true);
  });

  it("ignores relayed hints for another account and malformed relays", async () => {
    FakeSource.instances = [];
    const Channel = channelBus() as unknown as typeof BroadcastChannel;
    const onHint = vi.fn();
    const stop = startRealtime({ userId: "u1", url: "/e", onHint, env: environment({ BroadcastChannel: Channel, locks: lockManager() }).env });
    const outsider = new Channel("pliego-realtime");
    outsider.postMessage({ kind: "pliego-realtime-hint", userId: "u2", hint: { event: "resync" } });
    outsider.postMessage({ kind: "pliego-realtime-hint", userId: "u1", hint: { event: "order.changed", resourceType: "order", resourceId: "x" } });
    expect(onHint).not.toHaveBeenCalled();
    outsider.postMessage({ kind: "pliego-realtime-hint", userId: "u1", hint: { event: "resync" } });
    expect(onHint).toHaveBeenCalledWith({ event: "resync" });
    stop();
  });

  it("reopens a refused stream with backoff, resets after it opens, and reconnects at once when back online", () => {
    FakeSource.instances = [];
    const { env, timers, online } = environment();
    const stop = startRealtime({ userId: "u1", url: "/e", onHint: vi.fn(), env });
    const refused = FakeSource.instances[0];
    refused.readyState = FakeSource.CLOSED;
    refused.onerror?.();
    expect(timers.map(timer => timer.ms)).toEqual([3000]);
    timers.shift()!.callback();
    expect(FakeSource.instances).toHaveLength(2);
    // A transient drop that the browser itself retries (still CONNECTING) is left to EventSource.
    FakeSource.instances[1].readyState = 0;
    FakeSource.instances[1].onerror?.();
    expect(timers).toHaveLength(0);
    FakeSource.instances[1].readyState = FakeSource.CLOSED;
    FakeSource.instances[1].onerror?.();
    expect(timers.map(timer => timer.ms)).toEqual([6000]);
    online[0]();
    expect(timers).toHaveLength(0);
    expect(FakeSource.instances).toHaveLength(3);
    FakeSource.instances[2].onopen?.();
    FakeSource.instances[2].readyState = FakeSource.CLOSED;
    FakeSource.instances[2].onerror?.();
    expect(timers.map(timer => timer.ms)).toEqual([3000]);
    stop();
    expect(timers).toHaveLength(0);
    expect(FakeSource.instances[2].closed).toBe(true);
  });
});
