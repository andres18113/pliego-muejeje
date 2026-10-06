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
  it.each(["EBOOK", "AUDIOBOOK"])("keeps digital format %s at one purchase unit", async (format) => {
    stubApi({ "GET /api/v1/cart": () => json(cartBody([{ format, quantity: 1, currentSubtotal: "18.50" }])) });
    renderPurchaseRoute(routes, "/cart");
    await screen.findByRole("link", { name: "Cien años de soledad" });
    expect(screen.queryByRole("combobox", { name: "Cantidad de Cien años de soledad" })).not.toBeInTheDocument();
    expect(screen.getByText("Cantidad: 1")).toBeInTheDocument();
    expect(screen.getByText(format === "EBOOK" ? "Ebook" : "Audiolibro")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Continuar con la compra" })).toBeInTheDocument();
  });
  it("uses the server quantity capability when the display format disagrees", async () => {
    stubApi({ "GET /api/v1/cart": () => json(cartBody([{ format: "PAPERBACK", requiresPhysicalFulfillment: false, quantityEditable: false }])) });
    renderPurchaseRoute(routes, "/cart");
    await screen.findByRole("link", { name: "Cien años de soledad" });
    expect(screen.queryByRole("combobox", { name: "Cantidad de Cien años de soledad" })).not.toBeInTheDocument();
    expect(screen.getByText("Cantidad: 1")).toBeInTheDocument();
  });
  it("keeps a malformed digital quantity repairable through the server capability", async () => {
    stubApi({ "GET /api/v1/cart": () => json(cartBody([{
      format: "EBOOK", quantity: 3, currentSubtotal: "55.50", available: false, unavailabilityReason: "P4004",
      requiresPhysicalFulfillment: false, quantityEditable: true,
    }])) });
    const user = userEvent.setup();
    renderPurchaseRoute(routes, "/cart");
    await user.click(await screen.findByRole("combobox", { name: "Cantidad de Cien años de soledad" }));
    expect(screen.getAllByRole("option").map(option => option.firstElementChild?.textContent)).toEqual(["1", "3"]);
  });
  afterEach(() => vi.unstubAllGlobals());

  const quantityOf = () => screen.findByRole("combobox", { name: "Cantidad de Cien años de soledad" });
  // Each option is its number plus a decorative check icon: read the number.
  const offered = () => screen.getAllByRole("option").map((option) => option.firstElementChild?.textContent);
  async function choose(user: ReturnType<typeof userEvent.setup>, quantity: string) {
    await user.click(await quantityOf());
    await user.click(await screen.findByRole("option", { name: quantity }));
  }

  it("shows server prices, the total, and a checkout entry for an available cart", async () => {
    stubApi({ "GET /api/v1/cart": () => json(cartBody([{ quantity: 2, currentSubtotal: "37.00" }])) });
    renderPurchaseRoute(routes, "/cart");

    const line = within(await screen.findByRole("region", { name: "Libros en tu carrito" })).getByRole("listitem");
    expect(within(line).getByRole("link", { name: "Cien años de soledad" })).toHaveAttribute("href", "/catalog/editions/42");
    // An item in the cart is buyable by definition: availability is only stated when it stops being true.
    expect(within(line).queryByText("Disponible")).not.toBeInTheDocument();
    expect(screen.queryByText("El carrito no reserva existencias", { exact: false })).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Seguir comprando" })).toHaveAttribute("href", "/catalog");
    expect(screen.getByRole("link", { name: "Continuar con la compra" })).toHaveAttribute("href", "/checkout");
    expect(screen.queryByRole("navigation", { name: "Etapas de la compra" })).not.toBeInTheDocument();
    // Without a backend breakdown the summary shows only the server total: nothing is derived here.
    expect(screen.getByText("Total").nextSibling).toHaveTextContent("37,00");
    expect(screen.queryByText(/IVA/)).not.toBeInTheDocument();
    expect(screen.queryByText("Subtotal")).not.toBeInTheDocument();
  });

  it("shows the commercial breakdown exactly as the backend reports it", async () => {
    stubApi({ "GET /api/v1/cart": () => json({ ...cartBody([{ quantity: 2, currentSubtotal: "37.00" }]), subtotal: "32.17", taxRate: "15.00", taxAmount: "4.83", shippingAmount: "3.50", total: "40.50" }) });
    renderPurchaseRoute(routes, "/cart");

    const summary = await screen.findByRole("complementary", { name: "Resumen del pedido" });
    expect(within(summary).getByText("Subtotal").nextSibling).toHaveTextContent("32,17");
    expect(within(summary).getByText("IVA (15 %)").nextSibling).toHaveTextContent("4,83");
    expect(within(summary).getByText("Envío").nextSibling).toHaveTextContent("3,50");
    expect(within(summary).getByText("Total").nextSibling).toHaveTextContent("40,50");
  });

  it("sets an absolute quantity with PUT and shows the refreshed server state", async () => {
    const api = stubApi({
      "GET /api/v1/cart": [
        () => json(cartBody()),
        () => json(cartBody([{ quantity: 4, currentSubtotal: "74.00" }])),
      ],
      "PUT /api/v1/cart/items/100": () => json({ cartId: "40", cartItemId: "100", quantity: 4 }),
    });
    const user = userEvent.setup();
    renderPurchaseRoute(routes, "/cart");

    await user.click(await quantityOf());
    expect(offered()).toEqual(["1", "2", "3", "4", "5", "6", "7", "8", "9", "10"]);
    expect(screen.getByRole("option", { name: "1" })).toHaveAttribute("aria-selected", "true");
    await user.click(screen.getByRole("option", { name: "4" }));

    expect(await screen.findByText("Cantidad actualizada: 4 unidades.")).toBeInTheDocument();
    expect(api.calls.find((call) => call.method === "PUT")?.body).toEqual({ quantity: 4 });
    expect(await quantityOf()).toHaveTextContent("4");
    expect(screen.queryByRole("option")).not.toBeInTheDocument();
  });

  it("keeps a quantity above ten selectable and stops at the current one when stock cannot grow", async () => {
    stubApi({ "GET /api/v1/cart": () => json(cartBody([{ quantity: 12, currentSubtotal: "222.00" }, { quantity: 3, currentSubtotal: "55.50", available: false, unavailabilityReason: "P3002" }])) });
    renderPurchaseRoute(routes, "/cart");

    const user = userEvent.setup();
    expect(await quantityOf()).toHaveTextContent("12");
    const limited = screen.getByRole("combobox", { name: "Cantidad de Edición 1" });
    await user.click(limited);
    expect(offered()).toEqual(["1", "2", "3"]);
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("option")).not.toBeInTheDocument();
    expect(limited).toHaveFocus();
    expect(limited).toHaveAccessibleDescription(/No disponible.*No hay existencias suficientes para esta cantidad/);
  });

  it("explains P3002 on a quantity change and leaves the quantity unchanged", async () => {
    stubApi({
      "GET /api/v1/cart": () => json(cartBody()),
      "PUT /api/v1/cart/items/100": () => problem(409, "P3002", "Existencias insuficientes", "No hay existencias suficientes para la cantidad solicitada."),
    });
    const user = userEvent.setup();
    renderPurchaseRoute(routes, "/cart");

    await choose(user, "2");

    expect(await screen.findByRole("alert")).toHaveTextContent("No hay existencias suficientes para 2 unidades. La cantidad no cambió.");
    expect(await quantityOf()).toHaveTextContent("1");
  });

  it("uses the server quantity violation as line feedback and preserves the current quantity", async () => {
    stubApi({
      "GET /api/v1/cart": () => json(cartBody()),
      "PUT /api/v1/cart/items/100": () => json({code:"VALIDATION_ERROR",title:"Datos inválidos",detail:"Revisa los datos.",
        violations:[{field:"quantity",message:"Escribe una cantidad entera de hasta 2147483647, sin decimales."}]},400),
    });
    renderPurchaseRoute(routes,"/cart");
    const user=userEvent.setup();
    await choose(user, "2");
    expect(await screen.findByRole("alert")).toHaveTextContent("Escribe una cantidad entera de hasta 2147483647, sin decimales.");
    expect(await quantityOf()).toHaveTextContent("1");
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

  it("removes an item with DELETE and offers to put it back with its quantity", async () => {
    const api = stubApi({
      "GET /api/v1/cart": [() => json(cartBody([{ quantity: 2, currentSubtotal: "37.00" }])), () => json(cartBody([])), () => json(cartBody([{ cartItemId: "101", quantity: 2, currentSubtotal: "37.00" }]))],
      "DELETE /api/v1/cart/items/100": () => new Response(null, { status: 204 }),
      "POST /api/v1/cart/items": () => json({ cartId: "40", cartItemId: "101", quantity: 2 }, 201),
    });
    const user = userEvent.setup();
    renderPurchaseRoute(routes, "/cart");

    await user.click(await screen.findByRole("button", { name: "Quitar Cien años de soledad del carrito" }));

    expect(await screen.findByText("Quitado del carrito")).toBeInTheDocument();
    const empty = await screen.findByRole("heading", { name: "Tu carrito está vacío." });
    await vi.waitFor(() => expect(empty).toHaveFocus());

    await user.click(screen.getByRole("button", { name: "Deshacer" }));
    expect(await screen.findByText("Devuelto al carrito")).toBeInTheDocument();
    expect(api.calls.find((call) => call.method === "POST")?.body).toEqual({ editionId: "42", quantity: 2 });
    await vi.waitFor(() => expect(screen.getByRole("link", { name: "Cien años de soledad" })).toHaveFocus());
  });

  it("saves an item for later in Favoritos before taking it out of the cart", async () => {
    const api = stubApi({
      "GET /api/v1/cart": [() => json(cartBody()), () => json(cartBody([]))],
      "PUT /api/v1/me/favorites/42": () => new Response(null, { status: 204 }),
      "DELETE /api/v1/cart/items/100": () => new Response(null, { status: 204 }),
    });
    const user = userEvent.setup();
    renderPurchaseRoute(routes, "/cart");

    await user.click(await screen.findByRole("button", { name: "Guardar Cien años de soledad para después" }));

    expect(await screen.findByText("Guardado en Favoritos")).toBeInTheDocument();
    const order = api.calls.filter((call) => call.method !== "GET").map((call) => call.method);
    expect(order).toEqual(["PUT", "DELETE"]);
  });

  it("chooses a quantity from the keyboard without leaving the trigger", async () => {
    const api = stubApi({
      "GET /api/v1/cart": [() => json(cartBody()), () => json(cartBody([{ quantity: 3, currentSubtotal: "55.50" }]))],
      "PUT /api/v1/cart/items/100": () => json({ cartId: "40", cartItemId: "100", quantity: 3 }),
    });
    const user = userEvent.setup();
    renderPurchaseRoute(routes, "/cart");

    const trigger = await quantityOf();
    trigger.focus();
    await user.keyboard("{ArrowDown}{ArrowDown}{ArrowDown}{Enter}");

    expect(await screen.findByText("Cantidad actualizada: 3 unidades.")).toBeInTheDocument();
    expect(api.calls.find((call) => call.method === "PUT")?.body).toEqual({ quantity: 3 });
    expect(await quantityOf()).toHaveFocus();
  });

  it("shows what was saved for later from Favoritos, below the cart", async () => {
    stubApi({
      "GET /api/v1/cart": () => json(cartBody()),
      "GET /api/v1/me/favorites": () => json({ items: [{ editionId: "77", bookId: "30", title: "Rayuela", authors: "Julio Cortázar", publisher: "Alfaguara", isbn13: null, price: "21.00", coverUrl: null, coverLicense: null, coverAttribution: null, format: "PAPERBACK", language: "es", available: true, favoritedAt: "2026-10-01T12:00:00Z" }], page: 0, pageSize: 4, totalCount: "6" }),
    });
    renderPurchaseRoute(routes, "/cart");

    const saved = await screen.findByRole("region", { name: "Guardado para después" });
    expect(await within(saved).findByRole("heading", { name: "Rayuela" })).toBeInTheDocument();
    expect(within(saved).getByRole("link", { name: "Favoritos" })).toHaveAttribute("href", "/favorites");
    expect(within(saved).getByRole("link", { name: "Ver los 6 en Favoritos" })).toHaveAttribute("href", "/favorites");
  });

  it("invites saving books when nothing is saved for later", async () => {
    stubApi({ "GET /api/v1/cart": () => json(cartBody()) });
    renderPurchaseRoute(routes, "/cart");

    const saved = await screen.findByRole("region", { name: "Guardado para después" });
    expect(await within(saved).findByText("No hay libros guardados")).toBeInTheDocument();
    expect(within(saved).getByText("Guarda aquí los libros que no comprarás hoy.")).toBeInTheDocument();
  });

  it("keeps the item in the cart when it cannot be saved for later", async () => {
    const api = stubApi({
      "GET /api/v1/cart": () => json(cartBody()),
      "PUT /api/v1/me/favorites/42": () => problem(404, "P2041", "Edición no encontrada", "La edición ya no está publicada."),
    });
    const user = userEvent.setup();
    renderPurchaseRoute(routes, "/cart");

    await user.click(await screen.findByRole("button", { name: "Guardar Cien años de soledad para después" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Sigue en tu carrito.");
    expect(api.count("DELETE", "/api/v1/cart/items")).toBe(0);
  });

  it("recovers from an unconfirmed change by re-reading the cart instead of repeating it", async () => {
    const api = stubApi({
      "GET /api/v1/cart": () => json(cartBody()),
      "PUT /api/v1/cart/items/100": () => { throw new TypeError("Failed to fetch"); },
    });
    const user = userEvent.setup();
    renderPurchaseRoute(routes, "/cart");

    await choose(user, "2");

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
