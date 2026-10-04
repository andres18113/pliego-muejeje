import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { json, problem, renderPurchaseRoute, stubApi } from "@/test/purchase";
import { OrderPage } from "./OrderPage";

const routes = [{ path: "/orders/:orderId", element: <OrderPage /> }];

function order(overrides: Record<string, unknown> = {}) {
  return {
    orderId: "700",
    orderState: "CONFIRMED",
    subtotal: "37.00",
    total: "37.00",
    createdAt: "2026-09-27T21:50:06Z",
    items: [{
      orderItemId: "1", editionId: "42", sku: "PLG-1", isbn: "9780306406157", title: "Cien años de soledad",
      authors: "Gabriel García Márquez", publisher: "Editorial Sur", format: "PAPERBACK", language: "es",
      unitPrice: "18.50", quantity: 2, subtotal: "37.00",
    }],
    address: {
      recipient: "Ana Pérez", line1: "Av. Principal 123", line2: null, city: "Quito", province: "Pichincha",
      countryCode: "EC", postalCode: null, reference: null, phone: "+59325550134",
    },
    payment: { paymentId: "9", method: "CARD", state: "APPROVED", amount: "37.00", reference: "SIM-550e8400", resultDetail: null },
    stateHistory: [],
    ...overrides,
  };
}

describe("OrderPage", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("confirms an approved order with its identifier and payment reference", async () => {
    stubApi({
      "GET /api/v1/orders/700": () => json(order()),
      "GET /api/v1/catalog/editions/42": () => json({ available: true, coverUrl: "https://covers.example.invalid/42.webp", coverLicense: null, coverAttribution: null }),
    });
    renderPurchaseRoute(routes, "/orders/700");

    const heading = await screen.findByRole("heading", { level: 1, name: "Pedido N.° 700 confirmado" });
    expect(heading).toHaveFocus();
    expect(screen.getByRole("link", { name: /Volver a mis pedidos/ })).toContainElement(screen.getByText(/2026/));
    expect(screen.getByText("Número de pedido").nextSibling).toHaveTextContent("700");
    expect(screen.getByRole("heading", { name: "Libros del pedido" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Cien años de soledad" })).toBeInTheDocument();
    expect(await screen.findByRole("img", { name: "Portada de Cien años de soledad" })).toBeInTheDocument();
    expect(screen.getByText("Total").parentElement).toHaveTextContent("$");
    expect(screen.getByRole("link", { name: "Ver mis pedidos" })).toBeVisible();
    await userEvent.click(screen.getByText("Pago", { exact: true }));
    expect(screen.getByText("Referencia de pago").nextSibling).toHaveTextContent("SIM-550e8400");
    expect(screen.queryByText(/4111/)).not.toBeInTheDocument();
  });

  it("explains a rejected payment without a payment reference", async () => {
    stubApi({
      "GET /api/v1/orders/701": () => json(order({
        orderId: "701",
        orderState: "CANCELLED",
        payment: { method: "TRANSFER", state: "REJECTED", amount: "37.00", reference: null },
      })),
    });
    renderPurchaseRoute(routes, "/orders/701");

    expect(await screen.findByRole("heading", { name: "No pudimos completar el pago" })).toBeInTheDocument();
    expect(screen.getByText(/Los libros siguen en tu carrito/)).toBeInTheDocument();
    expect(screen.queryByText("Referencia de pago")).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Revisar el carrito" })).toHaveAttribute("href", "/cart");
  });

  it("does not disclose whether a missing order exists", async () => {
    stubApi({ "GET /api/v1/orders/999": () => problem(404, "P5001", "Pedido no disponible", "No encontramos el pedido.") });
    renderPurchaseRoute(routes, "/orders/999");

    expect(await screen.findByRole("heading", { name: "No encontramos este pedido." })).toBeInTheDocument();
  });

  it("does not offer cancellation for a shipped order", async () => {
    stubApi({ "GET /api/v1/orders/700": () => json(order({ orderState: "SHIPPED" })) });
    renderPurchaseRoute(routes, "/orders/700");
    await userEvent.click(await screen.findByText("Cancelación", { exact: true }));
    expect(await screen.findByText("Este pedido ya no se puede cancelar desde tu cuenta.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Cancelar pedido" })).not.toBeInTheDocument();
  });

  it("shows state history and cancels an eligible order only after confirmation", async () => {
    const api = stubApi({
      "GET /api/v1/orders/700": [
        () => json(order({ stateHistory: [{ historyId: "1", newState: "CONFIRMED", at: "2026-09-27T21:50:06Z" }] })),
        () => json(order({ orderState: "CANCELLED", payment: { method: "CARD", state: "REFUNDED", amount: "37.00", reference: "SIM-550e8400" }, stateHistory: [{ historyId: "2", newState: "CANCELLED", at: "2026-09-27T22:00:00Z" }] })),
      ],
      "POST /api/v1/orders/700/cancel": () => json({ orderId: "700", previousState: "CONFIRMED", orderState: "CANCELLED", paymentState: "REFUNDED", restoredUnits: 2 }),
    });
    renderPurchaseRoute(routes, "/orders/700");
    await screen.findByText("Historial");
    await userEvent.click(screen.getByText("Historial", { exact: true }));
    expect(await screen.findByText("Confirmado")).toBeInTheDocument();
    await userEvent.click(screen.getByText("Cancelación", { exact: true }));
    await userEvent.click(screen.getByRole("button", { name: "Cancelar pedido" }));
    expect(api.count("POST", "/api/v1/orders/700/cancel")).toBe(0);
    expect(screen.getByRole("button", { name: "Confirmar cancelación" })).toHaveFocus();
    await userEvent.click(screen.getByRole("button", { name: "Confirmar cancelación" }));
    expect(await screen.findByText(/El pago fue reembolsado/i)).toBeInTheDocument();
    expect(api.count("POST", "/api/v1/orders/700/cancel")).toBe(1);
  });

  it("reads the order after an unknown cancellation response without replaying it", async () => {
    const api = stubApi({
      "GET /api/v1/orders/700": () => json(order()),
      "POST /api/v1/orders/700/cancel": () => { throw new TypeError("Lost response"); },
    });
    renderPurchaseRoute(routes, "/orders/700");
    await screen.findByText("Cancelación");
    await userEvent.click(screen.getByText("Cancelación", { exact: true }));
    await userEvent.click(screen.getByRole("button", { name: "Cancelar pedido" }));
    await userEvent.click(screen.getByRole("button", { name: "Confirmar cancelación" }));
    expect(await screen.findByText(/La cancelación no aparece en el estado actual/)).toBeInTheDocument();
    expect(api.count("GET", "/api/v1/orders/700")).toBeGreaterThan(1);
    expect(api.count("POST", "/api/v1/orders/700/cancel")).toBe(1);
  });
});
