import { parseRealtimeHint, realtimeEventNames, type RealtimeHint } from "./realtimeInvalidation";

/**
 * One stream per browser and account (ADR 0054 caps open streams per user, and a refused EventSource never retries
 * by itself). The tab holding the Web Lock opens the stream and relays each hint to the other tabs over a
 * BroadcastChannel; when it closes, the next waiting tab takes the lock and reconnects. Every tab applies the hint to
 * its own queries. Without Web Locks each tab connects on its own; without BroadcastChannel nothing is relayed.
 */
export type RealtimeEnvironment = {
  EventSource?: typeof EventSource;
  BroadcastChannel?: typeof BroadcastChannel;
  locks?: LockManager;
  setTimeout: (callback: () => void, ms: number) => unknown;
  clearTimeout: (handle: unknown) => void;
  addOnline: (listener: () => void) => () => void;
  random: () => number;
};

export const realtimeChannelName = "pliego-realtime";
const lockName = (userId: string) => `pliego-realtime:${userId}`;

/** Backoff after a refused or failed stream: 3s, 6s, 12s … capped at 60s (the server's connection-limit Retry-After). */
export function reconnectDelay(attempt: number, random: () => number) {
  const base = Math.min(60_000, 3_000 * 2 ** Math.max(0, attempt));
  return Math.round(base * (0.8 + random() * 0.4));
}

export function browserRealtimeEnvironment(): RealtimeEnvironment {
  return {
    EventSource: typeof EventSource === "undefined" ? undefined : EventSource,
    BroadcastChannel: typeof BroadcastChannel === "undefined" ? undefined : BroadcastChannel,
    locks: typeof navigator !== "undefined" && "locks" in navigator ? navigator.locks : undefined,
    setTimeout: (callback, ms) => window.setTimeout(callback, ms),
    clearTimeout: handle => window.clearTimeout(handle as number),
    addOnline: listener => { window.addEventListener("online", listener); return () => window.removeEventListener("online", listener); },
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
    if (stopped) return;
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
  const removeOnline = env.addOnline(() => { if (!stopped && !source) { attempt = 0; connect(); } });

  const abort = new AbortController();
  if (env.locks) {
    env.locks.request(lockName(userId), { signal: abort.signal }, () => new Promise<void>(release => {
      if (stopped) return release();
      connect();
      abort.signal.addEventListener("abort", () => release(), { once: true });
    })).catch(() => undefined);
  } else connect();

  return () => {
    stopped = true;
    abort.abort();
    removeOnline();
    close();
    channel?.close();
  };
}
