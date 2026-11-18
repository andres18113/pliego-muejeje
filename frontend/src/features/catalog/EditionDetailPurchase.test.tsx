import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CartPreviewProvider } from "@/features/purchase/CartPreview";
import { cartBody, json, problem, renderPurchaseRoute, stubApi } from "@/test/purchase";
import { EditionDetailPage } from "./EditionDetailPage";

const edition = {
  editionId: "42", bookId: "17", title: "Cien años de soledad",
  authors: [{ authorId: "9", name: "Gabriel García Márquez", order: 1 }],
  categories: [], publisher: { publisherId: "5", name: "Editorial Sur" },
  isbn13: "9780306406157", sku: "PLG-LIT-042", language: "es", format: "PAPERBACK", price: "18.50",
  coverUrl: null, coverLicense: null, coverSourceUrl: null, coverAttribution: null, available: true,
};

const routes = [{ path: "/catalog/editions/:editionId", element: <EditionDetailPage /> }];
/** The storefront layout provides the cart drawer; without it a page simply stays put. */
const withDrawer = [{ path: "/catalog/editions/:editionId", element: <CartPreviewProvider><EditionDetailPage /></CartPreviewProvider> }];

describe("EditionDetailPage purchase", () => {
  it.each(["EBOOK", "AUDIOBOOK"])("does not add a second unit of an already present %s", async (format) => {
    const post = vi.fn(() => json({ cartId: "7", cartItemId: "13", quantity: 2 }));
    stubApi({
      "GET /api/v1/catalog/editions/42": () => json({ ...edition, format, isbn13: null, ebookFileFormat: null,
        audioDurationSeconds: format === "AUDIOBOOK" ? 1234 : null, narrators: format === "AUDIOBOOK" ? ["Narrador DEMO"] : [] }),
      "GET /api/v1/cart": () => json({ cartId: "7", state: "ACTIVE", items: [{ editionId: "42", quantity: 1 }], totalCurrent: "18.50" }),
      "POST /api/v1/cart/items": post,
    });
    renderPurchaseRoute(routes, "/catalog/editions/42");
    await userEvent.setup().click(await screen.findByRole("button", { name: "Agregar al carrito" }));
    expect(await screen.findByText("Esta edición digital ya está en tu carrito.")).toBeInTheDocument();
    expect(post).not.toHaveBeenCalled();
  });
  afterEach(() => vi.unstubAllGlobals());

  it("keeps edition availability separate from a quantity conflict, and opens no cart", async () => {
    stubApi({
      "GET /api/v1/catalog/editions/42": () => json(edition),
      "GET /api/v1/cart": () => json({ cartId: null, state: null, items: [], totalCurrent: "0.00" }),
      "POST /api/v1/cart/items": () => problem(409, "P3002", "Existencias insuficientes", "No hay existencias suficientes para la cantidad solicitada."),
    });
    const user = userEvent.setup();
    renderPurchaseRoute(withDrawer, "/catalog/editions/42");

    await user.click(await screen.findByRole("button", { name: "Agregar al carrito" }));

    expect(await screen.findByText("No hay existencias suficientes para esta cantidad en tu carrito."))
      .toBeInTheDocument();
    expect(screen.getByText("Disponible")).toBeVisible();
    expect(await screen.findByRole("button", { name: "Agregar al carrito" })).toBeEnabled();
    expect(screen.queryByRole("dialog", { name: "Tu carrito" })).not.toBeInTheDocument();
  });

  it("adds the chosen count of a physical edition to what the cart holds, and says so in one line", async () => {
    let units = 2;
    const api = stubApi({
      "GET /api/v1/catalog/editions/42": () => json(edition),
      "GET /api/v1/cart": () => json(cartBody([{ editionId: "42", title: edition.title, quantity: units }])),
      "POST /api/v1/cart/items": async (request: Request) => {
        units += (await request.clone().json() as { quantity: number }).quantity;
        return json({ cartId: "40", cartItemId: "100", quantity: units });
      },
    });
    const user = userEvent.setup();
    renderPurchaseRoute(routes, "/catalog/editions/42");

    // Already in the cart: the same quiet line as a digital copy, and the row stays for more copies.
    expect(await screen.findByText("Ya está en tu carrito")).toBeInTheDocument();
    expect(screen.getByText("· 2 unidades")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Ver carrito" })).toHaveAttribute("href", "/cart");
    const count = await screen.findByRole("combobox", { name: "Cantidad de Cien años de soledad" });
    await user.click(count);
    expect(screen.getAllByRole("option").map(option => option.firstElementChild?.textContent)).toEqual(["1", "2", "3", "4", "5", "6", "7", "8", "9", "10"]);
    await user.click(screen.getByRole("option", { name: "3" }));
    await user.click(screen.getByRole("button", { name: "Agregar al carrito" }));

    expect(await screen.findByText("· 5 unidades")).toBeInTheDocument();
    expect(api.calls.find(call => call.method === "POST")?.body).toEqual({ editionId: "42", quantity: 3 });
    await waitFor(() => expect(count).toHaveAttribute("data-quantity", "1"));
    expect(screen.getAllByRole("link", { name: "Ver carrito" })).toHaveLength(1);
  });

  it("offers no count for a digital edition: one copy per account", async () => {
    const api = stubApi({
      "GET /api/v1/catalog/editions/42": () => json({ ...edition, format: "EBOOK", isbn13: null, ebookFileFormat: "EPUB", audioDurationSeconds: null, narrators: [] }),
      "GET /api/v1/cart": () => json({ cartId: null, state: null, items: [], totalCurrent: "0.00" }),
      "POST /api/v1/cart/items": () => json({ cartId: "40", cartItemId: "100", quantity: 1 }),
    });
    const user = userEvent.setup();
    renderPurchaseRoute(routes, "/catalog/editions/42");

    expect(await screen.findByRole("button", { name: "Agregar al carrito" })).toBeInTheDocument();
    expect(screen.queryByRole("combobox", { name: /Cantidad de/ })).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Agregar al carrito" }));
    await waitFor(() => expect(api.calls.find(call => call.method === "POST")?.body).toEqual({ editionId: "42", quantity: 1 }));
  });

  it("answers a confirmed add with the cart drawer, not a chip", async () => {
    let units = 0;
    stubApi({
      "GET /api/v1/catalog/editions/42": () => json(edition),
      "GET /api/v1/cart": () => json(units ? cartBody([{ editionId: "42", title: edition.title, quantity: units }]) : cartBody([])),
      "POST /api/v1/cart/items": () => { units = 1; return json({ cartId: "40", cartItemId: "100", quantity: 1 }); },
    });
    const user = userEvent.setup();
    renderPurchaseRoute(withDrawer, "/catalog/editions/42");

    await user.click(await screen.findByRole("button", { name: "Agregar al carrito" }));

    expect(await screen.findByRole("dialog", { name: "Tu carrito" })).toBeInTheDocument();
  });

  it("shows an error without using the success button state", async () => {
    stubApi({
      "GET /api/v1/catalog/editions/42": () => json(edition),
      "GET /api/v1/cart": () => json({ cartId: null, state: null, items: [], totalCurrent: "0.00" }),
      "POST /api/v1/cart/items": () => problem(400, "INVALID_REQUEST", "Solicitud no válida", "Revisa los datos e inténtalo otra vez."),
    });
    const user = userEvent.setup();
    renderPurchaseRoute(routes, "/catalog/editions/42");

    await user.click(await screen.findByRole("button", { name: "Agregar al carrito" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Solicitud no válida.");
    expect(await screen.findByRole("button", { name: "Agregar al carrito" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Agregado" })).not.toBeInTheDocument();
  });
});
