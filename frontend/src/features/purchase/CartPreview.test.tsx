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
