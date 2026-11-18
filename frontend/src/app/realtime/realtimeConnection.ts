import { parseRealtimeHint, realtimeEventNames, type RealtimeHint } from "./realtimeInvalidation";

/**
 * One stream per browser and account (ADR 0054 caps open streams per user, and a refused EventSource never retries
 * by itself). The tab holding the Web Lock opens the stream and relays each hint to the other tabs over a
 * BroadcastChannel; when it closes, the next waiting tab takes the lock and reconnects. Every tab applies the hint to
 * its own queries. Tabs coordinate only when both Web Locks and BroadcastChannel exist; otherwise each connects on
 * its own (a lock without a relay would leave the other tabs deaf).
 *
 * Leadership follows the page lifecycle: a tab about to be frozen or put in the back/forward cache releases its
 * stream and its lock, so a waiting tab takes over at once (a frozen leader would otherwise keep every other tab
 * silent); it rejoins the queue when it resumes. A tab coming back into view re-reads its mounted private views once
 * (at most every few seconds) — a recovery after suspension, never polling. Only the leader reconnects when the
 * network returns; a waiting tab never opens a stream outside its lock.
 */
export type LifecycleEvent = "online" | "visible" | "freeze" | "resume" | "pagehide" | "pageshow";

export type RealtimeEnvironment = {
  EventSource?: typeof EventSource;
  BroadcastChannel?: typeof BroadcastChannel;
  locks?: LockManager;
  setTimeout: (callback: () => void, ms: number) => unknown;
  clearTimeout: (handle: unknown) => void;
  listen: (event: LifecycleEvent, listener: () => void) => () => void;
  now: () => number;
  random: () => number;
};

export const realtimeChannelName = "pliego-realtime";
const lockName = (userId: string) => `pliego-realtime:${userId}`;
/** Returning to a tab re-reads its private views at most this often. */
export const revalidateInterval = 5_000;

/** Backoff after a refused or failed stream: 3s, 6s, 12s … capped at 60s (the server's connection-limit Retry-After). */
export function reconnectDelay(attempt: number, random: () => number) {
  const base = Math.min(60_000, 3_000 * 2 ** Math.max(0, attempt));
  return Math.round(base * (0.8 + random() * 0.4));
}

export function browserRealtimeEnvironment(): RealtimeEnvironment {
  const on = (target: EventTarget, name: string, listener: () => void) => { target.addEventListener(name, listener); return () => target.removeEventListener(name, listener); };
  return {
    EventSource: typeof EventSource === "undefined" ? undefined : EventSource,
    BroadcastChannel: typeof BroadcastChannel === "undefined" ? undefined : BroadcastChannel,
    locks: typeof navigator !== "undefined" && "locks" in navigator ? navigator.locks : undefined,
    setTimeout: (callback, ms) => window.setTimeout(callback, ms),
    clearTimeout: handle => window.clearTimeout(handle as number),
    listen: (event, listener) => {
      if (event === "online" || event === "pagehide" || event === "pageshow") return on(window, event, listener);
      if (event === "freeze" || event === "resume") return on(document, event, listener);
      return on(document, "visibilitychange", () => { if (document.visibilityState === "visible") listener(); });
    },
    now: () => Date.now(),
    random: Math.random,
  };
}

type RelayMessage = { kind: "pliego-realtime-hint"; userId: string; hint: RealtimeHint };
const isRelay = (value: unknown, userId: string): value is RelayMessage =>
  !!value && typeof value === "object" && (value as RelayMessage).kind === "pliego-realtime-hint" && (value as RelayMessage).userId === userId
  && !!(value as RelayMessage).hint && typeof (value as RelayMessage).hint.event === "string";

export function startRealtime({ userId, url, onHint, env }: { userId: string; url: string; onHint: (hint: RealtimeHint) => void; env: RealtimeEnvironment }) {
  const Source = env.EventSource;
  if (!Source) return () => undefined;
  let stopped = false;
  const channel = env.BroadcastChannel ? new env.BroadcastChannel(realtimeChannelName) : null;
  const coordinated = Boolean(env.locks && channel);
  if (channel) channel.onmessage = (message: MessageEvent) => {
    if (stopped || !isRelay(message.data, userId)) return;
    // Relayed hints are re-validated like a stream message, never trusted as they arrive.
    const hint = message.data.hint.event === "resync" ? parseRealtimeHint("resync", "")
      : parseRealtimeHint(message.data.hint.event, JSON.stringify({ resourceType: message.data.hint.resourceType, resourceId: message.data.hint.resourceId }));
    if (hint) onHint(hint);
  };

  let source: EventSource | null = null;
  let retry: unknown = null;
  let attempt = 0;
  let leading = false;
  let lockAbort: AbortController | null = null;
  let revalidatedAt = -Infinity;
  const receive = (event: string) => (message: MessageEvent) => {
    const hint = parseRealtimeHint(event, typeof message.data === "string" ? message.data : "");
    if (!hint || stopped) return;
    onHint(hint);
    channel?.postMessage({ kind: "pliego-realtime-hint", userId, hint } satisfies RelayMessage);
  };
  const close = () => {
    if (retry !== null) env.clearTimeout(retry);
    retry = null;
    source?.close();
    source = null;
  };
  const connect = () => {
    close();
    if (stopped || !leading) return;
    const next = new Source(url, { withCredentials: true });
    source = next;
    for (const name of realtimeEventNames) next.addEventListener(name, receive(name) as EventListener);
    next.onopen = () => { attempt = 0; };
    // A dropped stream reconnects natively (with Last-Event-ID). A refused one (401, 429, 5xx) is CLOSED for good,
    // so it is reopened here with backoff; the server answers a lost cursor with `resync`.
    next.onerror = () => {
      if (next !== source || next.readyState !== Source.CLOSED || stopped) return;
      next.close();
      source = null;
      retry = env.setTimeout(() => { retry = null; connect(); }, reconnectDelay(attempt++, env.random));
    };
  };
  /** Takes leadership: at once without coordination, otherwise by waiting for the account's Web Lock. */
  const lead = () => {
    if (stopped || leading || lockAbort) return;
    if (!coordinated) { leading = true; connect(); return; }
    const abort = new AbortController();
    lockAbort = abort;
    env.locks!.request(lockName(userId), { signal: abort.signal }, () => new Promise<void>(release => {
      if (stopped || abort.signal.aborted) return release();
      leading = true;
      connect();
      abort.signal.addEventListener("abort", () => { leading = false; close(); release(); }, { once: true });
    })).catch(() => undefined).finally(() => {
      if (lockAbort === abort) { lockAbort = null; leading = false; close(); }
    });
  };
  /** Gives up the stream and the lock (or the place in its queue) so another tab can lead. */
  const yieldLeadership = () => {
    const abort = lockAbort;
    lockAbort = null;
    abort?.abort();
    leading = false;
    close();
  };
  const revalidate = () => {
    const now = env.now();
    if (stopped || now - revalidatedAt < revalidateInterval) return;
    revalidatedAt = now;
    onHint({ event: "resync" });
  };
  const removers = [
    env.listen("online", () => { if (!stopped && leading && !source) { attempt = 0; connect(); } }),
    env.listen("freeze", yieldLeadership),
    env.listen("pagehide", yieldLeadership),
    env.listen("resume", () => { lead(); revalidate(); }),
    env.listen("pageshow", () => { lead(); revalidate(); }),
    env.listen("visible", revalidate),
  ];
  lead();

  return () => {
    stopped = true;
    yieldLeadership();
    for (const remove of removers) remove();
    channel?.close();
  };
}
