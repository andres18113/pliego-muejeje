// Full transport fixtures, deliberately unlike the live location and quote.
export const pickupLocation = {
  id: "8", name: "Punto de prueba Quito", address: "Calle de prueba 42",
  city: "Quito", province: "Pichincha", countryCode: "EC", postalCode: "170525",
  latitude: -0.22, longitude: -78.5, timezone: "America/Guayaquil",
  openingHours: { opensAt: "09:30:00", closesAt: "18:15:00" },
  active: true, preparationMinutes: 37,
};
export const pickupSnapshot = {
  location: pickupLocation, estimatedAt: "2026-10-04T23:55:12Z",
  readyAt: "2026-10-05T00:32:12Z", preparationMinutes: 37, pickupCode: "P-ABC234",
};
export const pickupOrder = {
  orderId: "700", orderState: "CONFIRMED", purchaseState: "CONFIRMED",
  subtotal: "18.50", taxRate: "15.00", taxAmount: "2.78", shippingAmount: "0.00", total: "21.28",
  createdAt: "2026-10-04T23:55:12Z", updatedAt: "2026-10-04T23:55:12Z",
  items: [{ orderItemId: "1", editionId: "42", title: "Cien años de soledad", authors: "Gabriel García Márquez",
    publisher: "Editorial", format: "PHYSICAL", unitPrice: "18.50", quantity: 1, subtotal: "18.50" }],
  address: null, shipment: null,
  payment: { method: "CARD", state: "APPROVED", amount: "21.28", reference: "SIM-PICKUP" },
  fulfillment: { method: "STORE_PICKUP", pickup: pickupSnapshot, state: "PENDING", collectedAt: null },
  stateHistory: [], invoice: null, creditNotes: [], availableActions: { cancel: true, changeShippingAddress: false },
};
