import type { DigitalEligibility } from "@/shared/api/digitalEligibility";

export type DigitalConflict = "P6002" | "P6003";
export function isDigitalConflict(code: string | null | undefined): code is DigitalConflict {
  return code === "P6002" || code === "P6003";
}

/** IDs only come from eligibility. The command/read reason remains authoritative when that advisory read fails. */
export function digitalConflictDestination(code: DigitalConflict, eligibility?: DigitalEligibility) {
  return code === "P6002"
    ? { href: eligibility?.ownedItemId ? `/biblioteca/${eligibility.ownedItemId}` : "/biblioteca", label: "Ver en Mi biblioteca", compactLabel: "Mi biblioteca" }
    : { href: eligibility?.pendingOrderId ? `/orders/${eligibility.pendingOrderId}` : "/orders", label: "Ver pedido", compactLabel: "Ver pedido" };
}

/** Owned, ordered and in-cart read differently: each names its place and the way there, never another add. */
export function digitalEditionState(eligibility?: DigitalEligibility) {
  if (eligibility?.owned) return { kind: "owned" as const, ...digitalConflictDestination("P6002", eligibility), message: "Ya está en tu biblioteca" };
  if (eligibility?.pendingOrder) return { kind: "pendingOrder" as const, ...digitalConflictDestination("P6003", eligibility), message: "Tienes un pedido abierto con esta edición" };
  if (eligibility?.inCart) return { kind: "inCart" as const, href: "/cart", label: "Ver carrito", compactLabel: "Ver carrito", message: "Ya está en tu carrito" };
  return null;
}
