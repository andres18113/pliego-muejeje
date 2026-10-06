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
