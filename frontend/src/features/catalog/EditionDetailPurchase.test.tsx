import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { json, problem, renderPurchaseRoute, stubApi } from "@/test/purchase";
import { EditionDetailPage } from "./EditionDetailPage";

const edition = {
  editionId: "42", bookId: "17", title: "Cien años de soledad",
  authors: [{ authorId: "9", name: "Gabriel García Márquez", order: 1 }],
  categories: [], publisher: { publisherId: "5", name: "Editorial Sur" },
  isbn13: "9780306406157", sku: "PLG-LIT-042", language: "es", format: "PAPERBACK", price: "18.50",
  coverUrl: null, coverLicense: null, coverSourceUrl: null, coverAttribution: null, available: true,
};

const routes = [{ path: "/catalog/editions/:editionId", element: <EditionDetailPage /> }];

describe("EditionDetailPage purchase", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("keeps edition availability separate from a quantity conflict in the cart", async () => {
    stubApi({
      "GET /api/v1/catalog/editions/42": () => json(edition),
      "GET /api/v1/cart": () => json({ cartId: null, state: null, items: [], totalCurrent: "0.00" }),
      "POST /api/v1/cart/items": () => problem(409, "P3002", "Existencias insuficientes", "No hay existencias suficientes para la cantidad solicitada."),
    });
    const user = userEvent.setup();
    renderPurchaseRoute(routes, "/catalog/editions/42");

    await user.click(await screen.findByRole("button", { name: "Agregar al carrito" }));

    expect(await screen.findByText("No hay existencias suficientes para esta cantidad en tu carrito."))
      .toBeInTheDocument();
    expect(screen.getByText("Disponible")).toBeVisible();
    expect(screen.queryByRole("button", { name: "Agregar al carrito" })).not.toBeInTheDocument();
  });

  it("links to the cart after a confirmed add", async () => {
    stubApi({
      "GET /api/v1/catalog/editions/42": () => json(edition),
      "GET /api/v1/cart": () => json({ cartId: null, state: null, items: [], totalCurrent: "0.00" }),
      "POST /api/v1/cart/items": () => json({ cartId: "40", cartItemId: "100", quantity: 1 }),
    });
    const user = userEvent.setup();
    renderPurchaseRoute(routes, "/catalog/editions/42");

    await user.click(await screen.findByRole("button", { name: "Agregar al carrito" }));

    expect(await screen.findByRole("link", { name: "Ver el carrito" })).toHaveAttribute("href", "/cart");
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
