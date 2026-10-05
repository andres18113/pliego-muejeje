import { act, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import { cartBody, json, problem, renderPurchaseRoute, savedAddress, stubApi } from "@/test/purchase";
import { FavoritesPage } from "@/features/favorites/FavoritesPage";
import { CartPage } from "@/features/purchase/CartPage";
import { CheckoutPage } from "@/features/purchase/CheckoutPage";
import { EditionDetailPage } from "./EditionDetailPage";

const book = { editionId: "42", bookId: "17", title: "Libro de prueba", authors: "Autora", publisher: "Editorial", isbn13: null, price: "18.50", coverUrl: null, coverLicense: null, coverAttribution: null, format: "PAPERBACK", language: "es", available: true };
const detail = { ...book, authors: [{ authorId: "9", name: book.authors, order: 1 }], publisher: { publisherId: "5", name: book.publisher }, categories: [], sku: "STOCK-42", pageCount: 100, publicationDate: null, synopsis: null, subtitle: null, coverSourceUrl: null };
afterEach(() => vi.unstubAllGlobals());

it.each([null, "P3002"] as const)("natively disables increasing an unavailable cart line (reason %s)", async reason => {
  const api = stubApi({ "GET /api/v1/cart": () => json(cartBody([{ available: false, unavailabilityReason: reason, quantity: 2 }])) });
  renderPurchaseRoute([{ path: "/cart", element: <CartPage /> }], "/cart");
  await screen.findByText("No disponible");
  // The selector never offers more than the current quantity while the server reports the line unavailable.
  const quantity = screen.queryByRole("combobox", { name: /Cantidad de/ });
  if (quantity) {
    await userEvent.setup().click(quantity);
    expect(screen.getAllByRole("option").map((option) => option.firstElementChild?.textContent)).toEqual(["1", "2"]);
  }
  expect(api.count("PUT", "/api/v1/cart/items")).toBe(0);
});

it.each(["P2042", "P3002"] as const)("ignores a residual reason on an authoritative available cart read (%s)", async reason => {
  stubApi({ "GET /api/v1/cart": () => json(cartBody([{ available: true, unavailabilityReason: reason, quantity: 2 }])) });
  renderPurchaseRoute([{ path: "/cart", element: <CartPage /> }], "/cart");
  await userEvent.setup().click(await screen.findByRole("combobox", { name: /Cantidad de/ }));
  expect(screen.getAllByRole("option")).toHaveLength(10);
  expect(screen.queryByText("No disponible")).not.toBeInTheDocument();
});

it("restores Favorites cart availability after authoritative unavailable/available transitions", async () => {
  let available = true;
  stubApi({
    "GET /api/v1/me/favorites": () => json({ items: [{ ...book, available, favoritedAt: "2026-10-04T12:00:00Z" }], page: 0, pageSize: 20, totalCount: "1" }),
    "GET /api/v1/cart": () => json(cartBody([])),
    "POST /api/v1/cart/items": () => { available = false; return problem(409, "P2042", "Edición no disponible", "La edición está inactiva."); },
  });
  const { queryClient } = renderPurchaseRoute([{ path: "/favorites", element: <FavoritesPage /> }], "/favorites");
  await userEvent.setup().click(await screen.findByRole("button", { name: "Agregar al carrito: Libro de prueba" }));
  await waitFor(() => expect(screen.getByRole("button", { name: "No disponible: Libro de prueba" })).toBeDisabled());
  available = true;
  await act(async () => { await queryClient.invalidateQueries({ queryKey: ["customer-favorites"] }); });
  expect(await screen.findByText("Disponible")).toBeVisible();
  await waitFor(() => expect(screen.getByRole("button", { name: "Agregar al carrito: Libro de prueba" })).toBeEnabled());
});

it("restores PDP purchasing after an authoritative restock without losing feedback", async () => {
  let available = true;
  stubApi({ "GET /api/v1/catalog/editions/42": () => json({ ...detail, available }), "GET /api/v1/cart": () => json(cartBody([])), "POST /api/v1/cart/items": () => { available = false; return problem(409, "P2042", "Edición no disponible", "La edición está inactiva."); } });
  const { queryClient } = renderPurchaseRoute([{ path: "/catalog/editions/:editionId", element: <EditionDetailPage /> }], "/catalog/editions/42");
  await userEvent.setup().click(await screen.findByRole("button", { name: "Agregar al carrito" }));
  await screen.findByText("No disponible");
  available = true;
  await act(async () => { await queryClient.invalidateQueries({ queryKey: ["public-catalog"] }); });
  expect(await screen.findByText("Disponible")).toBeVisible();
  expect(screen.getByRole("button", { name: "Agregar al carrito" })).toBeEnabled();
});

it("natively disables checkout for a cart with an unavailable line", async () => {
  stubApi({ "GET /api/v1/cart": () => json(cartBody([{ available: false, unavailabilityReason: "P3002" }])), "GET /api/v1/me/addresses": () => json([savedAddress]) });
  renderPurchaseRoute([{ path: "/checkout", element: <CheckoutPage /> }], "/checkout");
  expect(await screen.findByRole("button", { name: "Hacer pedido" })).toBeDisabled();
});
