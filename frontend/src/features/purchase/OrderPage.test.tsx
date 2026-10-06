import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { json, problem, renderPurchaseRoute, stubApi } from "@/test/purchase";
import { OrderPage } from "./OrderPage";

const routes = [{ path: "/orders/:orderId", element: <OrderPage /> }];

const shipment = (state: string, extra: Record<string, unknown> = {}) => ({
  shipmentId: "70", state, carrier: null, trackingCode: null, trackingUrl: null,
  estimatedDeliveryFrom: null, estimatedDeliveryTo: null, createdAt: "2026-09-27T21:50:06Z",
  preparingAt: null, shippedAt: null, outForDeliveryAt: null, deliveredAt: null, canceledAt: null,
  history: [{ eventId: "1", type: "STATUS", origin: "SYSTEM", actorUserId: null, previousState: null, newState: "PENDING", carrier: null, trackingCode: null, trackingUrl: null, at: "2026-09-27T21:50:06Z" }],
  ...extra,
});

/** CustomerOrderDetail as served by API v1.0.8 (string ids and money, nullable projections). */
function order(overrides: Record<string, unknown> = {}) {
  return {
    orderId: "700",
    orderState: "CONFIRMED",
    subtotal: "37.00",
    total: "37.00",
    createdAt: "2026-09-27T21:50:06Z",
    updatedAt: "2026-09-27T21:50:06Z",
    items: [{
      orderItemId: "1", editionId: "42", sku: "PLG-1", isbn: "9780306406157", title: "Cien años de soledad",
      authors: "Gabriel García Márquez", publisher: "Editorial Sur", requiresPhysicalFulfillment: true, format: "PAPERBACK", language: "es",
      unitPrice: "18.50", quantity: 2, subtotal: "37.00",
    }],
    address: {
      recipient: "Ana Pérez", line1: "Av. Principal 123", line2: null, city: "Quito", province: "Pichincha",
      countryCode: "EC", postalCode: null, reference: null, phone: "+59325550134",
    },
    payment: { paymentId: "9", method: "CARD", state: "APPROVED", amount: "37.00", reference: "SIM-550e8400", resultDetail: null, createdAt: "2026-09-27T21:50:06Z", updatedAt: "2026-09-27T21:50:06Z" },
    stateHistory: [{ historyId: "1", actorUserId: null, origin: "SYSTEM", previousState: null, newState: "CONFIRMED", at: "2026-09-27T21:50:06Z" }],
    purchaseState: "CONFIRMED",
    fulfillment: { method: "HOME_DELIVERY" },
    shipment: shipment("PENDING"),
    invoice: null,
    creditNotes: [],
    availableActions: { cancel: true, changeShippingAddress: false },
    ...overrides,
  };
}

const refunded = { paymentId: "9", method: "CARD", state: "REFUNDED", amount: "37.00", reference: "SIM-550e8400", resultDetail: null };

describe("OrderPage", () => {
  afterEach(() => vi.unstubAllGlobals());

  it.each([["PREPARING","En preparación"],["IN_TRANSIT","En camino"],["OUT_FOR_DELIVERY","En reparto"],["DELIVERED","Entregado"]])("reads %s and cancel availability from the backend",async (state,label) => {
    stubApi({ "GET /api/v1/orders/700": () => json(order({ orderState: "CONFIRMED",shipment: shipment(state),availableActions: { cancel: false,changeShippingAddress: false } })) });
    renderPurchaseRoute(routes,"/orders/700");
    expect(await screen.findByRole("heading",{ level: 2,name: label })).toBeInTheDocument();
    expect(screen.queryByRole("button",{ name: "Cancelar pedido" })).not.toBeInTheDocument();
    expect(screen.getByRole("list",{ name: "Progreso del envío" }).querySelector('[aria-current="step"]')).toHaveTextContent(label);
  });

  it("tells a confirmed order's story with its facts, books and payment", async () => {
    stubApi({
      "GET /api/v1/orders/700": () => json(order()),
      "GET /api/v1/catalog/editions/42": () => json({ available: true, coverUrl: "https://covers.example.invalid/42.webp", coverLicense: null, coverAttribution: null }),
    });
    renderPurchaseRoute(routes, "/orders/700");

    expect(await screen.findByRole("heading", { level: 2, name: "Pedido confirmado" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 1, name: "Detalle del pedido" })).toHaveFocus();
    expect(screen.getByRole("link", { name: "Volver a mis pedidos" })).toHaveAttribute("href", "/orders");
    expect(screen.getByRole("list", { name: "Progreso del envío" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Libros del pedido" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Cien años de soledad" })).toBeInTheDocument();
    expect(await screen.findByRole("img", { name: "Portada de Cien años de soledad" })).toBeInTheDocument();
    expect(screen.queryByText(/Referencia|SIM-/)).not.toBeInTheDocument();
    expect(screen.getByText("Pedido N.°").nextSibling).toHaveTextContent("700");
    expect(screen.queryByRole("heading", { name: /Factura/ })).not.toBeInTheDocument();
    expect(screen.queryByText(/4111/)).not.toBeInTheDocument();
  });

  it("explains a rejected payment without a payment reference", async () => {
    stubApi({
      "GET /api/v1/orders/701": () => json(order({
        orderId: "701", orderState: "CANCELLED", purchaseState: "CANCELLED", shipment: shipment("CANCELLED"),
        payment: { method: "TRANSFER", state: "REJECTED", amount: "37.00", reference: null },
        availableActions: { cancel: false, changeShippingAddress: false },
      })),
    });
    renderPurchaseRoute(routes, "/orders/701");

    expect(await screen.findByRole("heading", { level: 2, name: "Pago no completado" })).toBeInTheDocument();
    expect(screen.getByText(/Los libros siguen en tu carrito/)).toBeInTheDocument();
    expect(screen.queryByText("Referencia")).not.toBeInTheDocument();
    expect(screen.queryByRole("list", { name: "Progreso del envío" })).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Revisar el carrito" })).toHaveAttribute("href", "/cart");
  });

  it("does not disclose whether a missing order exists", async () => {
    stubApi({ "GET /api/v1/orders/999": () => problem(404, "P5001", "Pedido no disponible", "No encontramos el pedido.") });
    renderPurchaseRoute(routes, "/orders/999");

    expect(await screen.findByRole("heading", { name: "No encontramos este pedido." })).toBeInTheDocument();
  });

  it("offers cancellation only when the server authorizes it", async () => {
    // A CONFIRMED order the server no longer allows to cancel: the UI must not derive its own rule.
    stubApi({ "GET /api/v1/orders/700": () => json(order({ availableActions: { cancel: false, changeShippingAddress: false } })) });
    renderPurchaseRoute(routes, "/orders/700");
    await screen.findByRole("heading", { level: 2, name: "Pedido confirmado" });
    expect(screen.queryByRole("button", { name: "Cancelar pedido" })).not.toBeInTheDocument();
  });

  it("leads a shipment in transit with its tracking and current step", async () => {
    stubApi({ "GET /api/v1/orders/700": () => json(order({
      orderState: "SHIPPED",
      shipment: shipment("OUT_FOR_DELIVERY", { carrier: "Servientrega", trackingCode: "SE5566778899", trackingUrl: "https://tracking.example.invalid/SE5566778899", estimatedDeliveryFrom: "2026-10-08T14:00:00Z", estimatedDeliveryTo: "2026-10-08T23:00:00Z", preparingAt: "2026-09-28T10:00:00Z", shippedAt: "2026-09-29T10:00:00Z", outForDeliveryAt: "2026-10-08T09:00:00Z" }),
      availableActions: { cancel: false, changeShippingAddress: false },
    })) });
    renderPurchaseRoute(routes, "/orders/700");
    expect(await screen.findByRole("heading", { level: 2, name: "En reparto" })).toBeInTheDocument();
    expect(screen.getByText(/salió a reparto con Servientrega/)).toBeInTheDocument();
    expect(screen.getByText("SE5566778899")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Seguir el envío/ })).toHaveAttribute("href", "https://tracking.example.invalid/SE5566778899");
    expect(screen.getByRole("list", { name: "Progreso del envío" }).querySelector('[aria-current="step"]')).toHaveTextContent("En reparto");
    expect(screen.queryByRole("button", { name: "Cancelar pedido" })).not.toBeInTheDocument();
  });

  it("shows an issued invoice without claiming electronic authorization or downloads", async () => {
    stubApi({ "GET /api/v1/orders/700": () => json(order({
      orderState: "DELIVERED", shipment: shipment("DELIVERED", { deliveredAt: "2026-10-07T17:00:00Z" }),
      availableActions: { cancel: false, changeShippingAddress: false },
      invoice: {
        invoiceId: "5", documentNumber: "PLG-0005", state: "ISSUED", buyerName: "Ana Pérez", identityType: "NATIONAL_ID", identityNumber: "1712345678",
        buyerEmail: null, currency: "USD", subtotal: "37.00", taxTotal: "0.00", total: "37.00", issuedAt: "2026-09-28T10:00:00Z",
        billingAddress: { line1: "Av. Principal 123", line2: null, city: "Quito", province: "Pichincha", countryCode: "EC", postalCode: null },
        items: [{ invoiceItemId: "1", orderItemId: "1", description: "Cien años de soledad", quantity: 2, unitPrice: "18.50", subtotal: "37.00", taxTreatment: "NOT_ASSESSED", taxRate: null, taxAmount: "0.00", total: "37.00" }],
        electronicIssuance: null, pdfAvailable: false, xmlAvailable: false,
      },
    })) });
    renderPurchaseRoute(routes, "/orders/700");
    expect(await screen.findByRole("heading", { level: 2, name: "Entregado" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Factura comercial N.° PLG-0005" })).toBeInTheDocument();
    expect(screen.getByText("No calculados")).toBeInTheDocument();
    expect(screen.getByText("Aún no disponible")).toBeInTheDocument();
    expect(screen.getByText(/todavía no es un comprobante electrónico autorizado/)).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /PDF|XML|Descargar/ })).not.toBeInTheDocument();
  });

  it("cancels an authorized order only after confirmation and then tells the refund", async () => {
    const api = stubApi({
      "GET /api/v1/orders/700": [
        () => json(order()),
        () => json(order({ orderState: "CANCELLED", purchaseState: "CANCELLED", payment: refunded, shipment: shipment("CANCELLED", { canceledAt: "2026-09-27T22:00:00Z" }),
          stateHistory: [{ historyId: "2", actorUserId: "2", origin: "USER", previousState: "CONFIRMED", newState: "CANCELLED", at: "2026-09-27T22:00:00Z" }], availableActions: { cancel: false, changeShippingAddress: false } })),
      ],
      "POST /api/v1/orders/700/cancel": () => json({ orderId: "700", previousState: "CONFIRMED", orderState: "CANCELLED", paymentState: "REFUNDED", restoredUnits: 2 }),
    });
    renderPurchaseRoute(routes, "/orders/700");
    await userEvent.click(await screen.findByRole("button", { name: "Cancelar pedido" }));
    expect(api.count("POST", "/api/v1/orders/700/cancel")).toBe(0);
    expect(screen.getByRole("button", { name: "Confirmar cancelación" })).toHaveFocus();
    await userEvent.click(screen.getByRole("button", { name: "Confirmar cancelación" }));
    expect(await screen.findByText(/El pago fue reembolsado/i)).toBeInTheDocument();
    expect(await screen.findByRole("heading", { level: 2, name: "Pedido cancelado" })).toBeInTheDocument();
    expect(screen.getByText("Tu pedido fue cancelado a petición tuya.")).toBeInTheDocument();
    expect(screen.getByText("Tu pago fue reembolsado.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Cancelar pedido" })).not.toBeInTheDocument();
    expect(api.count("POST", "/api/v1/orders/700/cancel")).toBe(1);
  });

  it("reads the order after an unknown cancellation response without replaying it", async () => {
    const api = stubApi({
      "GET /api/v1/orders/700": () => json(order()),
      "POST /api/v1/orders/700/cancel": () => { throw new TypeError("Lost response"); },
    });
    renderPurchaseRoute(routes, "/orders/700");
    await userEvent.click(await screen.findByRole("button", { name: "Cancelar pedido" }));
    await userEvent.click(screen.getByRole("button", { name: "Confirmar cancelación" }));
    expect(await screen.findByText(/La cancelación no aparece en el estado actual/)).toBeInTheDocument();
    expect(api.count("GET", "/api/v1/orders/700")).toBeGreaterThan(1);
    expect(api.count("POST", "/api/v1/orders/700/cancel")).toBe(1);
  });
});
