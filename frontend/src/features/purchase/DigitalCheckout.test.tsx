import { fillBillingFixture, billingFromSavedAddress } from "./billingTestFixtures";
import { act, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cartBody, json, renderPurchaseRoute, savedAddress, stubApi, problem } from "@/test/purchase";
import { CheckoutPage } from "./CheckoutPage";

afterEach(() => vi.unstubAllGlobals());

const routes = [{ path: "/checkout", element: <CheckoutPage /> }, { path: "/orders/:orderId", element: <h1>Pedido abierto</h1> }];
const approved = { orderId: "700", orderState: "CONFIRMED", paymentState: "APPROVED", total: "18.50", paymentReference: "SIM-1" };
function cart(formats: string[]) {
  return cartBody(formats.map(format => ({ format })));
}
function api(formats: string[]) {
  return stubApi({ "GET /api/v1/cart": () => json(cart(formats)), "GET /api/v1/me/addresses": () => json([savedAddress]),
    "POST /api/v1/checkout": () => json(approved, 201) });
}

describe("digital checkout", () => {
  afterEach(() => vi.unstubAllGlobals());
  it("uses server line capabilities for mixed delivery lists despite display formats", async () => {
    const current = cartBody([
      { title: "Físico autorizado", format: "EBOOK", requiresPhysicalFulfillment: true, quantityEditable: true },
      { title: "Digital autorizado", format: "PAPERBACK", requiresPhysicalFulfillment: false, quantityEditable: false },
    ]);
    stubApi({ "GET /api/v1/cart": () => json(current), "GET /api/v1/me/addresses": () => json([savedAddress]) });
    renderPurchaseRoute(routes, "/checkout");
    await screen.findByText("Av. Principal 123");
    const delivery = screen.getByRole("list", { name: "Libros de esta entrega" });
    expect(delivery).toHaveTextContent("Físico autorizado");
    expect(delivery).not.toHaveTextContent("Digital autorizado");
    // The summary follows the same server capability: units × price for the physical line, the rule for the digital one.
    const summary = screen.getByRole("complementary");
    expect(within(summary).getAllByText(/Copia digital individual/)).toHaveLength(1);
    expect(within(summary).getAllByText(/1 unidad ×/)).toHaveLength(1);
  });
  it.each([["EBOOK"], ["AUDIOBOOK"], ["EBOOK", "AUDIOBOOK"]])("checks out digital titles without any physical destination for %j", async (...formats) => {
    const transport = api(formats as string[]);
    const user = userEvent.setup(); renderPurchaseRoute(routes, "/checkout");
    await screen.findByRole("heading", { name: "Pago" });
    expect(screen.queryByRole("tab", { name: "Retiro" })).not.toBeInTheDocument();
    formats.forEach(format => expect(screen.getByRole("complementary")).toHaveTextContent(format === "EBOOK" ? "Ebook" : "Audiolibro"));
    // Each digital copy states its rule in the summary, never "1 unidad ×" a price.
    expect(within(screen.getByRole("complementary")).getAllByText(/Copia digital individual/)).toHaveLength(formats.length);
    expect(screen.getByRole("complementary")).not.toHaveTextContent("1 unidad ×");
    expect(screen.queryByText("Av. Principal 123")).not.toBeInTheDocument();
    // No delivery: saved addresses are read only to be offered as the invoice address.
    await waitFor(() => expect(transport.count("GET", "/api/v1/me/addresses")).toBe(1));
    expect(transport.count("GET", "/api/v1/pickup-locations")).toBe(0);
    await user.click(screen.getByRole("button", { name: "Transferencia bancaria" }));
    await screen.findByText("Banco Guayaquil");
    fillBillingFixture(); await user.click(screen.getByRole("button", { name: "Hacer pedido" }));
    await screen.findByRole("heading", { name: "Pedido abierto" });
    expect(transport.calls.find(call => call.path === "/api/v1/checkout")?.body).toEqual({ ...billingFromSavedAddress, fulfillmentMethod: "DIGITAL_ONLY", expectedCartId: "40", paymentMethod: "TRANSFER", simulationOutcome: "APPROVED" });
  });


  it("removes physical destination when the updated cart becomes digital-only", async () => {
    let current = cart(["PAPERBACK", "EBOOK"]);
    stubApi({ "GET /api/v1/cart": () => json(current), "GET /api/v1/me/addresses": () => json([savedAddress]), "GET /api/v1/pickup-locations": () => json([]) });
    const user = userEvent.setup(); const { queryClient } = renderPurchaseRoute(routes, "/checkout");
    await screen.findByText("Av. Principal 123");
    await user.click(screen.getByRole("tab", { name: "Retiro" }));
    expect(screen.getByRole("tab", { name: "Retiro" })).toHaveAttribute("aria-selected", "true");
    current = cart(["EBOOK"]);
    await act(async () => { await queryClient.invalidateQueries({ queryKey: ["customer-cart"] }); });
    await waitFor(() => expect(screen.queryByRole("tab", { name: "Entrega" })).not.toBeInTheDocument());
    expect(screen.queryByText("Av. Principal 123")).not.toBeInTheDocument();
  });

  it.each([["PAPERBACK"], ["HARDCOVER"], ["PAPERBACK", "EBOOK"], ["AUDIOBOOK", "HARDCOVER"]])("keeps pickup available when the cart includes physical %j", async (...formats) => {
    api(formats as string[]); renderPurchaseRoute(routes, "/checkout");
    await screen.findByText("Av. Principal 123");
    expect(screen.getByRole("tab", { name: "Retiro" })).toBeEnabled();
    expect(screen.queryByText(/Esta compra digital simulada requiere una dirección/)).not.toBeInTheDocument();
  });
});


it.each(["P6002", "P6003"])("explains acceptance %s with a recovery link and prevents resubmit even if the cart read is stale", async code => {
  const user = userEvent.setup();
  const transport = stubApi({ "GET /api/v1/cart": () => json(cart(["EBOOK"])), "GET /api/v1/me/addresses": () => json([savedAddress]),
    "GET /api/v1/me/digital-eligibility": () => json([{ editionId: "42", owned: code === "P6002", ownedItemId: "800", pendingOrder: code === "P6003", pendingOrderId: "900", inCart: true, purchasable: false }]),
    "POST /api/v1/checkout": () => problem(409, code, "Conflicto digital", "Explicación del servidor") });
  renderPurchaseRoute(routes, "/checkout");
  await user.click(await screen.findByRole("button", { name: "Transferencia bancaria" }));
  await screen.findByText("Banco Guayaquil");
  fillBillingFixture();
  await user.click(screen.getByRole("button", { name: "Hacer pedido" }));
  await screen.findByText(code === "P6002" ? "Ya está en tu biblioteca" : "Tienes un pedido abierto con esta edición");
  const link = await screen.findByRole("link", { name: code === "P6002" ? "Ver en Mi biblioteca" : "Ver pedido" });
  await waitFor(() => expect(screen.getByRole("link", { name: link.textContent! })).toHaveAttribute("href", code === "P6002" ? "/biblioteca/800" : "/orders/900"));
  expect(screen.getByRole("link", { name: "Revisar el carrito" })).toHaveAttribute("href", "/cart");
  expect(screen.getByRole("button", { name: "Hacer pedido" })).toBeDisabled();
  await user.click(screen.getByRole("button", { name: "Hacer pedido" }));
  expect(transport.count("POST", "/api/v1/checkout")).toBe(1);
});
