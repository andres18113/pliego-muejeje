import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { json, problem, renderPurchaseRoute, stubApi } from "@/test/purchase";
import { OrdersPage } from "./OrdersPage";
import { orderDetailFixture } from "@/test/orders";
import { pickupOrder } from "@/test/pickup";

const routes = [{ path: "/orders", element: <OrdersPage /> }];

/** CustomerOrderSummary as served by API v1.0.8. */
function summary(overrides: Record<string, unknown> = {}) {
  return {
    orderId: "700", createdAt: "2026-09-27T21:50:06Z", orderState: "SHIPPED", total: "37.00", paymentState: "APPROVED",
    purchaseState: "CONFIRMED", fulfillmentMethod: "HOME_DELIVERY", shipmentState: "SHIPPED",
    estimatedDeliveryFrom: "2026-10-09T14:00:00Z", estimatedDeliveryTo: "2026-10-10T23:00:00Z",
    itemCount: 4, unitCount: 5,
    itemSummary: [
      { orderItemId: "1", title: "Cien años de soledad", format: "PAPERBACK", quantity: 2 },
      { orderItemId: "2", title: "El extranjero", format: "PAPERBACK", quantity: 1 },
      { orderItemId: "3", title: "Anna Karénina", format: "HARDCOVER", quantity: 1 },
    ],
    invoiceState: null, invoicePdfAvailable: false, invoiceXmlAvailable: false,
    ...overrides,
  };
}

describe("OrdersPage", () => {
  afterEach(() => vi.unstubAllGlobals());

  it.each([["PREPARING","En preparación"],["IN_TRANSIT","En camino"],["OUT_FOR_DELIVERY","En reparto"],["DELIVERED","Entregado"]])("uses reconciled detail %s rather than a stale list snapshot",async (state,label) => {
    stubApi({
      "GET /api/v1/orders": () => json({ items: [summary({ orderState: "CONFIRMED",shipmentState: "PREPARING" })],page: 0,pageSize: 10,totalCount: "1" }),
      "GET /api/v1/orders/700": () => json(orderDetailFixture(state)),
    });
    renderPurchaseRoute(routes,"/orders");
    expect(await screen.findByRole("link",{ name: new RegExp(`${label}.*Pedido N.° 700`) })).toHaveTextContent(label);
  });

  it("reflects a historical saving under the total only when the order's snapshot holds one", async () => {
    stubApi({
      "GET /api/v1/orders": () => json({ items: [
        summary({ orderId: "700", pricingSnapshotAvailable: true, originalSubtotal: "47.00", savingsTotal: "10.00", currentSubtotal: "37.00" }),
        summary({ orderId: "701", pricingSnapshotAvailable: false, originalSubtotal: null, savingsTotal: null }),
      ], page: 0, pageSize: 10, totalCount: "2" }),
      "GET /api/v1/orders/700": () => json(orderDetailFixture("PREPARING", { pricingSnapshotAvailable: true, originalSubtotal: "47.00", savingsTotal: "10.00", currentSubtotal: "37.00" })),
      "GET /api/v1/orders/701": () => json(orderDetailFixture("PREPARING", { orderId: "701", pricingSnapshotAvailable: false, originalSubtotal: null, savingsTotal: null })),
    });
    renderPurchaseRoute(routes, "/orders");
    const saved = await screen.findByRole("link", { name: /Pedido N.° 700/ });
    expect(await within(saved).findByText(/Ahorraste \$\s*10,00/)).toBeInTheDocument();
    expect(saved.querySelector("[data-order-saving] .material-symbol")?.textContent).toBe("sell");
    const plain = screen.getByRole("link", { name: /Pedido N.° 701/ });
    expect(plain.querySelector("[data-order-saving]")).toBeNull();
  });

  const digitalDetail = (orderId: string, actions: Record<string, unknown>) => orderDetailFixture("PREPARING", {
    orderId, fulfillment: null, shipment: null, address: null,
    items: [{ orderItemId: "1", editionId: "306", title: "La mujer en la historia", authors: "Autora", publisher: "Editorial", requiresPhysicalFulfillment: false, format: "EBOOK", unitPrice: "14.25", quantity: 1, subtotal: "14.25" }],
    availableActions: { cancel: false, changeShippingAddress: false, ...actions },
  });
  const digitalSummary = (orderId: string) => summary({ orderId, fulfillmentMethod: "DIGITAL_ONLY", shipmentState: null, orderState: "CONFIRMED", estimatedDeliveryFrom: null, estimatedDeliveryTo: null,
    itemSummary: [{ orderItemId: "1", title: "La mujer en la historia", format: "EBOOK", quantity: 1 }] });

  it("tells a cancelable digital purchase from a completed one, concisely and without technical data", async () => {
    stubApi({
      "GET /api/v1/orders": () => json({ items: [digitalSummary("800"), digitalSummary("801")], page: 0, pageSize: 10, totalCount: "2" }),
      "GET /api/v1/orders/800": () => json(digitalDetail("800", { cancel: true, canCancel: true, lifecycleState: "CANCELLATION_WINDOW", cancellationDeadline: new Date(Date.now() + 300_000).toISOString() })),
      "GET /api/v1/orders/801": () => json(digitalDetail("801", { canCancel: false, lifecycleState: "COMPLETED", libraryAccessState: "OWNERSHIP_ONLY" })),
    });
    renderPurchaseRoute(routes, "/orders");
    const open = await screen.findByRole("region", { name: "En curso" });
    const window = await within(open).findByRole("link", { name: /Compra confirmada.*Pedido N.° 800/ });
    expect(await within(window).findByText("Puedes cancelarlo durante los primeros 6 minutos.")).toBeInTheDocument();
    const past = screen.getByRole("region", { name: "Anteriores" });
    const done = await within(past).findByRole("link", { name: /Compra completada.*Pedido N.° 801/ });
    expect(within(done).getByText("Disponible en Mi biblioteca.")).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/CANCELLATION_WINDOW|COMPLETED|OWNERSHIP_ONLY/);
  });

  it("marks a pickup order inside its window as cancelable while keeping its pickup state", async () => {
    stubApi({
      "GET /api/v1/orders": () => json({ items: [summary({ fulfillmentMethod: "STORE_PICKUP", shipmentState: null })], page: 0, pageSize: 10, totalCount: "1" }),
      "GET /api/v1/orders/700": () => json({ ...pickupOrder, availableActions: { cancel: true, changeShippingAddress: false, canCancel: true, lifecycleState: "CANCELLATION_WINDOW", cancellationDeadline: new Date(Date.now() + 300_000).toISOString() } }),
    });
    renderPurchaseRoute(routes, "/orders");
    const row = await screen.findByRole("link", { name: /Pedido N.° 700/ });
    expect(await within(row).findByText("Puedes cancelarlo durante los primeros 6 minutos.")).toBeInTheDocument();
  });

  it("re-reads the list when a cancelable order's deadline arrives", async () => {
    const deadline = new Date(Date.now() + 300).toISOString();
    stubApi({
      "GET /api/v1/orders": () => json({ items: [digitalSummary("800")], page: 0, pageSize: 10, totalCount: "1" }),
      "GET /api/v1/orders/800": [
        () => json(digitalDetail("800", { cancel: true, canCancel: true, lifecycleState: "CANCELLATION_WINDOW", cancellationDeadline: deadline })),
        () => json(digitalDetail("800", { canCancel: false, lifecycleState: "COMPLETED", libraryAccessState: "OWNERSHIP_ONLY", cancellationDeadline: deadline })),
      ],
    });
    renderPurchaseRoute(routes, "/orders");
    expect(await screen.findByText("Puedes cancelarlo durante los primeros 6 minutos.")).toBeInTheDocument();
    expect(await screen.findByRole("link", { name: /Compra completada.*Pedido N.° 800/ }, { timeout: 4000 })).toBeInTheDocument();
    expect(screen.queryByText(/primeros 6 minutos/)).toBeNull();
  });

  it("keeps collected STORE_PICKUP separate from delivery state",async () => {
    stubApi({
      "GET /api/v1/orders": () => json({ items: [summary({ fulfillmentMethod: "STORE_PICKUP",shipmentState: null })],page: 0,pageSize: 10,totalCount: "1" }),
      "GET /api/v1/orders/700": () => json({ ...pickupOrder,orderState: "DELIVERED",fulfillment: { ...pickupOrder.fulfillment,state: "COLLECTED" } }),
    });
    renderPurchaseRoute(routes,"/orders");
    expect(await screen.findByRole("link",{ name: /Retirado.*Pedido N.° 700/ })).not.toHaveTextContent("Entregado");
  });

  it("presents each order as one unit led by its server state", async () => {
    stubApi({ "GET /api/v1/orders": () => json({ items: [
      summary(),
      summary({ orderId: "699", orderState: "CANCELLED", purchaseState: "CANCELLED", paymentState: "REFUNDED", shipmentState: "CANCELLED", estimatedDeliveryFrom: null, estimatedDeliveryTo: null, itemCount: 1, unitCount: 1, itemSummary: [{ orderItemId: "9", title: "Crimen y castigo", format: "PAPERBACK", quantity: 1 }], invoiceState: "ISSUED" }),
    ], page: 0, pageSize: 10, totalCount: "2" }) });
    renderPurchaseRoute(routes, "/orders");
    const shipped = await screen.findByRole("link", { name: /Pedido N.° 700/ });
    expect(shipped).toHaveTextContent("En camino");
    expect(shipped).toHaveTextContent(/Llega entre el/);
    expect(shipped).toHaveTextContent("El extranjero");
    expect(shipped).toHaveTextContent("y 1 libro más");
    expect(shipped).toHaveTextContent("5 unidades");
    const cancelled = screen.getByRole("link", { name: /Pedido N.° 699/ });
    expect(cancelled).toHaveTextContent("Pedido cancelado");
    expect(cancelled).toHaveTextContent("Pago reembolsado");
    expect(cancelled).toHaveTextContent("Factura emitida");
  });

  it("shows paginated orders and opens detail", async () => {
    const api = stubApi({ "GET /api/v1/orders": (request) => {
      const page = Number(new URL(request.url).searchParams.get("page"));
      return json({ items: [summary({ orderId: String(700 - page) })], page, pageSize: 10, totalCount: "11" });
    } });
    const { router } = renderPurchaseRoute([...routes, { path: "/orders/:orderId", element: <p>Detalle</p> }], "/orders");
    expect(await screen.findByRole("link", { name: /Pedido N.° 700/ })).toHaveAttribute("href", "/orders/700");
    await userEvent.click(screen.getByRole("button", { name: "Siguiente" }));
    expect(await screen.findByRole("link", { name: /Pedido N.° 699/ })).toBeInTheDocument();
    expect(api.calls.some((call) => call.path.includes("page=1"))).toBe(true);
    expect(router.state.location.search).toBe("?page=1");
    await userEvent.click(screen.getByRole("link", { name: /Pedido N.° 699/ }));
    expect(router.state.location.state).toEqual({ ordersPage: 1 });
    await router.navigate(-1);
    expect(router.state.location.search).toBe("?page=1");
  });

  it("distinguishes empty history from a failed read", async () => {
    stubApi({ "GET /api/v1/orders": () => json({ items: [], page: 0, pageSize: 10, totalCount: "0" }) });
    renderPurchaseRoute(routes, "/orders");
    expect(await screen.findByRole("heading", { name: "Aún no tienes pedidos." })).toBeInTheDocument();
  });

  it("offers a retry after an API failure", async () => {
    stubApi({ "GET /api/v1/orders": () => problem(503, "SERVICE_UNAVAILABLE", "No disponible", "Vuelve a intentarlo.") });
    renderPurchaseRoute(routes, "/orders");
    expect(await screen.findByRole("heading", { name: "No pudimos consultar tus pedidos." })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Volver a intentar" })).toBeInTheDocument();
  });

  it("returns an expired session to sign-in without showing order data", async () => {
    stubApi({ "GET /api/v1/orders": () => problem(401, "UNAUTHORIZED", "Sesión caducada", "Vuelve a iniciar sesión.") });
    renderPurchaseRoute(routes, "/orders");
    expect(await screen.findByRole("heading", { name: "Tu sesión ya no está activa." })).toBeInTheDocument();
    expect(screen.getAllByRole("link", { name: "Iniciar sesión" }).some((link) => link.getAttribute("href") === "/sign-in?from=%2Forders")).toBe(true);
  });
});
