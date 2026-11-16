import { QueryClient } from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";
import { reconnectDelay, revalidateInterval, startRealtime, type LifecycleEvent, type RealtimeEnvironment } from "./realtimeConnection";
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
  const listeners = new Map<LifecycleEvent, (() => void)[]>();
  let clock = 0;
  const env: RealtimeEnvironment = {
    EventSource: FakeSource as unknown as typeof EventSource,
    setTimeout: (callback, ms) => { const timer = { callback, ms }; timers.push(timer); return timer; },
    clearTimeout: handle => { const index = timers.indexOf(handle as typeof timers[number]); if (index >= 0) timers.splice(index, 1); },
    listen: (event, listener) => { listeners.set(event, [...listeners.get(event) ?? [], listener]); return () => listeners.set(event, (listeners.get(event) ?? []).filter(item => item !== listener)); },
    now: () => clock,
    random: () => 0.5,
    ...overrides,
  };
  const emit = (event: LifecycleEvent) => { for (const listener of listeners.get(event) ?? []) listener(); };
  const online = [() => emit("online")];
  return { env, timers, online, emit, advance: (ms: number) => { clock += ms; } };
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

  it("refetches only the concerned private views; resync refetches every private and price view, never other public data", async () => {
    const client = new QueryClient();
    for (const key of [["customer-order", "9"], ["customer-order", "10"], ["customer-billing-identity"], ["public-catalog", "x"], ["admin-pickups"], ["reference-countries"]]) client.setQueryData(key, 1);
    await applyRealtimeHint(client, "CUSTOMER", parseRealtimeHint("order.changed", '{"resourceType":"order","resourceId":"9"}')!);
    const stale = (key: string[]) => client.getQueryState(key)?.isInvalidated;
    expect(stale(["customer-order", "9"])).toBe(true);
    expect(stale(["customer-order", "10"])).toBe(false);
    expect(stale(["customer-billing-identity"])).toBe(false);
    await applyRealtimeHint(client, "CUSTOMER", { event: "resync" });
    expect(stale(["customer-order", "10"])).toBe(true);
    expect(stale(["customer-billing-identity"])).toBe(true);
    expect(stale(["admin-pickups"])).toBe(true);
    // ADR 0058: a missed offer hint leaves public prices stale too, so a resync re-reads them.
    expect(stale(["public-catalog", "x"])).toBe(true);
    expect(stale(["reference-countries"])).toBe(false);
  });

  it("maps the public offer hint to every price view for both roles, and nothing else", async () => {
    const hint = parseRealtimeHint("catalog.offers.changed", '{"resourceType":"edition","resourceId":"42"}')!;
    expect(hint).toEqual({ event: "catalog.offers.changed", resourceType: "edition", resourceId: "42" });
    const priceViews = [["public-catalog"], ["storefront-navigation"], ["customer-cart"], ["customer-saved-for-later"], ["customer-favorites"]];
    expect(realtimeQueryKeys("CUSTOMER", hint)).toEqual(priceViews);
    expect(realtimeQueryKeys("ADMIN", hint)).toEqual(priceViews);
    const client = new QueryClient();
    for (const key of [["public-catalog", "edition", "42"], ["storefront-navigation"], ["customer-cart"], ["customer-orders"], ["admin-pickups"]]) client.setQueryData(key, 1);
    await applyRealtimeHint(client, "CUSTOMER", hint);
    const stale = (key: string[]) => client.getQueryState(key)?.isInvalidated;
    expect(stale(["public-catalog", "edition", "42"])).toBe(true);
    expect(stale(["storefront-navigation"])).toBe(true);
    expect(stale(["customer-cart"])).toBe(true);
    expect(stale(["customer-orders"])).toBe(false);
    expect(stale(["admin-pickups"])).toBe(false);
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

describe("realtime stream URL", () => {
  // Production builds set VITE_API_BASE_URL to the bare origin; the stream must still carry /api/v1 (the session
  // cookie is scoped to /api/v1/auth). Appending to the raw variable once produced /auth/events in production.
  it.each([
    ["https://api.pliegolibros.com", "https://api.pliegolibros.com/api/v1/auth/events"],
    ["https://api.pliegolibros.com/", "https://api.pliegolibros.com/api/v1/auth/events"],
    ["https://api.pliegolibros.com/api/v1", "https://api.pliegolibros.com/api/v1/auth/events"],
    ["https://api.pliegolibros.com/api/v1/", "https://api.pliegolibros.com/api/v1/auth/events"],
    ["/api/v1", "/api/v1/auth/events"],
    [undefined, "/api/v1/auth/events"],
  ])("%s → %s", async (configured, expected) => {
    const { apiOriginFrom } = await import("@/shared/api/client");
    expect(`${apiOriginFrom(configured)}/api/v1/auth/events`).toBe(expected);
  });

  it("is built from the shared API origin, never by appending to the raw variable", async () => {
    const { realtimeEventsUrl } = await import("./RealtimeSync");
    const { apiUrl } = await import("@/shared/api/client");
    expect(realtimeEventsUrl).toBe(apiUrl("/api/v1/auth/events"));
    expect(realtimeEventsUrl.endsWith("/api/v1/auth/events")).toBe(true);
  });
});

describe("realtime leadership across the page lifecycle", () => {
  const open = () => FakeSource.instances.filter(source => !source.closed);

  it("never opens a stream in a waiting tab when the network returns (it is not the leader)", async () => {
    FakeSource.instances = [];
    const Channel = channelBus() as unknown as typeof BroadcastChannel;
    const locks = lockManager();
    const leader = environment({ BroadcastChannel: Channel, locks }), follower = environment({ BroadcastChannel: Channel, locks });
    const stopLeader = startRealtime({ userId: "u1", url: "/e", onHint: vi.fn(), env: leader.env });
    const stopFollower = startRealtime({ userId: "u1", url: "/e", onHint: vi.fn(), env: follower.env });
    await flush();
    expect(open()).toHaveLength(1);
    follower.emit("online");
    expect(open()).toHaveLength(1);
    stopLeader(); stopFollower();
  });

  it("hands the stream to a visible tab the moment the leader is frozen, and lets the frozen tab rejoin on resume", async () => {
    FakeSource.instances = [];
    const Channel = channelBus() as unknown as typeof BroadcastChannel;
    const locks = lockManager();
    const first = environment({ BroadcastChannel: Channel, locks }), second = environment({ BroadcastChannel: Channel, locks });
    const firstHints = vi.fn(), secondHints = vi.fn();
    const stopFirst = startRealtime({ userId: "u1", url: "/e", onHint: firstHints, env: first.env });
    const stopSecond = startRealtime({ userId: "u1", url: "/e", onHint: secondHints, env: second.env });
    await flush();
    const frozenLeader = FakeSource.instances[0];
    first.emit("freeze");
    await flush();
    // The frozen tab dropped its stream and lock; the other tab now leads and receives hints directly.
    expect(frozenLeader.closed).toBe(true);
    expect(open()).toHaveLength(1);
    open()[0].emit("identity.correction.decided", '{"resourceType":"billingIdentity","resourceId":"7"}');
    expect(secondHints).toHaveBeenCalledWith({ event: "identity.correction.decided", resourceType: "billingIdentity", resourceId: "7" });
    // On resume the first tab re-reads its views (it may have missed hints) and queues behind the current leader.
    first.emit("resume");
    await flush();
    expect(firstHints).toHaveBeenCalledWith({ event: "resync" });
    expect(open()).toHaveLength(1);
    stopSecond();
    await flush();
    expect(open()).toHaveLength(1);
    expect(open()[0]).not.toBe(frozenLeader);
    stopFirst();
  });

  it("yields on pagehide (back/forward cache) and leads again on pageshow", async () => {
    FakeSource.instances = [];
    const page = environment({ BroadcastChannel: channelBus() as unknown as typeof BroadcastChannel, locks: lockManager() });
    const onHint = vi.fn();
    const stop = startRealtime({ userId: "u1", url: "/e", onHint, env: page.env });
    await flush();
    page.emit("pagehide");
    await flush();
    expect(open()).toHaveLength(0);
    page.emit("pageshow");
    await flush();
    expect(open()).toHaveLength(1);
    expect(onHint).toHaveBeenCalledWith({ event: "resync" });
    stop();
  });

  it("re-reads private views when a tab comes back into view, at most once per interval", () => {
    FakeSource.instances = [];
    const page = environment();
    const onHint = vi.fn();
    const stop = startRealtime({ userId: "u1", url: "/e", onHint, env: page.env });
    page.emit("visible");
    page.emit("visible");
    expect(onHint.mock.calls.filter(([hint]) => hint.event === "resync")).toHaveLength(1);
    page.advance(revalidateInterval);
    page.emit("visible");
    expect(onHint.mock.calls.filter(([hint]) => hint.event === "resync")).toHaveLength(2);
    stop();
  });

  it("connects every tab on its own when there is no relay, even with Web Locks", async () => {
    FakeSource.instances = [];
    const locks = lockManager();
    const stops = [0, 1].map(() => startRealtime({ userId: "u1", url: "/e", onHint: vi.fn(), env: environment({ locks }).env }));
    await flush();
    expect(open()).toHaveLength(2);
    for (const stop of stops) stop();
  });
});
