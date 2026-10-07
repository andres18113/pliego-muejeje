import { describe, expect, it } from "vitest";
import { orderDetailFixture, orderSummaryFixture } from "@/test/orders";
import { pickupOrder } from "@/test/pickup";
import { toMisPedidosOrder } from "./orderViewModel";

describe("Mis pedidos view model", () => {
  it("carries historical list totals without adding prices to item summaries", () => {
    const model = toMisPedidosOrder(orderSummaryFixture({ originalSubtotal: "50.00", savingsTotal: "13.02", currentSubtotal: "36.98", pricingSnapshotAvailable: true }));
    expect(model.historicalPricing?.summary.savingsTotal?.rawValue).toBe("13.02");
    expect(model.historicalPricing?.summary.currentSubtotal?.rawValue).toBe("36.98");
    expect(model.historicalPricing?.lines).toEqual([]);
    expect(model.items[0]).toEqual({ orderItemId: "1", title: "Cien años de soledad", format: "PAPERBACK", quantity: 2 });
  });

  it("uses detail snapshots while preserving paid prices and the existing presentation contract", () => {
    const detail = orderDetailFixture();
    const model = toMisPedidosOrder(orderSummaryFixture(), {
      ...detail, originalSubtotal: "50.00", savingsTotal: "13.02", currentSubtotal: "36.98", subtotal: "36.98", pricingSnapshotAvailable: true,
      items: detail.items.map(item => ({ ...item, unitPrice: "18.49", subtotal: "36.98", originalPrice: "25.00", unitSavings: "6.51", originalSubtotal: "50.00", lineSavings: "13.02", pricingSnapshotAvailable: true })),
    });
    expect(model.pricing.subtotal).toBe("36.98");
    expect(model.historicalPricing?.pricingSnapshotAvailable).toBe(true);
    expect(model.historicalPricing?.lines[0].unitPrice.rawValue).toBe("18.49");
    expect(model.historicalPricing?.lines[0].lineSavings?.rawValue).toBe("13.02");
  });

  it("respects unknown detail snapshots over list data without fabricating historical savings", () => {
    const model = toMisPedidosOrder(orderSummaryFixture({ originalSubtotal: "50.00", savingsTotal: "13.02", currentSubtotal: "36.98", pricingSnapshotAvailable: true }),
      orderDetailFixture("PREPARING", { originalSubtotal: null, savingsTotal: null, currentSubtotal: "37.00", pricingSnapshotAvailable: false }));
    expect(model.historicalPricing?.pricingSnapshotAvailable).toBe(false);
    expect(model.historicalPricing?.summary.savingsTotal).toBeNull();
    expect(model.historicalPricing?.summary.currentSubtotal?.rawValue).toBe("37.00");
  });

  it.each([
    ["PREPARING", "En preparación"], ["IN_TRANSIT", "En camino"],
    ["OUT_FOR_DELIVERY", "En reparto"], ["DELIVERED", "Entregado"],
    ["PENDING", "Pedido confirmado"], ["SHIPPED", "En camino"], ["CANCELLED", "Envío cancelado"],
  ])("uses shipment %s independently of CONFIRMED commercial state", (code, label) => {
    const model = toMisPedidosOrder(orderSummaryFixture(), orderDetailFixture(code, { availableActions: { cancel: false, changeShippingAddress: false } }));
    expect(model.state).toEqual({ source: "SHIPMENT", code, label });
    expect(model.availableActions.cancel).toBe(false);
  });

  it("exposes only purchased summaries, exact amounts and the data presentation needs", () => {
    expect(toMisPedidosOrder(orderSummaryFixture(),orderDetailFixture())).toEqual({
      orderId: "700", date: "2026-10-04T15:00:00Z", state: { source: "SHIPMENT", code: "PREPARING", label: "En preparación" },
      items: [{ orderItemId: "1", title: "Cien años de soledad", format: "PAPERBACK", quantity: 2 }], units: 2,
      pricing: { subtotal: "37.00", tax: "5.55", shipping: "0.00", total: "42.55" }, fulfillmentType: "HOME_DELIVERY",
      availableActions: { cancel: true, changeShippingAddress: false },
      canCancel: true, cancellationDeadline: null, lifecycleState: null, libraryAccessState: null,
    });
  });

  it("takes actions from the server even when local expectations disagree", () => {
    expect(toMisPedidosOrder(orderSummaryFixture(),orderDetailFixture("PREPARING", { availableActions: { cancel: false, changeShippingAddress: false } })).availableActions.cancel).toBe(false);
    expect(toMisPedidosOrder(orderSummaryFixture(),orderDetailFixture("IN_TRANSIT")).availableActions.cancel).toBe(true);
  });

  it.each([["PENDING", "Pendiente de retiro"], ["COLLECTED", "Retirado"], ["CANCELLED", "Pedido cancelado"]])("keeps STORE_PICKUP %s separate", (code,label) => {
    const detail = { ...pickupOrder, fulfillment: { ...pickupOrder.fulfillment, state: code },
      orderState: code === "COLLECTED" ? "DELIVERED" : code === "CANCELLED" ? "CANCELLED" : "CONFIRMED",
      purchaseState: code === "CANCELLED" ? "CANCELLED" : "CONFIRMED" };
    const model = toMisPedidosOrder(orderSummaryFixture({ fulfillmentMethod: "STORE_PICKUP", shipmentState: null }),detail);
    expect(model.fulfillmentType).toBe("STORE_PICKUP");
    expect(model.state).toEqual({ source: "PICKUP", code, label });
  });

  it("does not sum a truncated list or invent pricing, actions, or fulfillment", () => {
    const model = toMisPedidosOrder(orderSummaryFixture({ unitCount: null, fulfillmentMethod: null, shipmentState: null }));
    expect(model.units).toBeNull();
    expect(model.pricing).toEqual({ subtotal: null, tax: null, shipping: null, total: "42.55" });
    expect(model.availableActions).toEqual({ cancel: false, changeShippingAddress: false });
    expect(model.fulfillmentType).toBeNull();
  });

  it("keeps optional server list prices when an older detail projection omits the breakdown", () => {
    const summary = orderSummaryFixture({ subtotal: "37.00",taxAmount: "5.55",shippingAmount: "0.00" });
    const detail = orderDetailFixture("PREPARING",{ subtotal: undefined,taxAmount: undefined,shippingAmount: undefined });
    expect(toMisPedidosOrder(summary,detail).pricing).toEqual({ subtotal: "37.00",tax: "5.55",shipping: "0.00",total: "42.55" });
  });

  it("does not infer a pickup or shipment state from orderState or the client clock", () => {
    expect(toMisPedidosOrder(orderSummaryFixture({ fulfillmentMethod: "STORE_PICKUP", shipmentState: null, orderState: "DELIVERED" })).state).toEqual({ source: "PICKUP", code: null, label: "Estado de retiro no disponible" });
    expect(toMisPedidosOrder(orderSummaryFixture(), orderDetailFixture("PREPARING", { createdAt: "2000-01-01T00:00:00Z" })).state.code).toBe("PREPARING");
    expect(toMisPedidosOrder(orderSummaryFixture(), orderDetailFixture("FUTURE_STATE")).state.label).toBe("Estado no disponible");
  });

  it("represents digital, payment pending, rejected and cancelled purchases without shipping guesses", () => {
    const digital = orderDetailFixture("PREPARING", { fulfillment: null, shipment: null });
    expect(toMisPedidosOrder(orderSummaryFixture(),digital).state).toEqual({ source: "PURCHASE", code: "CONFIRMED", label: "Compra confirmada" });
    expect(toMisPedidosOrder(orderSummaryFixture(),{ ...digital, purchaseState: "PENDING_PAYMENT" }).state.label).toBe("Pendiente de pago");
    expect(toMisPedidosOrder(orderSummaryFixture(),{ ...digital, purchaseState: "CANCELLED", payment: { ...digital.payment!, state: "REJECTED" } }).state.label).toBe("Pago no completado");
    expect(toMisPedidosOrder(orderSummaryFixture(),{ ...digital, purchaseState: "CANCELLED" }).state.label).toBe("Pedido cancelado");
  });

  it("passes database lifecycle capabilities and completed state through to Mis pedidos", () => {
    const digital = orderDetailFixture("CONFIRMED", { fulfillment: null, shipment: null, purchaseState: "COMPLETED",
      availableActions: { cancel: false, canCancel: false, changeShippingAddress: false,
        cancellationDeadline: "2026-10-06T22:06:00Z", lifecycleState: "COMPLETED", libraryAccessState: "OWNERSHIP_ONLY" } });
    const model = toMisPedidosOrder(orderSummaryFixture(), digital);
    expect(model.canCancel).toBe(false);
    expect(model.cancellationDeadline).toBe("2026-10-06T22:06:00Z");
    expect(model.lifecycleState).toBe("COMPLETED");
    expect(model.libraryAccessState).toBe("OWNERSHIP_ONLY");
    expect(model.state).toMatchObject({ code: "COMPLETED", label: "Compra completada" });
  });
});
