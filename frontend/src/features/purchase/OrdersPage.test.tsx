import { screen } from "@testing-library/react";
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
