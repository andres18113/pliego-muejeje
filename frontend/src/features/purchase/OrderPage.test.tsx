import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { json, problem, renderPurchaseRoute, stubApi } from "@/test/purchase";
import { pickupOrder } from "@/test/pickup";
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

  const digitalOrder = (actions: Record<string, unknown>) => order({
    fulfillment: null, shipment: null, address: null,
    items: [{ ...order().items[0], requiresPhysicalFulfillment: false, format: "EBOOK", quantity: 1, subtotal: "18.50" }],
    availableActions: { cancel: false, changeShippingAddress: false, ...actions },
  });

  it("presents a digital purchase inside its window as confirmed and cancelable, as the server says", async () => {
    stubApi({ "GET /api/v1/orders/700": () => json(digitalOrder({ cancel: true, canCancel: true, lifecycleState: "CANCELLATION_WINDOW", cancellationDeadline: "2026-10-06T15:06:00Z", libraryAccessState: "OWNERSHIP_ONLY" })) });
    renderPurchaseRoute(routes, "/orders/700");
    expect(await screen.findByRole("heading", { level: 2, name: "Compra confirmada" })).toBeInTheDocument();
    expect(screen.getByText("Puedes cancelar este pedido durante los primeros 6 minutos.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Cancelar pedido" })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /Ver Mi biblioteca/ })).toBeNull();
    expect(document.body.textContent).not.toMatch(/15:06|CANCELLATION_WINDOW/);
  });

  it("thanks the customer and points to Mi biblioteca once the server finalizes a digital purchase", async () => {
    stubApi({ "GET /api/v1/orders/700": () => json(digitalOrder({ canCancel: false, lifecycleState: "COMPLETED", libraryAccessState: "OWNERSHIP_ONLY" })) });
    renderPurchaseRoute(routes, "/orders/700");
    expect(await screen.findByRole("heading", { level: 2, name: "¡Gracias por tu compra!" })).toBeInTheDocument();
    expect(screen.getByText("Tu compra está confirmada.")).toBeInTheDocument();
    expect(screen.getByText("Puedes revisar tus artículos comprados en Mi biblioteca.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Ver Mi biblioteca/ })).toHaveAttribute("href", "/biblioteca");
    expect(screen.queryByRole("button", { name: "Cancelar pedido" })).toBeNull();
    expect(document.body.textContent).not.toMatch(/Leer|Escuchar|Descargar/);
  });

  it("drops the cancel line when the server no longer offers cancellation, even inside the window state", async () => {
    stubApi({ "GET /api/v1/orders/700": () => json(digitalOrder({ canCancel: false, lifecycleState: "CANCELLATION_WINDOW" })) });
    renderPurchaseRoute(routes, "/orders/700");
    expect(await screen.findByRole("heading", { level: 2, name: "Compra confirmada" })).toBeInTheDocument();
    expect(screen.queryByText(/primeros 6 minutos/)).toBeNull();
    expect(screen.queryByRole("button", { name: "Cancelar pedido" })).toBeNull();
  });

  it("re-reads the order when the server's cancellation deadline arrives and shows what the server returns", async () => {
    const deadline = new Date(Date.now() + 300).toISOString();
    const api = stubApi({ "GET /api/v1/orders/700": [
      () => json(digitalOrder({ cancel: true, canCancel: true, lifecycleState: "CANCELLATION_WINDOW", cancellationDeadline: deadline })),
      () => json(digitalOrder({ canCancel: false, lifecycleState: "COMPLETED", libraryAccessState: "OWNERSHIP_ONLY", cancellationDeadline: deadline })),
    ] });
    renderPurchaseRoute(routes, "/orders/700");
    expect(await screen.findByRole("button", { name: "Cancelar pedido" })).toBeInTheDocument();
    expect(await screen.findByRole("heading", { level: 2, name: "¡Gracias por tu compra!" }, { timeout: 4000 })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Cancelar pedido" })).toBeNull();
    expect(api.count("GET", "/api/v1/orders/700")).toBe(2);
  });

  it("re-reads at once when the reported deadline has already passed, and never loops if the server still reports the window", async () => {
    const past = new Date(Date.now() - 60_000).toISOString();
    const api = stubApi({ "GET /api/v1/orders/700": () => json(digitalOrder({ cancel: true, canCancel: true, lifecycleState: "CANCELLATION_WINDOW", cancellationDeadline: past })) });
    renderPurchaseRoute(routes, "/orders/700");
    await screen.findByRole("heading", { level: 2, name: "Compra confirmada" });
    await waitFor(() => expect(api.count("GET", "/api/v1/orders/700")).toBe(2));
    await new Promise((resolve) => setTimeout(resolve, 1500));
    expect(api.count("GET", "/api/v1/orders/700")).toBe(2);
    // The server still offers cancellation, so the action stays: the client clock never removes it.
    expect(screen.getByRole("button", { name: "Cancelar pedido" })).toBeInTheDocument();
  });

  it("keeps a pickup order's own state and adds the window line only while it can be cancelled", async () => {
    stubApi({ "GET /api/v1/orders/700": () => json({ ...pickupOrder, availableActions: { cancel: true, changeShippingAddress: false, canCancel: true, lifecycleState: "CANCELLATION_WINDOW" } }) });
    renderPurchaseRoute(routes, "/orders/700");
    expect(await screen.findByText("Puedes cancelar este pedido durante los primeros 6 minutos.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Cancelar pedido" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { level: 2, name: /Gracias por tu compra/ })).toBeNull();
  });

  it("shows the historical saving in Pago and as a chip on the purchased book, from the snapshot only", async () => {
    const base = order();
    stubApi({ "GET /api/v1/orders/700": () => json(order({
      pricingSnapshotAvailable: true, originalSubtotal: "47.00", savingsTotal: "10.00", currentSubtotal: "37.00",
      subtotal: "37.00", taxRate: "15.00", taxAmount: "5.55", shippingAmount: "0.00", total: "42.55",
      items: [{ ...base.items[0], pricingSnapshotAvailable: true, originalPrice: "23.50", unitSavings: "5.00", originalSubtotal: "47.00", lineSavings: "10.00" }],
    })) });
    renderPurchaseRoute(routes, "/orders/700");
    const payment = await screen.findByRole("region", { name: "Pago" });
    const rows = [...payment.querySelectorAll("dl > div")].map((row) => [row.querySelector("dt")?.textContent, row.querySelector("dd")?.textContent?.replace(/\s+/g, " ")]);
    expect(rows).toEqual([["Subtotal", "$ 47,00"], ["Ahorro total", "-$ 10,00"], ["IVA (15 %)", "$ 5,55"], ["Gastos de envío", "$ 0,00"], ["Total pagado", "$ 42,55"]]);
    expect(payment.querySelector("[data-tone='savings']")).not.toBeNull();
    const book = screen.getByRole("heading", { level: 4, name: "Cien años de soledad" }).closest("li")!;
    expect(book.querySelector("s")?.textContent?.replace(/\s+/g, " ")).toBe("Precio anterior: $ 23,50");
    const chip = within(book).getByText(/Ahorraste \$\s*10,00 en este artículo/);
    expect(chip.closest("[data-order-saving]")?.querySelector(".material-symbol")?.textContent).toBe("sell");
    expect(within(payment).queryByText(/Ahorraste/)).toBeNull();
  });

  it("invents no saving for an order without a pricing snapshot", async () => {
    stubApi({ "GET /api/v1/orders/700": () => json(order({ pricingSnapshotAvailable: false, originalSubtotal: "47.00", savingsTotal: "10.00" })) });
    renderPurchaseRoute(routes, "/orders/700");
    const payment = await screen.findByRole("region", { name: "Pago" });
    expect(within(payment).queryByText("Ahorro total")).toBeNull();
    expect(within(payment).getByText("Total")).toBeInTheDocument();
    expect(document.querySelector("[data-order-saving]")).toBeNull();
  });

  it.each([["PREPARING","En preparación"],["IN_TRANSIT","En camino"],["OUT_FOR_DELIVERY","En reparto"],["DELIVERED","Entregado"]])("reads %s and cancel availability from the backend",async (state,label) => {
    stubApi({ "GET /api/v1/orders/700": () => json(order({ orderState: "CONFIRMED",shipment: shipment(state),availableActions: { cancel: false,changeShippingAddress: false } })) });
    renderPurchaseRoute(routes,"/orders/700");
    expect(await screen.findByRole("heading",{ level: 2,name: label })).toBeInTheDocument();
    expect(screen.queryByRole("button",{ name: "Cancelar pedido" })).not.toBeInTheDocument();
    if (state === "DELIVERED") {
      // Delivered reads as one completed state: no five-step list.
      expect(screen.queryByRole("list",{ name: "Progreso del envío" })).not.toBeInTheDocument();
      expect(screen.getByRole("group",{ name: "Progreso del envío" })).toHaveTextContent("Entregado");
      expect(screen.getByRole("group",{ name: "Progreso del envío" })).not.toHaveTextContent(/Confirmado|En preparación|En camino|En reparto/);
    } else expect(screen.getByRole("list",{ name: "Progreso del envío" }).querySelector('[aria-current="step"]')).toHaveTextContent(label);
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

  it("cancels a digital purchase inside its window and then shows the server's cancelled state", async () => {
    const api = stubApi({
      "GET /api/v1/orders/700": [
        () => json(digitalOrder({ cancel: true, canCancel: true, lifecycleState: "CANCELLATION_WINDOW", cancellationDeadline: new Date(Date.now() + 300_000).toISOString(), libraryAccessState: "OWNERSHIP_ONLY" })),
        () => json({ ...digitalOrder({ canCancel: false, lifecycleState: "CANCELLED", libraryAccessState: "NOT_APPLICABLE" }), orderState: "CANCELLED", purchaseState: "CANCELLED", payment: refunded,
          stateHistory: [{ historyId: "2", actorUserId: "2", origin: "USER", previousState: "CONFIRMED", newState: "CANCELLED", at: "2026-09-27T22:00:00Z" }] }),
      ],
      "POST /api/v1/orders/700/cancel": () => json({ orderId: "700", previousState: "CONFIRMED", orderState: "CANCELLED", paymentState: "REFUNDED", restoredUnits: 0 }),
    });
    renderPurchaseRoute(routes, "/orders/700");
    expect(await screen.findByText("Si lo cancelas, se reembolsará el pago y la compra dejará de estar en Mi biblioteca.")).toBeInTheDocument();
    expect(screen.queryByText(/Aún puedes cancelarlo/)).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "Cancelar pedido" }));
    await userEvent.click(await screen.findByRole("button", { name: "Confirmar cancelación" }));
    expect(await screen.findByRole("heading", { level: 2, name: "Pedido cancelado" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Cancelar pedido" })).toBeNull();
    expect(screen.queryByRole("link", { name: /Ver Mi biblioteca/ })).toBeNull();
    expect(api.count("POST", "/api/v1/orders/700/cancel")).toBe(1);
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
    const dialog = await screen.findByRole("dialog", { name: "¿Cancelar el pedido N.° 700?" });
    expect(within(dialog).getByText(/Se reembolsarán/)).toBeInTheDocument();
    await waitFor(() => expect(within(dialog).getByRole("button", { name: "Conservar pedido" })).toHaveFocus());
    await userEvent.click(within(dialog).getByRole("button", { name: "Confirmar cancelación" }));
    const notice = await screen.findByRole("status");
    expect(notice).toHaveTextContent("El pago fue reembolsado.No necesitas realizar ninguna acción adicional.");
    expect(notice).not.toHaveTextContent(/existencias|titularidad/);
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(await screen.findByRole("heading", { level: 2, name: "Pedido cancelado" })).toBeInTheDocument();
    expect(screen.getByText("Tu pedido fue cancelado a petición tuya.")).toBeInTheDocument();
    expect(screen.getByText("Tu pago fue reembolsado.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Cancelar pedido" })).not.toBeInTheDocument();
    expect(api.count("POST", "/api/v1/orders/700/cancel")).toBe(1);
  });

  it("keeps the order from the confirmation and returns focus to Cancelar pedido", async () => {
    const api = stubApi({ "GET /api/v1/orders/700": () => json(order()) });
    renderPurchaseRoute(routes, "/orders/700");
    const cancel = await screen.findByRole("button", { name: "Cancelar pedido" });
    await userEvent.click(cancel);
    const dialog = await screen.findByRole("dialog", { name: "¿Cancelar el pedido N.° 700?" });
    await userEvent.click(within(dialog).getByRole("button", { name: "Conservar pedido" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    await waitFor(() => expect(cancel).toHaveFocus());
    await userEvent.click(cancel);
    await screen.findByRole("dialog", { name: "¿Cancelar el pedido N.° 700?" });
    await userEvent.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    await waitFor(() => expect(cancel).toHaveFocus());
    expect(api.count("POST", "/api/v1/orders/700/cancel")).toBe(0);
  });

  it("reads the order after an unknown cancellation response without replaying it", async () => {
    const api = stubApi({
      "GET /api/v1/orders/700": () => json(order()),
      "POST /api/v1/orders/700/cancel": () => { throw new TypeError("Lost response"); },
    });
    renderPurchaseRoute(routes, "/orders/700");
    await userEvent.click(await screen.findByRole("button", { name: "Cancelar pedido" }));
    await userEvent.click(await screen.findByRole("button", { name: "Confirmar cancelación" }));
    expect(await screen.findByText(/La cancelación no aparece en el estado actual/)).toBeInTheDocument();
    expect(api.count("GET", "/api/v1/orders/700")).toBeGreaterThan(1);
    expect(api.count("POST", "/api/v1/orders/700/cancel")).toBe(1);
  });
});
