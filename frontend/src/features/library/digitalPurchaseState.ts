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

export function digitalEditionState(eligibility?: DigitalEligibility) {
  if (eligibility?.owned) return { ...digitalConflictDestination("P6002", eligibility), message: "Ya está en tu biblioteca" };
  if (eligibility?.pendingOrder) return { ...digitalConflictDestination("P6003", eligibility), message: "Tienes un pedido abierto con esta edición" };
  if (eligibility?.inCart) return { href: "/cart", label: "Ver el carrito", compactLabel: "Ver carrito", message: "Ya está en tu carrito" };
  return null;
}
