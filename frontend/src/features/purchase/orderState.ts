import type { KnownShipmentState } from "@/shared/api/orders";

export interface CurrentOrderState {
  source: "SHIPMENT" | "PICKUP" | "PURCHASE" | "UNKNOWN";
  code: string | null;
  label: string;
}

export interface OrderStateInput {
  orderState: string;
  purchaseState: string | null;
  paymentState?: string | null;
  shipmentState: string | null;
  fulfillmentMethod?: string | null;
  pickupState?: string | null;
}

const shipmentLabels: Record<KnownShipmentState, string> = {
  PREPARING: "En preparación", IN_TRANSIT: "En camino", OUT_FOR_DELIVERY: "En reparto", DELIVERED: "Entregado",
  PENDING: "Pedido confirmado", SHIPPED: "En camino", CANCELLED: "Envío cancelado",
};
const pickupLabels: Record<string, string> = {
  PENDING: "Pendiente de retiro", COLLECTED: "Retirado", CANCELLED: "Pedido cancelado",
};

/** Labels backend projections. Never infers progress, pickup readiness, or actions. */
export function currentOrderState(input: OrderStateInput): CurrentOrderState {
  const purchase = input.purchaseState ?? (["CONFIRMED", "PENDING_PAYMENT", "CANCELLED"].includes(input.orderState) ? input.orderState : null);
  if (purchase === "CANCELLED" && input.paymentState === "REJECTED") {
    return { source: "PURCHASE", code: purchase, label: "Pago no completado" };
  }
  if (purchase === "COMPLETED") return { source: "PURCHASE", code: purchase, label: "Compra completada" };
  if (input.fulfillmentMethod === "STORE_PICKUP") {
    const code = input.pickupState ?? null;
    return { source: "PICKUP", code, label: code ? pickupLabels[code] ?? "Estado de retiro no disponible" : "Estado de retiro no disponible" };
  }
  if (purchase === "CANCELLED") return { source: "PURCHASE", code: purchase, label: "Pedido cancelado" };
  if (purchase === "PENDING_PAYMENT") return { source: "PURCHASE", code: purchase, label: "Pendiente de pago" };
  if (input.shipmentState) {
    return { source: "SHIPMENT", code: input.shipmentState, label: shipmentLabels[input.shipmentState as KnownShipmentState] ?? "Estado no disponible" };
  }
  if (purchase === "CONFIRMED") return { source: "PURCHASE", code: purchase, label: "Compra confirmada" };
  return { source: "UNKNOWN", code: purchase, label: "Estado no disponible" };
}
