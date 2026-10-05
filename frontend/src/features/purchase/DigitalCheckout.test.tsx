import { act, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cartBody, json, renderPurchaseRoute, savedAddress, stubApi } from "@/test/purchase";
import { CheckoutPage } from "./CheckoutPage";

const routes = [{ path: "/checkout", element: <CheckoutPage /> }, { path: "/orders/:orderId", element: <h1>Pedido abierto</h1> }];
const approved = { orderId: "700", orderState: "CONFIRMED", paymentState: "APPROVED", total: "18.50", paymentReference: "SIM-1" };
function cart(formats: string[]) {
  const body = cartBody(formats.map(() => ({})));
  return { ...body, items: body.items.map((item, index) => ({ ...item, format: formats[index] })) };
}
function api(formats: string[]) {
  return stubApi({ "GET /api/v1/cart": () => json(cart(formats)), "GET /api/v1/me/addresses": () => json([savedAddress]),
    "POST /api/v1/checkout": () => json(approved, 201) });
}

describe("digital checkout", () => {
  afterEach(() => vi.unstubAllGlobals());
  it.each([["EBOOK"], ["AUDIOBOOK"], ["EBOOK", "AUDIOBOOK"]])("keeps the supported address checkout and excludes physical pickup for %j", async (...formats) => {
    const transport = api(formats as string[]);
    const user = userEvent.setup(); renderPurchaseRoute(routes, "/checkout");
    await screen.findByText(/Av\. Principal 123/);
    expect(screen.getByRole("tab", { name: "Retiro" })).toBeDisabled();
    formats.forEach(format => expect(screen.getByRole("complementary")).toHaveTextContent(format === "EBOOK" ? "Ebook" : "Audiolibro"));
    expect(screen.getByText(/Esta compra digital simulada requiere una dirección/)).toBeInTheDocument();
    const delivery = screen.getByRole("tab", { name: "Entrega" });
    delivery.focus(); await user.keyboard("{ArrowRight}");
    expect(delivery).toHaveFocus();
    expect(transport.count("GET", "/api/v1/pickup-locations")).toBe(0);
    await user.click(screen.getByRole("button", { name: "Transferencia bancaria" }));
    await screen.findByText("Banco Guayaquil");
    await user.click(screen.getByRole("button", { name: "Hacer pedido" }));
    await screen.findByRole("heading", { name: "Pedido abierto" });
    expect(transport.calls.find(call => call.path === "/api/v1/checkout")?.body).toEqual({ addressId: "15", fulfillmentMethod: "HOME_DELIVERY", expectedCartId: "40", paymentMethod: "TRANSFER", simulationOutcome: "APPROVED" });
  });


  it("returns to the supported address flow if an updated cart becomes digital-only after pickup selection", async () => {
    let current = cart(["PAPERBACK", "EBOOK"]);
    stubApi({ "GET /api/v1/cart": () => json(current), "GET /api/v1/me/addresses": () => json([savedAddress]), "GET /api/v1/pickup-locations": () => json([]) });
    const user = userEvent.setup(); const { queryClient } = renderPurchaseRoute(routes, "/checkout");
    await screen.findByText(/Av\. Principal 123/);
    await user.click(screen.getByRole("tab", { name: "Retiro" }));
    expect(screen.getByRole("tab", { name: "Retiro" })).toHaveAttribute("aria-selected", "true");
    current = cart(["EBOOK"]);
    await act(async () => { await queryClient.invalidateQueries({ queryKey: ["customer-cart"] }); });
    await waitFor(() => expect(screen.getByRole("tab", { name: "Entrega" })).toHaveAttribute("aria-selected", "true"));
    expect(screen.getByRole("tab", { name: "Retiro" })).toBeDisabled();
    expect(await screen.findByText(/Av\. Principal 123/)).toBeInTheDocument();
  });

  it.each([["PAPERBACK"], ["HARDCOVER"], ["PAPERBACK", "EBOOK"], ["AUDIOBOOK", "HARDCOVER"]])("keeps pickup available when the cart includes physical %j", async (...formats) => {
    api(formats as string[]); renderPurchaseRoute(routes, "/checkout");
    await screen.findByText(/Av\. Principal 123/);
    expect(screen.getByRole("tab", { name: "Retiro" })).toBeEnabled();
    expect(screen.queryByText(/Esta compra digital simulada requiere una dirección/)).not.toBeInTheDocument();
  });
});
