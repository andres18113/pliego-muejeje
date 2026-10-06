import type { OrderDetail, OrderSummary } from "@/shared/api/orders";

export function orderDetailFixture(state = "PREPARING", overrides: Partial<OrderDetail> = {}): OrderDetail {
  return {
    orderId: "700", createdAt: "2026-10-04T15:00:00Z", orderState: "CONFIRMED", purchaseState: "CONFIRMED",
    subtotal: "37.00", taxRate: "15.00", taxAmount: "5.55", shippingAmount: "0.00", total: "42.55",
    items: [{ orderItemId: "1", editionId: "42", title: "Cien años de soledad", authors: "Gabriel García Márquez",
      publisher: "Editorial", requiresPhysicalFulfillment: true, format: "PAPERBACK", unitPrice: "18.50", quantity: 2, subtotal: "37.00" }],
    address: null, payment: { method: "CARD", state: "APPROVED", amount: "42.55", reference: "SIM-1" },
    stateHistory: [], fulfillment: { method: "HOME_DELIVERY" },
    shipment: { shipmentId: "70", state, carrier: null, trackingCode: null, trackingUrl: null,
      estimatedDeliveryFrom: null, estimatedDeliveryTo: null, createdAt: "2026-10-04T15:00:00Z",
      preparingAt: "2026-10-04T15:00:00Z", shippedAt: null, outForDeliveryAt: null, deliveredAt: null, canceledAt: null,
      history: [{ eventId: "1", type: "STATUS", origin: "SYSTEM", previousState: null,
        newState: state, carrier: null, trackingCode: null, trackingUrl: null, at: "2026-10-04T15:00:00Z" }] },
    invoice: null, creditNotes: [], availableActions: { cancel: true, changeShippingAddress: false },
    ...overrides,
  };
}

export function orderSummaryFixture(overrides: Partial<OrderSummary> = {}): OrderSummary {
  return {
    orderId: "700", createdAt: "2026-10-04T15:00:00Z", orderState: "CONFIRMED", purchaseState: "CONFIRMED",
    paymentState: "APPROVED", total: "42.55", fulfillmentMethod: "HOME_DELIVERY", shipmentState: "PREPARING",
    estimatedDeliveryFrom: null, estimatedDeliveryTo: null, itemCount: 1, unitCount: 2,
    itemSummary: [{ orderItemId: "1", title: "Cien años de soledad", format: "PAPERBACK", quantity: 2 }],
    invoiceState: null, invoicePdfAvailable: false, invoiceXmlAvailable: false, ...overrides,
  };
}
