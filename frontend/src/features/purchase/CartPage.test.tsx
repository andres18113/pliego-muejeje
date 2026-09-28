import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cartBody, json, problem, renderPurchaseRoute, stubApi } from "@/test/purchase";
import { CartPage } from "./CartPage";

const routes = [
  { path: "/cart", element: <CartPage /> },
  { path: "/checkout", element: <h1>Finalizar compra</h1> },
];

describe("CartPage", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("shows server prices, totals, and a checkout entry for an available cart", async () => {
    stubApi({ "GET /api/v1/cart": () => json(cartBody([{ quantity: 2, currentSubtotal: "37.00" }])) });
    renderPurchaseRoute(routes, "/cart");

    const line = await screen.findByRole("listitem");
    expect(within(line).getByRole("link", { name: "Cien años de soledad" })).toHaveAttribute("href", "/catalog/editions/42");
    expect(within(line).getByText("Disponible")).toBeInTheDocument();
    expect(screen.getByText("El carrito no reserva existencias.", { exact: false })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Continuar con la compra" })).toHaveAttribute("href", "/checkout");
    expect(screen.getByText("Unidades").nextSibling).toHaveTextContent("2");
  });

  it("sets an absolute quantity with PUT and shows the refreshed server state", async () => {
    const api = stubApi({
      "GET /api/v1/cart": [
        () => json(cartBody()),
        () => json(cartBody([{ quantity: 2, currentSubtotal: "37.00" }])),
      ],
      "PUT /api/v1/cart/items/100": () => json({ cartId: "40", cartItemId: "100", quantity: 2 }),
    });
    const user = userEvent.setup();
    renderPurchaseRoute(routes, "/cart");

    await user.click(await screen.findByRole("button", { name: "Agregar una unidad de Cien años de soledad" }));

    expect(await screen.findByText("Cantidad actualizada: 2 unidades.")).toBeInTheDocument();
    expect(api.calls.find((call) => call.method === "PUT")?.body).toEqual({ quantity: 2 });
    expect(screen.getByRole("button", { name: "Agregar una unidad de Cien años de soledad" })).toHaveFocus();
  });

  it("keeps the decrease control focusable at one unit without sending zero", async () => {
    const api = stubApi({ "GET /api/v1/cart": () => json(cartBody()) });
    const user = userEvent.setup();
    renderPurchaseRoute(routes, "/cart");

    const decrease = await screen.findByRole("button", { name: "Quitar una unidad de Cien años de soledad" });
    expect(decrease).toHaveAttribute("aria-disabled", "true");
    await user.click(decrease);
    expect(api.count("PUT", "/api/v1/cart/items")).toBe(0);
  });

  it("explains P3002 on a quantity change and leaves the quantity unchanged", async () => {
    stubApi({
      "GET /api/v1/cart": () => json(cartBody()),
      "PUT /api/v1/cart/items/100": () => problem(409, "P3002", "Existencias insuficientes", "No hay existencias suficientes para la cantidad solicitada."),
    });
    const user = userEvent.setup();
    renderPurchaseRoute(routes, "/cart");

    await user.click(await screen.findByRole("button", { name: "Agregar una unidad de Cien años de soledad" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("No hay existencias suficientes para 2 unidades. La cantidad no cambió.");
  });

  it("keeps unavailable items visible with their reason and blocks checkout", async () => {
    stubApi({
      "GET /api/v1/cart": () => json(cartBody([{}, { available: false, unavailabilityReason: "P2042" }])),
    });
    renderPurchaseRoute(routes, "/cart");

    expect(await screen.findByText("Esta edición ya no está a la venta.")).toBeInTheDocument();
    expect(screen.getByText("Cantidad: 1")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Continuar con la compra" })).not.toBeInTheDocument();
    expect(screen.getByText("Ajusta o quita los libros no disponibles para continuar con la compra.")).toBeInTheDocument();
  });

  it("removes an item with DELETE and moves focus to the result", async () => {
    stubApi({
      "GET /api/v1/cart": [() => json(cartBody()), () => json(cartBody([]))],
      "DELETE /api/v1/cart/items/100": () => new Response(null, { status: 204 }),
    });
    const user = userEvent.setup();
    renderPurchaseRoute(routes, "/cart");

    await user.click(await screen.findByRole("button", { name: "Quitar Cien años de soledad del carrito" }));

    const notice = await screen.findByText("Quitamos «Cien años de soledad» del carrito.");
    expect(await screen.findByRole("heading", { name: "Tu carrito está vacío." })).toBeInTheDocument();
    await vi.waitFor(() => expect(notice).toHaveFocus());
  });

  it("recovers from an unconfirmed change by re-reading the cart instead of repeating it", async () => {
    const api = stubApi({
      "GET /api/v1/cart": () => json(cartBody()),
      "PUT /api/v1/cart/items/100": () => { throw new TypeError("Failed to fetch"); },
    });
    const user = userEvent.setup();
    renderPurchaseRoute(routes, "/cart");

    await user.click(await screen.findByRole("button", { name: "Agregar una unidad de Cien años de soledad" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("No pudimos confirmar el cambio.");
    expect(api.count("PUT", "/api/v1/cart/items")).toBe(1);
    expect(api.count("GET", "/api/v1/cart")).toBe(2);
  });

  it("shows an empty cart with a route back to the catalog", async () => {
    stubApi({ "GET /api/v1/cart": () => json(cartBody([])) });
    renderPurchaseRoute(routes, "/cart");

    expect(await screen.findByRole("heading", { name: "Tu carrito está vacío." })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Ir al catálogo" })).toHaveAttribute("href", "/catalog");
  });

  it("denies the cart to an administrator", async () => {
    stubApi({});
    renderPurchaseRoute(routes, "/cart", { role: "ADMIN" });

    expect(await screen.findByRole("heading", { name: "Esta página no está disponible para tu cuenta." })).toBeInTheDocument();
  });
});
