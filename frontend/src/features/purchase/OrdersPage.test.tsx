import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { json, problem, renderPurchaseRoute, stubApi } from "@/test/purchase";
import { OrdersPage } from "./OrdersPage";

const routes = [{ path: "/orders", element: <OrdersPage /> }];

describe("OrdersPage", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("shows paginated orders and opens detail", async () => {
    const api = stubApi({ "GET /api/v1/orders": (request) => {
      const page = Number(new URL(request.url).searchParams.get("page"));
      return json({ items: [{ orderId: String(700 - page), createdAt: "2026-09-27T21:50:06Z", orderState: "CONFIRMED", total: "37.00", paymentState: "APPROVED" }], page, pageSize: 10, totalCount: "11" });
    } });
    const { router } = renderPurchaseRoute([...routes, { path: "/orders/:orderId", element: <p>Detalle</p> }], "/orders");
    expect(await screen.findByRole("link", { name: /Pedido n.º 700/ })).toHaveAttribute("href", "/orders/700");
    await userEvent.click(screen.getByRole("button", { name: "Siguiente" }));
    expect(await screen.findByRole("link", { name: /Pedido n.º 699/ })).toBeInTheDocument();
    expect(api.calls.some((call) => call.path.includes("page=1"))).toBe(true);
    expect(router.state.location.search).toBe("?page=1");
    await userEvent.click(screen.getByRole("link", { name: /Pedido n.º 699/ }));
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
