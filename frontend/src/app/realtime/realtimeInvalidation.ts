import type { QueryClient, QueryKey } from "@tanstack/react-query";

/**
 * ADR 0054: the stream carries invalidation hints only — an event name and the internal REST resource it touches.
 * Hints never carry state; every screen re-reads its authoritative REST resource. This module maps a hint to the
 * query keys that own those resources. It never decides a business state.
 */
export type RealtimeRole = "CUSTOMER" | "ADMIN";

export const realtimeEventNames = [
  "identity.correction.created",
  "identity.correction.decided",
  "identity.correction.withdrawn",
  "identity.correction.acknowledged",
  "order.changed",
  "order.cancellation-window.expired",
  "pickup.ready",
  "library.changed",
  "resync",
] as const;

export type RealtimeEventName = typeof realtimeEventNames[number];

export type RealtimeHint = { event: RealtimeEventName; resourceType?: string; resourceId?: string };

const isEventName = (value: string): value is RealtimeEventName => (realtimeEventNames as readonly string[]).includes(value);

/** Parses one SSE message; anything unexpected is ignored rather than guessed. */
export function parseRealtimeHint(event: string, data: string): RealtimeHint | null {
  if (!isEventName(event)) return null;
  if (event === "resync") return { event };
  try {
    const parsed: unknown = JSON.parse(data);
    if (!parsed || typeof parsed !== "object") return null;
    const { resourceType, resourceId } = parsed as Record<string, unknown>;
    if (typeof resourceType !== "string" || typeof resourceId !== "string" || !/^\d{1,19}$/.test(resourceId)) return null;
    return { event, resourceType, resourceId };
  } catch {
    return null;
  }
}

/** Every private, server-owned view: the customer's and the administration's. Public catalog data is not touched. */
const isPrivateKey = (key: QueryKey) => typeof key[0] === "string" && (key[0].startsWith("customer-") || key[0].startsWith("admin-"));

export function realtimeQueryKeys(role: RealtimeRole, hint: RealtimeHint): QueryKey[] {
  if (hint.event === "resync") return [];
  const id = hint.resourceId ?? "";
  if (role === "ADMIN") {
    if (hint.event.startsWith("identity.correction.")) return hint.event === "identity.correction.acknowledged" ? [] : [["admin-identity-corrections"]];
    if (hint.event === "library.changed") return [];
    return [["admin-pickups"], ["admin-pickup", id]];
  }
  if (hint.event.startsWith("identity.correction.")) return [["customer-billing-identity"]];
  if (hint.event === "library.changed") return [["customer-library"], ["customer-cart", "digital-eligibility"]];
  // An order hint: the list, the order, its documents and what it grants (digital access and purchase eligibility).
  return [
    ["customer-orders"], ["customer-order", id], ["customer-invoice", id], ["customer-invoice-document", id],
    ["customer-library"], ["customer-cart", "digital-eligibility"],
  ];
}

/** Refetches the mounted views a hint concerns (inactive ones are only marked stale), or every private view on resync. */
export function applyRealtimeHint(queryClient: QueryClient, role: RealtimeRole, hint: RealtimeHint) {
  if (hint.event === "resync") return queryClient.invalidateQueries({ predicate: query => isPrivateKey(query.queryKey) });
  return Promise.all(realtimeQueryKeys(role, hint).map(queryKey => queryClient.invalidateQueries({ queryKey })));
}
