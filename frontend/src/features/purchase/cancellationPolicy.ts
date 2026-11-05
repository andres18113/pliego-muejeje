import type { OrderDetail } from "@/shared/api/orders";
import type { CheckoutFulfillmentMethod } from "./fulfillment";

/**
 * Words the server's cancellation rules for the customer; it never decides them. Whether an order can be cancelled is
 * always `availableActions.canCancel` (the command revalidates under the order lock). The rules worded here are the
 * database's (ADR 0029, V043, V055, V059, V072):
 * - a payment still pending (transfer) can be cancelled without any charge;
 * - digital-only and store-pickup orders: until six minutes after the payment is approved (`cancellationDeadline`);
 * - home delivery (printed or mixed): while the shipment is still being prepared, before it leaves.
 */
export type CancellationRule = "awaiting-payment" | "window" | "preparing";

/** The six-minute window the database applies to digital-only and pickup orders (ADR 0029). Wording only. */
const WINDOW_MINUTES = 6;

/** The server's deadline as a wall-clock time, truncated to the minute so the stated time is never later than the real one. */
export function cancellationClockLabel(deadline: string | null | undefined): string | null {
  if (!deadline) return null;
  const at = new Date(deadline);
  if (Number.isNaN(at.getTime())) return null;
  return new Intl.DateTimeFormat("es-EC", { hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(at);
}

/** Which of the server's rules governs this order, read from its own projections. */
export function orderCancellationRule(order: OrderDetail): CancellationRule | null {
  if (order.orderState === "CANCELLED") return null;
  if (order.payment?.state === "PENDING") return "awaiting-payment";
  const method = order.fulfillment?.method;
  const digitalOnly = order.fulfillment == null && !order.items.some((item) => item.requiresPhysicalFulfillment);
  if (digitalOnly || method === "STORE_PICKUP" || order.availableActions?.lifecycleState === "CANCELLATION_WINDOW") return "window";
  if (method === "HOME_DELIVERY") return "preparing";
  return null;
}

/** When the customer can still cancel, for an order the server currently marks cancelable. */
export function cancellationCondition(order: OrderDetail): string {
  switch (orderCancellationRule(order)) {
    case "awaiting-payment":
      return order.payment?.method === "TRANSFER"
        ? "Puedes cancelarlo mientras esperamos tu transferencia. No se realizará ningún cobro."
        : "Puedes cancelarlo mientras esperamos la confirmación del pago. No se realizará ningún cobro.";
    case "window": {
      const clock = cancellationClockLabel(order.availableActions?.cancellationDeadline);
      return clock
        ? `Puedes cancelarlo hasta las ${clock}, ${WINDOW_MINUTES} minutos después de aprobarse el pago.`
        : `Puedes cancelarlo durante los ${WINDOW_MINUTES} minutos siguientes a la aprobación del pago.`;
    }
    case "preparing":
      return "Puedes cancelarlo mientras lo preparamos, antes de que salga hacia tu dirección.";
    default:
      return "Aún puedes cancelar este pedido.";
  }
}

/** Why cancelling is no longer offered, for a live order the server stopped marking cancelable. */
export function cancellationEnded(order: OrderDetail): string {
  if (orderCancellationRule(order) === "window") {
    const clock = cancellationClockLabel(order.availableActions?.cancellationDeadline);
    return clock ? `El plazo para cancelar terminó a las ${clock}.` : `El plazo de ${WINDOW_MINUTES} minutos para cancelar terminó.`;
  }
  const shipment = order.shipment?.state;
  if (shipment && shipment !== "PENDING" && shipment !== "PREPARING" && shipment !== "CANCELLED") {
    return "Tu pedido ya salió hacia tu dirección, así que ya no se puede cancelar.";
  }
  return "Este pedido ya no se puede cancelar.";
}

/** Before placing the order: when it could be cancelled afterwards, for the destination and payment chosen. */
export function checkoutCancellationNote(fulfillment: CheckoutFulfillmentMethod, payment: string | null | undefined): string {
  const transfer = payment === "TRANSFER";
  if (fulfillment === "HOME_DELIVERY") {
    return transfer
      ? "Podrás cancelarlo mientras esperamos tu transferencia o lo preparamos, antes de que salga hacia tu dirección."
      : "Podrás cancelarlo mientras lo preparamos, antes de que salga hacia tu dirección.";
  }
  return transfer
    ? `Podrás cancelarlo mientras esperamos tu transferencia y durante los ${WINDOW_MINUTES} minutos siguientes a su aprobación.`
    : `Podrás cancelarlo durante los ${WINDOW_MINUTES} minutos siguientes a la aprobación del pago.`;
}
