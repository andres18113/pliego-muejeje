import { describe, expect, it } from "vitest";
import type { OrderDetail } from "@/shared/api/orders";
import { pickupOrder } from "@/test/pickup";
import { cancellationClockLabel, cancellationCondition, cancellationEnded, checkoutCancellationNote, orderCancellationRule } from "./cancellationPolicy";

const printed = pickupOrder.items[0];
const order = (patch: Partial<OrderDetail>): OrderDetail => ({ ...pickupOrder, ...patch } as OrderDetail);
const digital = (patch: Partial<OrderDetail> = {}) => order({ fulfillment: null, shipment: null, address: null,
  items: [{ ...printed, requiresPhysicalFulfillment: false, format: "EBOOK" }], ...patch });
const home = (patch: Partial<OrderDetail> = {}) => order({ fulfillment: { method: "HOME_DELIVERY" } as OrderDetail["fulfillment"], ...patch });

describe("cancellation policy wording", () => {
  it("states the clock time truncated to the minute, never later than the server's deadline", () => {
    const label = cancellationClockLabel("2026-11-01T15:06:59Z");
    expect(label).toMatch(/^\d{2}:\d{2}$/);
    expect(label).toBe(cancellationClockLabel("2026-11-01T15:06:00Z"));
    expect(cancellationClockLabel("not a date")).toBeNull();
    expect(cancellationClockLabel(null)).toBeNull();
  });

  it("follows the server's rule for each kind of order", () => {
    expect(orderCancellationRule(digital())).toBe("window");
    expect(orderCancellationRule(order({ fulfillment: { ...pickupOrder.fulfillment!, method: "STORE_PICKUP" } }))).toBe("window");
    expect(orderCancellationRule(home())).toBe("preparing");
    expect(orderCancellationRule(home({ payment: { ...pickupOrder.payment!, state: "PENDING", method: "TRANSFER" } }))).toBe("awaiting-payment");
    expect(orderCancellationRule(home({ orderState: "CANCELLED" }))).toBeNull();
  });

  it("words what the customer can still do, and why it ended", () => {
    const deadline = "2026-11-01T15:06:30Z";
    const clock = cancellationClockLabel(deadline);
    const windowOrder = digital({ availableActions: { cancel: true, canCancel: true, changeShippingAddress: false, lifecycleState: "CANCELLATION_WINDOW", cancellationDeadline: deadline } });
    expect(cancellationCondition(windowOrder)).toBe(`Puedes cancelarlo hasta las ${clock}, 6 minutos después de aprobarse el pago.`);
    expect(cancellationEnded(windowOrder)).toBe(`El plazo para cancelar terminó a las ${clock}.`);
    expect(cancellationCondition(home())).toBe("Puedes cancelarlo mientras lo preparamos, antes de que salga hacia tu dirección.");
    expect(cancellationCondition(home({ payment: { ...pickupOrder.payment!, state: "PENDING", method: "TRANSFER" } })))
      .toBe("Puedes cancelarlo mientras esperamos tu transferencia. No se realizará ningún cobro.");
    expect(cancellationEnded(home({ shipment: { ...(pickupOrder.shipment ?? {}), state: "IN_TRANSIT" } as OrderDetail["shipment"] })))
      .toBe("Tu pedido ya salió hacia tu dirección, así que ya no se puede cancelar.");
  });

  it("tells the rule before the order is placed, for the destination and payment chosen", () => {
    expect(checkoutCancellationNote("HOME_DELIVERY", "CARD")).toBe("Podrás cancelarlo mientras lo preparamos, antes de que salga hacia tu dirección.");
    expect(checkoutCancellationNote("HOME_DELIVERY", "TRANSFER")).toMatch(/mientras esperamos tu transferencia o lo preparamos/);
    expect(checkoutCancellationNote("DIGITAL_ONLY", undefined)).toBe("Podrás cancelarlo durante los 6 minutos siguientes a la aprobación del pago.");
    expect(checkoutCancellationNote("STORE_PICKUP", "TRANSFER")).toBe("Podrás cancelarlo mientras esperamos tu transferencia y durante los 6 minutos siguientes a su aprobación.");
  });
});
