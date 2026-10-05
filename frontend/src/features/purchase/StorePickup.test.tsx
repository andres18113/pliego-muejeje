import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cartBody, json, problem, renderPurchaseRoute, savedAddress, stubApi } from "@/test/purchase";
import { pickupLocation, pickupOrder, pickupSnapshot } from "@/test/pickup";
import { getOrder, resolveCheckout, submitCheckout } from "@/shared/api/orders";
import { CheckoutPage } from "./CheckoutPage";
import { OrderPage } from "./OrderPage";

const routes = [{ path: "/checkout", element: <CheckoutPage /> }, { path: "/orders/:orderId", element: <OrderPage /> }];
const approved = { ...pickupOrder, paymentState: "APPROVED", paymentReference: "SIM-PICKUP" };
const quote = () => ({ ...cartBody(), subtotal: "18.50", taxRate: "15.00", taxAmount: "2.78", shippingAmount: "0.00", total: "21.28", totalCurrent: "21.28" });
function api(overrides: Parameters<typeof stubApi>[0] = {}) {
  return stubApi({
    "GET /api/v1/cart": () => json(quote()),
    "GET /api/v1/me/addresses": () => json([savedAddress]),
    "GET /api/v1/pickup-locations": () => json([pickupLocation]),
    "POST /api/v1/checkout": () => json(approved, 201),
    "GET /api/v1/orders/700": () => json(pickupOrder), ...overrides,
  });
}
async function selectPickup(user: ReturnType<typeof userEvent.setup>) {
  await user.click(await screen.findByRole("tab", { name: "Retiro" }));
  await user.click(await screen.findByRole("radio", { name: /Punto de prueba Quito/ }));
}
async function transfer(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole("button", { name: "Transferencia bancaria" }));
  await screen.findByText("Banco Guayaquil");
}

describe("STORE_PICKUP transport and checkout", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("switches tabs by keyboard, preserving the saved delivery address and selected pickup", async () => {
    api(); const user = userEvent.setup(); renderPurchaseRoute(routes, "/checkout");
    await screen.findByText(/Av\. Principal 123/);
    const delivery = screen.getByRole("tab", { name: "Entrega" });
    delivery.focus(); await user.keyboard("{ArrowRight}");
    expect(screen.getByRole("tab", { name: "Retiro" })).toHaveFocus();
    await user.click(await screen.findByRole("radio", { name: /Punto de prueba Quito/ }));
    expect(screen.queryByText(/Av\. Principal 123/)).not.toBeInTheDocument();
    expect(screen.queryByTitle("Mapa de Punto de prueba Quito")).not.toBeInTheDocument();
    expect(screen.getByText(/Preparación estimada: ~37 min/)).toBeInTheDocument();
    expect(within(screen.getByRole("complementary")).queryByText(/Retiro en tienda|Punto de prueba Quito|Recepción/)).not.toBeInTheDocument();
    await user.click(delivery); expect(await screen.findByText(/Av\. Principal 123/)).toBeInTheDocument();
    await user.click(screen.getByRole("tab", { name: "Retiro" }));
    expect(screen.getByRole("button", { name: "Cambiar punto" })).toBeInTheDocument();
    expect(screen.getByText("Punto de prueba Quito")).toBeInTheDocument();
    expect(screen.queryByTitle("Mapa de Punto de prueba Quito")).not.toBeInTheDocument();
  });

  it.each(["CARD", "TRANSFER"] as const)("checks out pickup with %s and no address, then shows the order snapshot", async (method) => {
    const transport = api({ "GET /api/v1/me/addresses": () => problem(503, "READ_FAILURE", "Sin conexión", "No disponible."),
      "GET /api/v1/pickup-locations": () => json([{ ...pickupLocation, latitude: -.35, longitude: -78.45 }]) });
    const user = userEvent.setup(); renderPurchaseRoute(routes, "/checkout"); await selectPickup(user);
    if (method === "TRANSFER") await transfer(user);
    else {
      await user.click(screen.getByRole("button", { name: "Tarjeta de crédito o débito" }));
      await user.type(await screen.findByLabelText("Número de tarjeta"), "4111111111111111");
      await user.type(screen.getByLabelText("Caducidad (MM/AA)"), "12/30");
      await user.type(screen.getByLabelText("Código de seguridad"), "123");
      await user.type(screen.getByLabelText("Nombre en la tarjeta"), "Ana Pérez");
      await user.click(screen.getByRole("button", { name: "Usar esta tarjeta" }));
    }
    await user.click(screen.getByRole("button", { name: "Hacer pedido" }));
    expect(await screen.findByText("P-ABC234")).toBeInTheDocument();
    const posts = transport.calls.filter(call => call.path === "/api/v1/checkout");
    expect(posts).toHaveLength(1);
    expect(posts[0].body).toEqual({ fulfillmentMethod: "STORE_PICKUP", pickupLocationId: "8", expectedCartId: "40", paymentMethod: method,
      simulationOutcome: "APPROVED", ...(method === "CARD" ? { cardNumber: "4111111111111111" } : {}) });
    expect(posts[0].headers.get("Idempotency-Key")).toMatch(/^[0-9a-f-]{36}$/);
    expect(screen.getByText(/Presenta la confirmación enviada a tu correo/)).toBeInTheDocument();
    expect(screen.getByText(/19:32:12/)).toBeInTheDocument();
    expect(screen.queryByText(/America\/Guayaquil/)).not.toBeInTheDocument();
    expect(screen.getByTitle("Mapa de Punto de prueba Quito")).toHaveAttribute("src", expect.stringContaining("marker=-0.22%2C-78.5"));
    const summary = within(screen.getByRole("region", { name: "Tu pedido N.º 700" }));
    expect(summary.getByText("IVA (15 %)" )).toBeInTheDocument();
    expect(summary.getByText(/2[.,]78/)).toBeInTheDocument();
    const immediate = within(screen.getByRole("complementary", { name: "Tu pedido" }));
    expect(immediate.queryByText(/IVA|Total|Cien años/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Transportista|Seguimiento/)).not.toBeInTheDocument();
    await user.click(immediate.getByRole("link", { name: "Ver pedido completo" }));
    await waitFor(() => expect(screen.getByRole("heading", { level: 1, name: "Detalle del pedido" })).toHaveFocus());
  });

  it("requires an explicit selection when multiple locations exist", async () => {
    const transport = api({ "GET /api/v1/pickup-locations": () => json([pickupLocation, { ...pickupLocation, id: "9", name: "Segundo punto", address: "Otro destino", postalCode: null }]) });
    const user = userEvent.setup(); renderPurchaseRoute(routes, "/checkout");
    await user.click(await screen.findByRole("tab", { name: "Retiro" }));
    const second = await screen.findByRole("radio", { name: /Segundo punto/ }); await transfer(user);
    await user.click(screen.getByRole("button", { name: "Hacer pedido" }));
    expect(await screen.findByText("Elige un punto de retiro.")).toBeInTheDocument();
    expect(transport.count("POST", "/api/v1/checkout")).toBe(0);
    expect(screen.getAllByRole("radio")[0]).toHaveFocus();
    await user.click(second); expect(screen.getByText("Segundo punto")).toBeInTheDocument();
    expect(screen.queryByTitle("Mapa de Segundo punto")).not.toBeInTheDocument();
  });

  it("announces loading, recovers a location error and handles an empty list", async () => {
    let finish!: (response: Response) => void;
    api({ "GET /api/v1/pickup-locations": [() => new Promise<Response>(resolve => { finish = resolve; }), () => json([])] });
    const user = userEvent.setup(); renderPurchaseRoute(routes, "/checkout");
    await user.click(await screen.findByRole("tab", { name: "Retiro" }));
    expect(await screen.findByText("Consultando puntos de retiro…")).toHaveAttribute("role", "status");
    finish(problem(400, "READ_FAILURE", "No disponible", "Vuelve a intentarlo."));
    const failure = await screen.findByText("No pudimos consultar los puntos de retiro.");
    await user.click(within(failure.closest("div")!).getByRole("button", { name: "Volver a intentar" }));
    expect(await screen.findByText(/No hay puntos de retiro disponibles/)).toBeInTheDocument();
    expect(screen.getByRole("tabpanel")).toHaveFocus();
    expect(screen.getByRole("button", { name: "Hacer pedido" })).toHaveAttribute("aria-disabled", "true");
    await user.click(screen.getByRole("tab", { name: "Entrega" }));
    expect(await screen.findByText(/Av\. Principal 123/)).toBeInTheDocument();
  });

  it.each(["P5010", "P5011", "P5012"])("preserves the known backend rejection %s rather than leaving an unknown attempt", async (code) => {
    api(); await expect(submitCheckout({ fulfillmentMethod: "STORE_PICKUP", pickupLocationId: "8", paymentMethod: "TRANSFER" }, "550e8400-e29b-41d4-a716-446655440000")).resolves.toMatchObject({ fulfillment: { pickup: pickupSnapshot } });
    stubApi({ "POST /api/v1/checkout": () => problem(409, code, "Retiro no disponible", "Elige otro método.") });
    await expect(submitCheckout({ fulfillmentMethod: "STORE_PICKUP", pickupLocationId: "8", paymentMethod: "TRANSFER" }, "550e8400-e29b-41d4-a716-446655440001")).rejects.toMatchObject({ name: "ApiRequestError", code });
  });

  it("retains immutable pickup and pricing snapshots through detail and attempt resolution", async () => {
    api({ "POST /api/v1/checkout/attempts/*/resolve": () => json({ state: "CREATED", order: approved }) });
    expect((await getOrder("700")).fulfillment).toMatchObject({ pickup: pickupSnapshot, state: "PENDING" });
    expect(await resolveCheckout("550e8400-e29b-41d4-a716-446655440000")).toMatchObject({ state: "CREATED", order: { fulfillment: { pickup: pickupSnapshot }, taxAmount: "2.78" } });
  });

  it("leaves an incomplete pickup receipt unresolved rather than discarding pickup facts", async () => {
    api({ "POST /api/v1/checkout": () => json({ ...approved, fulfillment: { method: "STORE_PICKUP" } }, 201) });
    await expect(submitCheckout({ fulfillmentMethod: "STORE_PICKUP", pickupLocationId: "8", paymentMethod: "TRANSFER" }, "550e8400-e29b-41d4-a716-446655440000")).rejects.toMatchObject({ name: "CheckoutOutcomeUnknown" });
  });

  it("names simultaneous location and bank failures independently for assistive technology", async () => {
    api({ "GET /api/v1/pickup-locations": () => problem(400, "READ_FAILURE", "Sin conexión", "Vuelve a intentar."),
      "GET /api/v1/reference/transfer-details": () => problem(400, "READ_FAILURE", "Sin conexión", "Vuelve a intentar.") });
    const user = userEvent.setup(); renderPurchaseRoute(routes, "/checkout");
    await user.click(await screen.findByRole("tab", { name: "Retiro" }));
    await user.click(screen.getByRole("button", { name: "Transferencia bancaria" }));
    expect(await screen.findByRole("alert", { name: "No pudimos consultar los puntos de retiro." })).toBeInTheDocument();
    expect(await screen.findByRole("alert", { name: "No pudimos consultar los datos bancarios." })).toBeInTheDocument();
  });

  it("resolves a lost pickup checkout without replaying it or losing its snapshot", async () => {
    const transport = api({ "POST /api/v1/checkout": () => { throw new TypeError("Failed to fetch"); },
      "POST /api/v1/checkout/attempts/*/resolve": () => json({ state: "CREATED", order: approved }) });
    const user = userEvent.setup(); renderPurchaseRoute(routes, "/checkout"); await selectPickup(user); await transfer(user);
    await user.click(screen.getByRole("button", { name: "Hacer pedido" }));
    await user.click(await screen.findByRole("button", { name: /Consultar resultado/ }));
    expect(await screen.findByText("P-ABC234")).toBeInTheDocument();
    expect(transport.calls.filter(call => call.method === "POST" && call.path === "/api/v1/checkout")).toHaveLength(1);
    await waitFor(() => expect(screen.getByRole("heading", { level: 1 })).toHaveFocus());
  });
});
