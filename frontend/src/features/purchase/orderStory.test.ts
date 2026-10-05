import { describe, expect, it } from "vitest";
import { orderStory } from "./orderStory";

const base = { orderState: "CONFIRMED", purchaseState: "CONFIRMED", paymentState: "APPROVED", shipmentState: "PENDING" };

describe("orderStory", () => {
  it("leads with the shipment while the purchase is active", () => {
    expect(orderStory(base)).toMatchObject({ kind: "preparing", tone: "progress", headline: "Pedido confirmado" });
    expect(orderStory({ ...base, orderState: "PREPARING", shipmentState: "PREPARING" }).headline).toBe("En preparación");
    expect(orderStory({ ...base, orderState: "SHIPPED", shipmentState: "SHIPPED" })).toMatchObject({ kind: "in-transit", headline: "En camino" });
    // OUT_FOR_DELIVERY keeps the compatible orderState SHIPPED; the shipment state refines the story.
    expect(orderStory({ ...base, orderState: "SHIPPED", shipmentState: "OUT_FOR_DELIVERY" }).headline).toBe("En reparto");
    expect(orderStory({ ...base, orderState: "DELIVERED", shipmentState: "DELIVERED" })).toMatchObject({ kind: "delivered", tone: "arrived" });
  });

  it("lets a cancelled purchase close the story whatever the shipment says", () => {
    expect(orderStory({ ...base, orderState: "CANCELLED", purchaseState: "CANCELLED", paymentState: "REFUNDED", shipmentState: "CANCELLED" })).toMatchObject({ kind: "cancelled", tone: "closed" });
    expect(orderStory({ ...base, orderState: "CANCELLED", purchaseState: "CANCELLED", paymentState: "REJECTED", shipmentState: "CANCELLED" })).toMatchObject({ kind: "payment-rejected", tone: "attention" });
  });

  it("tells a digital-only purchase without inventing a shipment", () => {
    expect(orderStory({ ...base, shipmentState: null })).toMatchObject({ kind: "confirmed", headline: "Compra confirmada" });
  });

  it("maps IN_TRANSIT while the commercial order stays CONFIRMED", () => {
    expect(orderStory({ ...base, shipmentState: "IN_TRANSIT" })).toMatchObject({ kind: "in-transit", headline: "En camino" });
  });

  it("does not infer delivery progress from a legacy commercial state", () => {
    expect(orderStory({ ...base, orderState: "SHIPPED", shipmentState: null })).toMatchObject({ kind: "confirmed", headline: "Compra confirmada" });
    expect(orderStory({ ...base, orderState: "DELIVERED", shipmentState: null })).toMatchObject({ kind: "confirmed", headline: "Compra confirmada" });
  });

  it("uses only compatible commercial states when an older server omits projections", () => {
    expect(orderStory({ orderState: "SHIPPED", purchaseState: null, paymentState: "APPROVED", shipmentState: null }).headline).toBe("Estado no disponible");
    expect(orderStory({ orderState: "PENDING_PAYMENT", purchaseState: null, paymentState: "PENDING", shipmentState: null }).kind).toBe("awaiting-payment");
  });
});
