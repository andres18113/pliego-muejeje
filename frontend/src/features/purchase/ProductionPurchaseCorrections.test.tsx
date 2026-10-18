import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cartBody, json, renderPurchaseRoute, savedAddress, stubApi } from "@/test/purchase";
import { CartPage } from "./CartPage";
import { CheckoutPage } from "./CheckoutPage";
import { cartQueryKey, useCustomerCart } from "./cartQuery";
import type { CartDetail } from "@/shared/api/cart";

const routes = [
  { path: "/cart", element: <CartPage /> },
  { path: "/checkout", element: <CheckoutPage /> },
  { path: "/orders/:orderId", element: <h1>Pedido enviado</h1> },
];

describe("production purchase corrections", () => {
  afterEach(() => vi.unstubAllGlobals());

  it.each(["focus", "visibilitychange"])("ACCT-01 refreshes the visible cart after another tab changes quantity (%s)", async event => {
    let current = cartBody([{ quantity: 1 }]);
    stubApi({ "GET /api/v1/cart": () => json(current) });
    renderPurchaseRoute(routes, "/cart");
    const region = within(await screen.findByRole("region", { name: "Libros en tu carrito" }));
    expect(region.getByRole("combobox")).toHaveTextContent("1");
    current = cartBody([{ quantity: 2, currentSubtotal: "37.00" }]);
    await act(async () => {
      if (event === "focus") window.dispatchEvent(new Event("focus"));
      else document.dispatchEvent(new Event("visibilitychange"));
    });
    await waitFor(() => expect(region.getByRole("combobox")).toHaveTextContent("2"));
    expect(screen.getByText("Total").nextSibling).toHaveTextContent("37,00");
  });

  it("ACCT-01 requires explicit review after checkout's background cart read changes the reviewed summary", async () => {
    let current = cartBody([{ quantity: 1 }]);
    const api = stubApi({
      "GET /api/v1/cart": () => json(current),
      "GET /api/v1/me/addresses": () => json([savedAddress]),
      "POST /api/v1/checkout": () => json({ orderId: "700", orderState: "CONFIRMED", paymentState: "APPROVED", total: "37.00", paymentReference: "SIM-1" }, 201),
    });
    function CartReader() { useCustomerCart(true); return <p>Carrito leído</p>; }
    const user = userEvent.setup();
    const view = renderPurchaseRoute([{ path: "/cart", element: <CartReader /> }, ...routes.slice(1)], "/cart");
    await waitFor(() => expect(view.queryClient.getQueryData<CartDetail>(cartQueryKey)?.items[0].quantity).toBe(1));
    current = cartBody([{ quantity: 2, currentSubtotal: "37.00" }]);
    await act(async () => { await view.router.navigate("/checkout"); });
    await screen.findByText(/Av\. Principal 123/);
    await user.click(screen.getByRole("button", { name: /Transferencia/ }));
    const notice = await screen.findByRole("alert", { name: "Tu carrito cambió" });
    expect(notice).toHaveTextContent("18,50");
    expect(notice).toHaveTextContent("37,00");
    const submit = screen.getByRole("button", { name: "Hacer pedido" });
    expect(submit).toHaveAttribute("aria-disabled", "true");
    fireEvent.click(submit); fireEvent.click(submit);
    expect(api.count("POST", "/api/v1/checkout")).toBe(0);
    await user.click(within(notice).getByRole("button", { name: "Revisé el resumen actualizado" }));
    expect(submit).not.toHaveAttribute("aria-disabled", "true");
  });

  it("ACCT-01 invalidates review again when a later visible-tab read changes the amount", async () => {
    let current = cartBody([{ quantity: 1 }]);
    stubApi({ "GET /api/v1/cart": () => json(current), "GET /api/v1/me/addresses": () => json([savedAddress]) });
    const user = userEvent.setup(); renderPurchaseRoute(routes, "/checkout");
    await screen.findByText(/Av\. Principal 123/);
    current = cartBody([{ quantity: 2, currentSubtotal: "37.00" }]);
    await act(async () => { window.dispatchEvent(new Event("focus")); });
    const notice = await screen.findByRole("alert", { name: "Tu carrito cambió" });
    await user.click(within(notice).getByRole("button", { name: "Revisé el resumen actualizado" }));
    await waitFor(() => expect(screen.queryByRole("alert", { name: "Tu carrito cambió" })).not.toBeInTheDocument());
    current = cartBody([{ quantity: 3, currentSubtotal: "55.50" }]);
    await act(async () => { window.dispatchEvent(new Event("focus")); });
    expect(await screen.findByRole("alert", { name: "Tu carrito cambió" })).toHaveTextContent("55,50");
  });

  it("ACCT-02 distinguishes server unit price, quantity ten, and server line subtotal", async () => {
    stubApi({ "GET /api/v1/cart": () => json(cartBody([{ quantity: 10, currentPrice: "81.95", currentSubtotal: "819.50" }])) });
    renderPurchaseRoute(routes, "/cart");
    const line = within(await screen.findByRole("region", { name: "Libros en tu carrito" })).getByRole("listitem");
    expect(within(line).getByText(/\$\s*81,95 c\/u/)).toBeVisible();
    expect(within(line).getByRole("combobox")).toHaveTextContent("10");
    expect(within(line).getByText("Subtotal")).toBeVisible();
    expect(within(line).getByText(/\$\s*819,50/)).toBeVisible();
  });

  it("ACCT-03 restores focus to the selected address control after successful first-address creation", async () => {
    let addresses: typeof savedAddress[] = [];
    stubApi({
      "GET /api/v1/cart": () => json(cartBody()),
      "GET /api/v1/me/addresses": () => json(addresses),
      "POST /api/v1/me/addresses": () => { addresses = [savedAddress]; return json({ addressId: "15" }, 201); },
    });
    const user = userEvent.setup(); renderPurchaseRoute(routes, "/checkout");
    await user.click(await screen.findByRole("button", { name: "Añadir dirección" }));
    const dialog = await screen.findByRole("dialog", { name: "Nueva dirección" });
    const form = within(dialog);
    await user.type(form.getByLabelText("Nombre de la dirección"), "Casa");
    await user.type(form.getByLabelText("Dirección", { exact: true }), "Av. Principal 123");
    await user.type(form.getByLabelText("Ciudad"), "Quito");
    await user.type(form.getByLabelText("Provincia"), "Pichincha");
    await user.type(form.getByLabelText("Teléfono de contacto"), "25550134");
    await user.click(form.getByRole("button", { name: "Guardar dirección" }));
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Nueva dirección" })).not.toBeInTheDocument());
    expect(screen.getByRole("status")).toHaveTextContent("Guardamos la dirección y la elegimos para este pedido.");
    await waitFor(() => expect(screen.getByRole("button", { name: "Cambiar dirección" })).toHaveFocus());
    expect(screen.getByText(/Av\. Principal 123/)).toBeInTheDocument();
  });
});
