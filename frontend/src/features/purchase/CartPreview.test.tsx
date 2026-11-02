import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import { cartBody, json, problem, renderPurchaseRoute, stubApi } from "@/test/purchase";
import { useCartControl } from "@/features/catalog/useBookCardActions";
import { CartPreviewProvider, useCartPreview } from "./CartPreview";

afterEach(() => vi.unstubAllGlobals());

function Probe({ editionId = "42" }: { editionId?: string }) {
  const preview = useCartPreview();
  const control = useCartControl({ editionId, available: true, format: "PAPERBACK", returnHref: "/catalog", onFeedback: () => {}, onAdded: preview?.open });
  return <button onClick={"onPress" in control ? control.onPress : undefined}>Agregar {editionId}</button>;
}

function show() {
  return renderPurchaseRoute([
    { path: "/catalog", element: <CartPreviewProvider><Probe /><Probe editionId="43" /></CartPreviewProvider> },
    { path: "/cart", element: <CartPreviewProvider><p>Página del carrito</p></CartPreviewProvider> },
  ], "/catalog");
}

it("opens the server cart from the right after a confirmed add, and closes with Escape returning focus", async () => {
  const cart = [json({ items: [] }), json(cartBody([{}, { quantity: 2, currentSubtotal: "37.00" }], "55.50"))];
  stubApi({ "GET /api/v1/cart": () => cart.length > 1 ? cart.shift()! : json(cartBody([{}, { quantity: 2, currentSubtotal: "37.00" }], "55.50")), "POST /api/v1/cart/items": () => json({ cartItemId: "100", quantity: 1 }) });
  show();
  const user = userEvent.setup();
  const trigger = await screen.findByRole("button", { name: "Agregar 42" });
  await user.click(trigger);

  const drawer = await screen.findByRole("dialog", { name: "Tu carrito" });
  expect(await within(drawer).findByText("Cien años de soledad", { selector: "strong" })).toBeInTheDocument();
  expect(within(drawer).getByRole("list", { name: "Libros en tu carrito" }).children).toHaveLength(2);
  // The total is the API's, never a client sum.
  expect(within(drawer).getByText(/55,50/)).toBeInTheDocument();
  expect(within(drawer).getByRole("link", { name: "Ver carrito" })).toHaveAttribute("href", "/cart");
  expect(within(drawer).getByRole("link", { name: "Continuar con la compra" })).toHaveAttribute("href", "/checkout");

  await user.keyboard("{Escape}");
  await waitFor(() => expect(screen.queryByRole("dialog", { name: "Tu carrito" })).not.toBeInTheDocument());
  await waitFor(() => expect(trigger).toHaveFocus());
});

it("does not open when the add fails", async () => {
  stubApi({ "GET /api/v1/cart": () => json({ items: [] }), "POST /api/v1/cart/items": () => problem(409, "P3002", "Sin existencias", "No hay existencias suficientes.") });
  show();
  await userEvent.setup().click(await screen.findByRole("button", { name: "Agregar 42" }));
  await new Promise((resolve) => setTimeout(resolve, 50));
  expect(screen.queryByRole("dialog", { name: "Tu carrito" })).not.toBeInTheDocument();
});

it("a later add reopens the same drawer on the new edition", async () => {
  stubApi({ "GET /api/v1/cart": () => json(cartBody([{}, {}])), "POST /api/v1/cart/items": () => json({ cartItemId: "101", quantity: 1 }) });
  show();
  const user = userEvent.setup();
  await user.click(await screen.findByRole("button", { name: "Agregar 42" }));
  await screen.findByRole("dialog", { name: "Tu carrito" });
  await user.click(screen.getByRole("button", { name: "Cerrar carrito" }));
  await waitFor(() => expect(screen.queryByRole("dialog", { name: "Tu carrito" })).not.toBeInTheDocument());
  await user.click(screen.getByRole("button", { name: "Agregar 43" }));
  const drawer = await screen.findByRole("dialog", { name: "Tu carrito" });
  expect(await within(drawer).findByText("Edición 1", { selector: "strong" })).toBeInTheDocument();
});

it("hides the checkout action while a line cannot be bought", async () => {
  stubApi({ "GET /api/v1/cart": () => json(cartBody([{ available: false, unavailabilityReason: "OUT_OF_STOCK" }])), "POST /api/v1/cart/items": () => json({ cartItemId: "100", quantity: 1 }) });
  show();
  await userEvent.setup().click(await screen.findByRole("button", { name: "Agregar 42" }));
  const drawer = await screen.findByRole("dialog", { name: "Tu carrito" });
  expect(await within(drawer).findByText(/Ajusta o quita los libros no disponibles/)).toBeInTheDocument();
  expect(within(drawer).queryByRole("link", { name: "Continuar con la compra" })).not.toBeInTheDocument();
});

it("shows the server's offer as the cart does: today's line subtotal with the previous one struck, and the saving once", async () => {
  const offerCart = { ...cartBody([{ currentSubtotal: "25.95", originalPrice: "32.00", unitSavings: "6.05", originalSubtotal: "32.00", lineSavings: "6.05" }], "25.95"),
    originalSubtotal: "32.00", savingsTotal: "6.05", currentSubtotal: "25.95", subtotal: "25.95", taxAmount: "0.00", shippingAmount: "0.00", total: "25.95" };
  stubApi({ "GET /api/v1/cart": () => json(offerCart), "POST /api/v1/cart/items": () => json({ cartItemId: "100", quantity: 1 }) });
  show();
  const user = userEvent.setup();
  await user.click(await screen.findByRole("button", { name: "Agregar 42" }));
  const drawer = await screen.findByRole("dialog", { name: "Tu carrito" });
  const line = within(within(drawer).getByRole("list", { name: "Libros en tu carrito" })).getByRole("article");
  expect(within(line).getByText(/32,00/, { selector: "s" })).toHaveTextContent("Precio anterior");
  expect(within(line).getByText(/25,95/)).toBeInTheDocument();
  const totals = within(drawer).getByText("Ahorro total hoy").closest("dl")!;
  expect(within(totals).getByText("Subtotal").nextSibling).toHaveTextContent(/32,00/);
  expect(within(totals).getByText("Ahorro total hoy").nextSibling).toHaveTextContent(/-\$\s6,05/);
  // The total is the server's, already discounted: the saving is shown, never subtracted again.
  expect(within(totals).getByText("Total").nextSibling).toHaveTextContent(/25,95/);
});

it("keeps the plain subtotal and no saving when the cart has no offer", async () => {
  stubApi({ "GET /api/v1/cart": () => json({ ...cartBody([{}], "18.50"), subtotal: "18.50", total: "18.50" }), "POST /api/v1/cart/items": () => json({ cartItemId: "100", quantity: 1 }) });
  show();
  const user = userEvent.setup();
  await user.click(await screen.findByRole("button", { name: "Agregar 42" }));
  const drawer = await screen.findByRole("dialog", { name: "Tu carrito" });
  await within(drawer).findByText("Subtotal");
  expect(within(drawer).queryByText("Ahorro total hoy")).not.toBeInTheDocument();
  expect(drawer.querySelector("s")).toBeNull();
});

it("states the digital rule in place of a fixed count, and keeps the picker for physical books", async () => {
  stubApi({
    "GET /api/v1/cart": () => json(cartBody([{}, { format: "AUDIOBOOK", currentSubtotal: "26.99" }])),
    "POST /api/v1/cart/items": () => json({ cartItemId: "100", quantity: 1 }),
  });
  show();
  const user = userEvent.setup();
  await user.click(await screen.findByRole("button", { name: "Agregar 42" }));
  const drawer = await screen.findByRole("dialog", { name: "Tu carrito" });
  const [physical, digital] = within(within(drawer).getByRole("list", { name: "Libros en tu carrito" })).getAllByRole("article");
  expect(within(physical).getByRole("combobox", { name: "Cantidad de Cien años de soledad" })).toBeInTheDocument();
  expect(within(digital).getByText("Copia digital individual")).toBeInTheDocument();
  expect(within(digital).queryByText("Cantidad: 1")).not.toBeInTheDocument();
  expect(within(digital).queryByRole("combobox")).not.toBeInTheDocument();
});

it.each(["P6002", "P6003"])("links a blocked digital %s line to its acquisition without checkout", async code => {
  stubApi({ "GET /api/v1/cart": () => json(cartBody([{ format: "EBOOK", available: false, unavailabilityReason: code }])), "POST /api/v1/cart/items": () => json({ cartItemId: "100", quantity: 1 }),
    "GET /api/v1/me/digital-eligibility": () => json([{ editionId: "42", owned: code === "P6002", ownedItemId: "800", pendingOrder: code === "P6003", pendingOrderId: "900", inCart: true, purchasable: false }]) });
  show();
  await userEvent.setup().click(await screen.findByRole("button", { name: "Agregar 42" }));
  const drawer = await screen.findByRole("dialog", { name: "Tu carrito" });
  expect(await within(drawer).findByRole("link", { name: code === "P6002" ? "Ver en Mi biblioteca" : "Ver pedido" })).toHaveAttribute("href", code === "P6002" ? "/biblioteca/800" : "/orders/900");
  expect(within(drawer).getByText("Copia digital individual")).toBeInTheDocument();
  expect(within(drawer).queryByRole("link", { name: "Continuar con la compra" })).not.toBeInTheDocument();
});

/** A server cart the DELETE route really changes, so every read after it reflects the removal. */
function removableCart(lines = [{}, { quantity: 2, currentSubtotal: "37.00" }], deleteStatus = 204, restore?: (request: Request) => Response | undefined) {
  let items = cartBody(lines).items;
  const removed: typeof items = [];
  const body = () => json(cartBody(items.map(({ cartItemId, ...rest }) => ({ ...rest, cartItemId })),
    items.reduce((sum, line) => sum + Number(line.currentSubtotal), 0).toFixed(2)));
  return stubApi({
    "GET /api/v1/cart": body,
    "POST /api/v1/cart/items": async (request) => {
      const refused = restore?.(request.clone());
      if (refused) return refused;
      // Deshacer: the removed line comes back with its quantity, as the cart API would add it.
      const { editionId, quantity } = await request.json() as { editionId: string; quantity: number };
      const back = removed.find((line) => line.editionId === editionId);
      if (back) { items = [...items, { ...back, quantity }]; return json({ cartItemId: back.cartItemId, quantity }); }
      return json({ cartItemId: "100", quantity: 1 });
    },
    "DELETE /api/v1/cart/items/*": (request) => {
      if (deleteStatus >= 400) return problem(deleteStatus, "INTERNAL_ERROR", "Error", "Fallo temporal.");
      const id = new URL(request.url).pathname.split("/").pop();
      removed.push(...items.filter((line) => line.cartItemId === id));
      items = items.filter((line) => line.cartItemId !== id);
      return new Response(null, { status: deleteStatus });
    },
  });
}

async function openDrawer() {
  show();
  const user = userEvent.setup();
  await user.click(await screen.findByRole("button", { name: "Agregar 42" }));
  const drawer = await screen.findByRole("dialog", { name: "Tu carrito" });
  await within(drawer).findByRole("list", { name: "Libros en tu carrito" });
  return { user, drawer };
}

it("removes only the confirmed line and shows the server's new count and totals at once", async () => {
  const api = removableCart();
  const { user, drawer } = await openDrawer();
  expect(within(drawer).getByText(/55,50/)).toBeInTheDocument();

  await user.click(within(drawer).getByRole("button", { name: "Quitar Edición 1 del carrito" }));
  const question = await screen.findByRole("dialog", { name: "¿Quitar del carrito?" });
  expect(within(question).getByText("Edición 1", { selector: "strong" })).toBeInTheDocument();
  expect(within(question).getByRole("button", { name: "Conservar" })).toHaveFocus();
  await user.click(within(question).getByRole("button", { name: "Quitar" }));

  await waitFor(() => expect(screen.queryByRole("dialog", { name: "¿Quitar del carrito?" })).not.toBeInTheDocument());
  expect(api.calls.filter((call) => call.method === "DELETE").map((call) => call.path)).toEqual(["/api/v1/cart/items/101"]);
  const list = within(drawer).getByRole("list", { name: "Libros en tu carrito" });
  await waitFor(() => expect(list.children).toHaveLength(1));
  expect(within(list).getByText("Cien años de soledad")).toBeInTheDocument();
  expect(within(drawer).queryByText(/55,50/)).not.toBeInTheDocument();
  expect(within(drawer).getAllByText(/18,50/).length).toBeGreaterThan(0);
  expect(within(drawer).getByRole("status", { name: "" })).toHaveTextContent("Quitaste Edición 1 del carrito");
  // The drawer stays; the keyboard lands on the remaining line's control.
  await waitFor(() => expect(within(drawer).getByRole("button", { name: "Quitar Cien años de soledad del carrito" })).toHaveFocus());
});

it("offers Deshacer only after a confirmed removal and puts the same edition and quantity back", async () => {
  const adds: Request[] = [];
  const api = removableCart([{ quantity: 2, currentSubtotal: "37.00" }, {}], 204, (request) => { adds.push(request); return undefined; });
  const { user, drawer } = await openDrawer();
  expect(within(drawer).queryByRole("button", { name: /Deshacer/ })).not.toBeInTheDocument();

  await user.click(within(drawer).getAllByRole("button", { name: /^Quitar .* del carrito$/ })[0]);
  await user.click(within(await screen.findByRole("dialog", { name: "¿Quitar del carrito?" })).getByRole("button", { name: "Quitar" }));
  const undo = await within(drawer).findByRole("button", { name: /^Deshacer: devolver .* al carrito$/ });
  expect(within(drawer).getByRole("list", { name: "Libros en tu carrito" }).children).toHaveLength(1);

  await user.click(undo);
  await waitFor(() => expect(within(drawer).getByRole("list", { name: "Libros en tu carrito" }).children).toHaveLength(2));
  const posts = api.calls.filter((call) => call.method === "POST" && call.path === "/api/v1/cart/items");
  expect(posts).toHaveLength(2); // the original add, then exactly one undo
  expect(await adds.at(-1)!.json()).toMatchObject({ quantity: 2 });
  expect(within(drawer).getByRole("status", { name: "" })).toHaveTextContent(/Devolviste .* al carrito$/);
  expect(within(drawer).queryByRole("button", { name: /Deshacer/ })).not.toBeInTheDocument();
});

it("explains a refused undo from the server and never retries the add on its own", async () => {
  let refuse = false;
  const api = removableCart(undefined, 204, () => refuse ? problem(409, "P2042", "Edición no disponible", "Esta edición ya no está a la venta.") : undefined);
  const { user, drawer } = await openDrawer();
  refuse = true;
  const before = api.calls.filter((call) => call.method === "POST").length;

  await user.click(within(drawer).getByRole("button", { name: "Quitar Edición 1 del carrito" }));
  await user.click(within(await screen.findByRole("dialog", { name: "¿Quitar del carrito?" })).getByRole("button", { name: "Quitar" }));
  await user.click(await within(drawer).findByRole("button", { name: "Deshacer: devolver Edición 1 al carrito" }));

  await waitFor(() => expect(within(drawer).getByRole("status", { name: "" })).toHaveTextContent(/Edición 1:/));
  expect(api.calls.filter((call) => call.method === "POST")).toHaveLength(before + 1);
  expect(within(drawer).getByRole("list", { name: "Libros en tu carrito" }).children).toHaveLength(1);
  expect(within(drawer).queryByRole("button", { name: /Deshacer/ })).not.toBeInTheDocument();
});

it("keeps every line when the question is cancelled or dismissed with Escape, without closing the drawer", async () => {
  const api = removableCart();
  const { user, drawer } = await openDrawer();
  const control = within(drawer).getByRole("button", { name: "Quitar Edición 1 del carrito" });

  await user.click(control);
  await user.click(within(await screen.findByRole("dialog", { name: "¿Quitar del carrito?" })).getByRole("button", { name: "Conservar" }));
  await waitFor(() => expect(screen.queryByRole("dialog", { name: "¿Quitar del carrito?" })).not.toBeInTheDocument());
  await waitFor(() => expect(control).toHaveFocus());

  await user.click(control);
  await screen.findByRole("dialog", { name: "¿Quitar del carrito?" });
  await user.keyboard("{Escape}");
  await waitFor(() => expect(screen.queryByRole("dialog", { name: "¿Quitar del carrito?" })).not.toBeInTheDocument());
  expect(screen.getByRole("dialog", { name: "Tu carrito" })).toBeInTheDocument();

  expect(api.calls.some((call) => call.method === "DELETE")).toBe(false);
  expect(within(drawer).getByRole("list", { name: "Libros en tu carrito" }).children).toHaveLength(2);
});

it("says the cart is empty after its last line goes and offers no checkout", async () => {
  removableCart([{}]);
  const { user, drawer } = await openDrawer();
  await user.click(within(drawer).getByRole("button", { name: "Quitar Cien años de soledad del carrito" }));
  await user.click(within(await screen.findByRole("dialog", { name: "¿Quitar del carrito?" })).getByRole("button", { name: "Quitar" }));
  expect(await within(drawer).findByText("Tu carrito está vacío.")).toBeInTheDocument();
  expect(within(drawer).queryByRole("list", { name: "Libros en tu carrito" })).not.toBeInTheDocument();
  expect(within(drawer).queryByRole("link", { name: "Continuar con la compra" })).not.toBeInTheDocument();
  expect(within(drawer).getByRole("link", { name: "Ver carrito" })).toBeInTheDocument();
});

it("keeps the line and says so when the removal fails", async () => {
  removableCart(undefined, 500);
  const { user, drawer } = await openDrawer();
  await user.click(within(drawer).getByRole("button", { name: "Quitar Edición 1 del carrito" }));
  await user.click(within(await screen.findByRole("dialog", { name: "¿Quitar del carrito?" })).getByRole("button", { name: "Quitar" }));
  expect(await within(drawer).findByRole("alert")).toHaveTextContent("No pudimos quitar este libro. Sigue en tu carrito");
  expect(within(drawer).getByRole("list", { name: "Libros en tu carrito" }).children).toHaveLength(2);
});
