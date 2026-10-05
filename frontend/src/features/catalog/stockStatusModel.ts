import type { StockAvailability, StockUnavailabilityReason } from "@/shared/api/availability";
export type { StockAvailability } from "@/shared/api/availability";

const reasons: Record<StockUnavailabilityReason, string> = {
  P3002: "No hay existencias suficientes para esta cantidad.",
  P2042: "Esta edición ya no está a la venta.",
  P2043: "Este libro ya no está a la venta.",
  P4004: "Las ediciones digitales admiten una unidad por edición.",
};

/** Presentation of a backend-confirmed read, not a recomputation of inventory. */
export function resolveStockStatus({ available, unavailabilityReason }: StockAvailability) {
  return {
    canAddToCart: available,
    canIncreaseQuantity: available,
    canChangeQuantity: available || unavailabilityReason === "P3002" || unavailabilityReason === "P4004",
    state: available ? "available" as const : "unavailable" as const,
    label: available ? "Disponible" : "No disponible",
    icon: available ? "check_circle" as const : "block" as const,
    explanation: !available && unavailabilityReason ? reasons[unavailabilityReason] ?? null : null,
    tone: available ? "success" as const : "danger" as const,
  };
}

/** A command conflict is feedback about that attempt, not an edition stock boolean. */
export function availabilityConflictMessage(code: string | null | undefined): string | null {
  if (code === "P3002") return "No hay existencias suficientes para esta cantidad en tu carrito.";
  if (code === "P2042") return "La edición no estaba a la venta al enviar la solicitud.";
  if (code === "P2043") return "El libro no estaba a la venta al enviar la solicitud.";
  if (code === "P2041") return "Esta edición ya no está disponible en el catálogo.";
  if (code === "P3001") return "No pudimos confirmar la disponibilidad de esta edición.";
  return null;
}

/** Stock-bearing reads refresh stale data when the reader returns to the browser tab. */
export const stockReadOptions = { refetchOnWindowFocus: true } as const;
