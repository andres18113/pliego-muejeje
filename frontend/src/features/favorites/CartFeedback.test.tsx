import { act, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import { cartBody, json, problem, renderPurchaseRoute, stubApi } from "@/test/purchase";
import { FavoritesPage } from "./FavoritesPage";
const edition = { editionId: "42", bookId: "9", title: "Cien años de soledad", authors: "Gabriel García Márquez", publisher: "Editorial", format: "PAPERBACK", language: "es", price: "18.50", available: true, coverUrl: null, coverLicense: null, coverAttribution: null, favoritedAt: "2026-10-10T12:00:00Z" };
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });
function setup(_surface: "favorites", format = "PAPERBACK", initialQuantity = 2, mutation?: () => Response | Promise<Response>) {
 let quantity = initialQuantity;
 const post = vi.fn(mutation ?? (() => { quantity++; return json({ cartItemId: "100", quantity }); }));
 const api = stubApi({
  "GET /api/v1/me/favorites": () => json({ items: [{ ...edition, format }], page: 0, pageSize: 20, totalCount: "1" }),
  "GET /api/v1/cart": () => json(cartBody(quantity ? [{ editionId: "42", quantity, format, currentSubtotal: (18.5 * quantity).toFixed(2) }] : [])),
  "POST /api/v1/cart/items": post,
 });
 renderPurchaseRoute([{ path: "/probe", element: <FavoritesPage /> }, { path: "/cart", element: <h1>Carrito de destino</h1> }], "/probe");
 return { post, api };
}
it.each(["favorites"] as const)("%s confirms quantity, supports repeated physical addition, preserves favorite and announces once", async surface => {
 const { post, api } = setup(surface); const user = userEvent.setup();
 const add = await screen.findByRole("button", { name: "Agregar al carrito: Cien años de soledad" }); await user.click(add);
 const notice = await screen.findByText("¡Agregado al carrito!"); expect(notice.closest('[role="status"]')).not.toBeNull();
 expect(screen.getByText("Añadiste 1 unidad. Ahora tienes 3 unidades de esta edición en tu carrito.")).toBeInTheDocument();
 expect(screen.getByText("En el carrito: 3 unidades")).toBeInTheDocument(); expect(screen.queryByText("Agregado", { exact: true })).not.toBeInTheDocument();
 expect(screen.getByRole("button", { name: "Quitar de favoritos: Cien años de soledad" })).toHaveAttribute("aria-pressed", "true");
 await user.click(add); expect(await screen.findByText("En el carrito: 4 unidades")).toBeInTheDocument();
 expect(screen.getAllByText("¡Agregado al carrito!")).toHaveLength(1); expect(post).toHaveBeenCalledTimes(2);
 expect(api.count("DELETE", "/api/v1/me/favorites")).toBe(0);
 await user.click(screen.getByRole("link", { name: "Ver carrito" })); expect(await screen.findByRole("heading", { name: "Carrito de destino" })).toBeInTheDocument();
});
it.each(["EBOOK", "AUDIOBOOK"])("%s already in cart remains at one without a false success", async format => {
 const { post } = setup("favorites", format, 1); expect(await screen.findByText("En el carrito: 1 unidad")).toBeInTheDocument();
 expect(screen.getByRole("button", { name: /Ya está en el carrito/ })).toBeDisabled(); expect(post).not.toHaveBeenCalled(); expect(screen.queryByText("¡Agregado al carrito!")).not.toBeInTheDocument();
});
it("locks pending requests and shows retryable error without success", async () => {
 let finish!: (value: Response) => void; const response = new Promise<Response>(resolve => { finish = resolve; });
 const { post } = setup("favorites", "PAPERBACK", 0, () => response); const user = userEvent.setup();
 const add = await screen.findByRole("button", { name: "Agregar al carrito: Cien años de soledad" }); await user.dblClick(add);
 expect(await screen.findByRole("button", { name: "Agregando…: Cien años de soledad" })).toHaveAttribute("aria-disabled", "true"); expect(post).toHaveBeenCalledTimes(1); expect(screen.queryByText("¡Agregado al carrito!")).not.toBeInTheDocument();
 await act(async () => finish(problem(409, "P2050", "No pudimos agregar la edición", "No queda stock suficiente para esa cantidad.")));
 expect(await screen.findByRole("alert")).toHaveTextContent(/stock|existencias/i); expect(screen.queryByText("¡Agregado al carrito!")).not.toBeInTheDocument();
 expect(screen.getByRole("button", { name: "Agregar al carrito: Cien años de soledad" })).toBeEnabled();
 await user.click(screen.getByRole("button", { name: "Agregar al carrito: Cien años de soledad" })); await waitFor(() => expect(post).toHaveBeenCalledTimes(2));
});
it("a confirmed command remains authoritative if the following cart read fails", async () => {
 let reads = 0;
 stubApi({
  "GET /api/v1/me/favorites": () => json({ items: [edition], page: 0, pageSize: 20, totalCount: "1" }),
  "GET /api/v1/cart": () => ++reads <= 2 ? json(cartBody([{ quantity: 2 }])) : problem(503, "Unavailable", "No pudimos consultar el carrito", "Inténtalo de nuevo."),
  "POST /api/v1/cart/items": () => json({ cartItemId: "100", quantity: 3 }),
 });
 renderPurchaseRoute([{ path: "/favorites", element: <FavoritesPage /> }], "/favorites");
 await userEvent.setup().click(await screen.findByRole("button", { name: "Agregar al carrito: Cien años de soledad" }));
 expect(await screen.findByText("En el carrito: 3 unidades")).toBeInTheDocument();
 expect(screen.getByText("Añadiste 1 unidad. Ahora tienes 3 unidades de esta edición en tu carrito.")).toBeInTheDocument();
});
it("a failed command cannot claim success even when a later read finds the requested quantity", async () => {
 let reads = 0;
 stubApi({
  "GET /api/v1/me/favorites": () => json({ items: [edition], page: 0, pageSize: 20, totalCount: "1" }),
  "GET /api/v1/cart": () => json(cartBody([{ quantity: ++reads <= 2 ? 2 : 3 }])),
  "POST /api/v1/cart/items": () => problem(503, "Unavailable", "No pudimos agregar la edición", "Consulta el carrito."),
 });
 renderPurchaseRoute([{ path: "/favorites", element: <FavoritesPage /> }], "/favorites");
 await userEvent.setup().click(await screen.findByRole("button", { name: "Agregar al carrito: Cien años de soledad" }));
 expect(await screen.findByText("En el carrito: 3 unidades")).toBeInTheDocument();
 expect(screen.getByRole("alert")).toHaveTextContent("No pudimos confirmar esta acción");
 expect(screen.queryByText("¡Agregado al carrito!")).not.toBeInTheDocument();
});
it.each(["EBOOK", "AUDIOBOOK"])("a new %s confirms one copy then disables another addition", async format => {
 const { post } = setup("favorites", format, 0);
 await userEvent.setup().click(await screen.findByRole("button", { name: "Agregar al carrito: Cien años de soledad" }));
 expect(await screen.findByText("En el carrito: 1 unidad")).toBeInTheDocument();
 expect(screen.getByText("Añadiste 1 unidad. Ahora tienes 1 unidad de esta edición en tu carrito.")).toBeInTheDocument();
 expect(screen.getByRole("button", { name: /Ya está en el carrito/ })).toBeDisabled();
 expect(post).toHaveBeenCalledTimes(1);
});

it.each(["EBOOK", "AUDIOBOOK"])("first %s addition returns keyboard focus to the saved row after its add button disables", async format => {
 setup("favorites", format, 0); const user = userEvent.setup();
 const add = await screen.findByRole("button", { name: "Agregar al carrito: Cien años de soledad" });
 add.focus(); await user.keyboard("{Enter}");
 expect(await screen.findByText("En el carrito: 1 unidad")).toBeInTheDocument();
 expect(screen.getByRole("button", { name: /Ya está en el carrito/ })).toBeDisabled();
 expect(screen.getByRole("button", { name: "Quitar de favoritos: Cien años de soledad" })).toHaveFocus();
});

