import { act, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import { cartBody, json, problem, renderPurchaseRoute, stubApi } from "@/test/purchase";
import { CartPreviewProvider } from "@/features/purchase/CartPreview";
import { FavoritesPage } from "./FavoritesPage";
/** As in the app: the storefront layout mounts the one cart drawer around every page. */
const favorites = <CartPreviewProvider><FavoritesPage /></CartPreviewProvider>;
const drawer = () => screen.findByRole("dialog", { name: "Tu carrito" });
const noDrawer = () => expect(screen.queryByRole("dialog", { name: "Tu carrito" })).not.toBeInTheDocument();
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
 renderPurchaseRoute([{ path: "/probe", element: favorites }, { path: "/cart", element: <h1>Carrito de destino</h1> }], "/probe");
 return { post, api };
}
it.each(["favorites"] as const)("%s answers a confirmed add with the Tu carrito drawer, supports repeated physical addition and preserves the favorite", async surface => {
 const { post, api } = setup(surface); const user = userEvent.setup();
 const add = await screen.findByRole("button", { name: "Agregar al carrito: Cien años de soledad" }); await user.click(add);
 const cart = await drawer();
 expect(await within(cart).findByRole("status", { name: "" })).toHaveTextContent("Agregaste Cien años de soledad");
 expect(screen.queryByText("¡Agregado al carrito!")).not.toBeInTheDocument();
 expect(screen.getByText("En el carrito: 3 unidades")).toBeInTheDocument();
 // A physical book can still take more, so "Agregar" stays and the quantity line carries the way to the cart.
 expect(screen.getByRole("link", { name: "Ver carrito: Cien años de soledad" })).toHaveAttribute("href", "/cart");
 expect(screen.getByRole("button", { name: "Quitar de favoritos: Cien años de soledad" })).toHaveAttribute("aria-pressed", "true");
 await user.click(within(cart).getByRole("button", { name: "Cerrar carrito" }));
 await waitFor(noDrawer);
 await user.click(add); expect(await screen.findByText("En el carrito: 4 unidades")).toBeInTheDocument();
 await drawer(); expect(screen.getAllByRole("dialog", { name: "Tu carrito" })).toHaveLength(1); expect(post).toHaveBeenCalledTimes(2);
 expect(api.count("DELETE", "/api/v1/me/favorites")).toBe(0);
 await user.click(within(await drawer()).getByRole("link", { name: "Ver carrito" })); expect(await screen.findByRole("heading", { name: "Carrito de destino" })).toBeInTheDocument();
});
it.each(["EBOOK", "AUDIOBOOK"])("%s already in cart remains at one without a false success", async format => {
 const { post } = setup("favorites", format, 1); expect(await screen.findByText("Ya está en el carrito")).toBeInTheDocument();
 expect(screen.queryByText("En el carrito: 1 unidad")).not.toBeInTheDocument();
 // The state stays, and the row keeps a way back to the cart instead of a dead button.
 const shortcut = screen.getByRole("button", { name: "Ver carrito: Cien años de soledad" });
 expect(shortcut).toBeEnabled(); expect(shortcut).toHaveAccessibleDescription("Ya está en el carrito");
 expect(screen.queryByRole("button", { name: /Agregar al carrito/ })).not.toBeInTheDocument();
 expect(post).not.toHaveBeenCalled(); noDrawer();
 await userEvent.setup().click(shortcut); expect(await screen.findByRole("heading", { name: "Carrito de destino" })).toBeInTheDocument();
 expect(post).not.toHaveBeenCalled();
});
it("locks pending requests and shows retryable error without success", async () => {
 let finish!: (value: Response) => void; const response = new Promise<Response>(resolve => { finish = resolve; });
 const { post } = setup("favorites", "PAPERBACK", 0, () => response); const user = userEvent.setup();
 const add = await screen.findByRole("button", { name: "Agregar al carrito: Cien años de soledad" }); await user.dblClick(add);
 expect(await screen.findByRole("button", { name: "Agregando…: Cien años de soledad" })).toHaveAttribute("aria-disabled", "true"); expect(post).toHaveBeenCalledTimes(1); noDrawer();
 await act(async () => finish(problem(409, "P2050", "No pudimos agregar la edición", "No queda stock suficiente para esa cantidad.")));
 expect(await screen.findByRole("alert")).toHaveTextContent(/stock|existencias/i); noDrawer();
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
 renderPurchaseRoute([{ path: "/favorites", element: favorites }], "/favorites");
 await userEvent.setup().click(await screen.findByRole("button", { name: "Agregar al carrito: Cien años de soledad" }));
 expect(await screen.findByText("En el carrito: 3 unidades")).toBeInTheDocument();
 // The add is confirmed, so the drawer opens; it never turns the add into a failure.
 await drawer();
 expect(screen.queryByText("No pudimos confirmar esta acción")).not.toBeInTheDocument();
});
it("a failed command cannot claim success even when a later read finds the requested quantity", async () => {
 let reads = 0;
 stubApi({
  "GET /api/v1/me/favorites": () => json({ items: [edition], page: 0, pageSize: 20, totalCount: "1" }),
  "GET /api/v1/cart": () => json(cartBody([{ quantity: ++reads <= 2 ? 2 : 3 }])),
  "POST /api/v1/cart/items": () => problem(503, "Unavailable", "No pudimos agregar la edición", "Consulta el carrito."),
 });
 renderPurchaseRoute([{ path: "/favorites", element: favorites }], "/favorites");
 await userEvent.setup().click(await screen.findByRole("button", { name: "Agregar al carrito: Cien años de soledad" }));
 expect(await screen.findByText("En el carrito: 3 unidades")).toBeInTheDocument();
 expect(screen.getByRole("alert")).toHaveTextContent("No pudimos confirmar esta acción");
 noDrawer();
});
it.each(["EBOOK", "AUDIOBOOK"])("a new %s confirms one copy then disables another addition", async format => {
 const { post } = setup("favorites", format, 0);
 await userEvent.setup().click(await screen.findByRole("button", { name: "Agregar al carrito: Cien años de soledad" }));
 expect(await screen.findByText("Ya está en el carrito")).toBeInTheDocument();
 expect(within(await drawer()).getByRole("list", { name: "Libros en tu carrito" })).toBeInTheDocument();
 expect(screen.getByRole("button", { name: "Ver carrito: Cien años de soledad" })).toBeEnabled();
 expect(screen.queryByRole("button", { name: /Agregar al carrito/ })).not.toBeInTheDocument();
 expect(post).toHaveBeenCalledTimes(1);
});

it.each(["EBOOK", "AUDIOBOOK"])("first %s addition opens the drawer and, once it closes, keyboard focus is back on the saved row", async format => {
 setup("favorites", format, 0); const user = userEvent.setup();
 const add = await screen.findByRole("button", { name: "Agregar al carrito: Cien años de soledad" });
 add.focus(); await user.keyboard("{Enter}");
 expect(await screen.findByText("Ya está en el carrito")).toBeInTheDocument();
 await drawer(); await user.keyboard("{Escape}"); await waitFor(noDrawer);
 // The add action became the row's "Ver carrito" in place, so closing the drawer returns focus to that shortcut.
 const shortcut = screen.getByRole("button", { name: "Ver carrito: Cien años de soledad" });
 await waitFor(() => expect(shortcut).toHaveFocus());
 await user.keyboard("{Enter}"); expect(await screen.findByRole("heading", { name: "Carrito de destino" })).toBeInTheDocument();
});

it("a physical addition closes back onto its own add button", async () => {
 setup("favorites"); const user = userEvent.setup();
 const add = await screen.findByRole("button", { name: "Agregar al carrito: Cien años de soledad" });
 add.focus(); await user.keyboard("{Enter}");
 await drawer(); await user.keyboard("{Escape}"); await waitFor(noDrawer);
 await waitFor(() => expect(screen.getByRole("button", { name: "Agregar al carrito: Cien años de soledad" })).toHaveFocus());
});

