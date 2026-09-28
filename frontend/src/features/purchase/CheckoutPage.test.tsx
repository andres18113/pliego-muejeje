import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cartBody, json, problem, renderPurchaseRoute, savedAddress, stubApi } from "@/test/purchase";
import { CheckoutPage } from "./CheckoutPage";

const routes = [
  { path: "/checkout", element: <CheckoutPage /> },
  { path: "/orders/:orderId", element: <h1>Pedido abierto</h1> },
  { path: "/sign-in", element: <h1>Iniciar sesión</h1> },
];

const approved = { orderId: "700", orderState: "CONFIRMED", paymentState: "APPROVED", total: "18.50", paymentReference: "SIM-1" };

async function fillCheckout(user: ReturnType<typeof userEvent.setup>, method: "Tarjeta" | "Transferencia", card?: string) {
  await screen.findByText(/Av\. Principal 123/);
  await user.click(screen.getByRole("radio", { name: new RegExp(method) }));
  if (card !== undefined) {
    await user.type(screen.getByLabelText("Número de tarjeta"), card);
    await user.type(screen.getByLabelText("Vencimiento (MM/AA)"), "12/30");
    await user.type(screen.getByLabelText("CVV"), "123");
    await user.type(screen.getByLabelText("Nombre en la tarjeta"), "Ana Pérez");
  }
}

describe("CheckoutPage", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("sends one CARD checkout with the saved address and opens the created order", async () => {
    const api = stubApi({
      "GET /api/v1/cart": () => json(cartBody()),
      "GET /api/v1/me/addresses": () => json([savedAddress]),
      "GET /api/v1/orders": () => json({ items: [], page: 0, pageSize: 1, totalCount: "0" }),
      "POST /api/v1/checkout": () => json(approved, 201),
    });
    const user = userEvent.setup();
    renderPurchaseRoute(routes, "/checkout");

    await fillCheckout(user, "Tarjeta", "4111 1111 1111 1111");
    expect(screen.queryByText("Pago aprobado")).not.toBeInTheDocument();
    expect(screen.getByLabelText("Número de tarjeta")).toHaveValue("4111 1111 1111 1111");
    expect(screen.getByRole("img", { name: "Visa detectada" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /Pagar/ }));

    expect(await screen.findByRole("heading", { name: "Pedido abierto" })).toBeInTheDocument();
    const post = api.calls.find((call) => call.method === "POST");
    expect(post?.body).toEqual({
      addressId: "15",
      paymentMethod: "CARD",
      simulationOutcome: "APPROVED",
      cardNumber: "4111111111111111",
    });
    expect(api.count("POST", "/api/v1/checkout")).toBe(1);
  });

  it("rejects a non-Luhn card locally and never calls checkout", async () => {
    const api = stubApi({
      "GET /api/v1/cart": () => json(cartBody()),
      "GET /api/v1/me/addresses": () => json([savedAddress]),
    });
    const user = userEvent.setup();
    renderPurchaseRoute(routes, "/checkout");

    await fillCheckout(user, "Tarjeta", "4111111111111112");
    await user.click(screen.getByRole("button", { name: /Pagar/ }));

    expect(await screen.findByText("Este número no es válido. Revisa los dígitos.")).toBeInTheDocument();
    expect(screen.getByLabelText("Número de tarjeta")).toHaveFocus();
    expect(api.count("POST", "/api/v1/checkout")).toBe(0);
  });

  it("detects American Express and accepts its four-digit security code", async () => {
    const api = stubApi({
      "GET /api/v1/cart": () => json(cartBody()),
      "GET /api/v1/me/addresses": () => json([savedAddress]),
      "GET /api/v1/orders": () => json({ items: [], page: 0, pageSize: 1, totalCount: "0" }),
      "POST /api/v1/checkout": () => json(approved, 201),
    });
    const user = userEvent.setup();
    renderPurchaseRoute(routes, "/checkout");
    await fillCheckout(user, "Tarjeta", "378282246310005");
    expect(screen.getByRole("img", { name: "American Express detectada" })).toBeInTheDocument();
    expect(screen.getByLabelText("CVV")).toHaveAttribute("maxlength", "4");
    await user.clear(screen.getByLabelText("CVV"));
    await user.type(screen.getByLabelText("CVV"), "1234");
    await user.click(screen.getByRole("button", { name: /Pagar/ }));
    expect(await screen.findByRole("heading", { name: "Pedido abierto" })).toBeInTheDocument();
    expect(api.calls.find((call) => call.method === "POST")?.body).toMatchObject({ cardNumber: "378282246310005" });
  });

  it("discards the card number when switching to TRANSFER and omits it from the request", async () => {
    const api = stubApi({
      "GET /api/v1/cart": () => json(cartBody()),
      "GET /api/v1/me/addresses": () => json([savedAddress]),
      "GET /api/v1/orders": () => json({ items: [], page: 0, pageSize: 1, totalCount: "0" }),
      "POST /api/v1/checkout": () => json(approved, 201),
    });
    const user = userEvent.setup();
    renderPurchaseRoute(routes, "/checkout");

    await fillCheckout(user, "Tarjeta", "4111111111111111");
    await user.click(screen.getByRole("radio", { name: /Transferencia/ }));
    expect(await screen.findByText("Banco PLIEGO")).toBeInTheDocument();
    expect(screen.getByText("0000000000")).toBeInTheDocument();
    expect(screen.queryByLabelText("Número de tarjeta")).not.toBeInTheDocument();
    await user.click(screen.getByRole("radio", { name: /Tarjeta/ }));
    expect(screen.getByLabelText("Número de tarjeta")).toHaveValue("");
    await user.click(screen.getByRole("radio", { name: /Transferencia/ }));
    await user.click(screen.getByRole("button", { name: /Pagar/ }));

    await screen.findByRole("heading", { name: "Pedido abierto" });
    expect(api.calls.find((call) => call.method === "POST")?.body).toEqual({
      addressId: "15",
      paymentMethod: "TRANSFER",
      simulationOutcome: "APPROVED",
    });
  });

  it("does not replay checkout after an unknown outcome and reconciles through orders", async () => {
    const api = stubApi({
      "GET /api/v1/cart": () => json(cartBody()),
      "GET /api/v1/me/addresses": () => json([savedAddress]),
      "GET /api/v1/orders": [
        () => json({ items: [{ orderId: "699", orderState: "CONFIRMED", total: "5.00" }], page: 0, pageSize: 1, totalCount: "1" }),
        () => json({ items: [
          { orderId: "700", orderState: "CONFIRMED", total: "18.50" },
          { orderId: "699", orderState: "CONFIRMED", total: "5.00" },
        ], page: 0, pageSize: 5, totalCount: "2" }),
      ],
      "POST /api/v1/checkout": () => { throw new TypeError("Failed to fetch"); },
    });
    const user = userEvent.setup();
    renderPurchaseRoute(routes, "/checkout");

    await fillCheckout(user, "Transferencia");
    await user.click(screen.getByRole("button", { name: /Pagar/ }));

    expect(await screen.findByRole("heading", { name: "No pudimos confirmar si se creó tu pedido." })).toBeInTheDocument();
    const submitButton = screen.getByRole("button", { name: /Pagar/ });
    expect(submitButton).toHaveAttribute("aria-disabled", "true");
    await user.click(submitButton);
    expect(api.count("POST", "/api/v1/checkout")).toBe(1);

    await user.click(screen.getByRole("button", { name: "Consultar mis pedidos" }));
    expect(await screen.findByRole("heading", { name: "Pedido abierto" })).toBeInTheDocument();
    expect(api.count("POST", "/api/v1/checkout")).toBe(1);
  });

  it("re-enables a deliberate attempt only after orders show no new order", async () => {
    const empty = () => json({ items: [], page: 0, pageSize: 5, totalCount: "0" });
    const api = stubApi({
      "GET /api/v1/cart": () => json(cartBody()),
      "GET /api/v1/me/addresses": () => json([savedAddress]),
      "GET /api/v1/orders": empty,
      "POST /api/v1/checkout": () => problem(503, "INTERNAL_SERVER_ERROR", "Error", "Falla temporal."),
    });
    const user = userEvent.setup();
    renderPurchaseRoute(routes, "/checkout");

    await fillCheckout(user, "Transferencia");
    await user.click(screen.getByRole("button", { name: /Pagar/ }));
    await user.click(await screen.findByRole("button", { name: "Consultar mis pedidos" }));

    expect(await screen.findByRole("heading", { name: "No se creó ningún pedido." })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Pagar/ })).not.toHaveAttribute("aria-disabled");
    expect(api.count("POST", "/api/v1/checkout")).toBe(1);
  });

  it("stops before submitting when the server cart changed since it was shown", async () => {
    const api = stubApi({
      "GET /api/v1/cart": [
        () => json(cartBody()),
        () => json(cartBody([{ currentPrice: "19.00", currentSubtotal: "19.00" }])),
      ],
      "GET /api/v1/me/addresses": () => json([savedAddress]),
      "GET /api/v1/orders": () => json({ items: [], page: 0, pageSize: 1, totalCount: "0" }),
    });
    const user = userEvent.setup();
    renderPurchaseRoute(routes, "/checkout");

    await fillCheckout(user, "Transferencia");
    await user.click(screen.getByRole("button", { name: /Pagar \$\s?18,50/ }));

    expect(await screen.findByRole("heading", { name: "Tu carrito cambió." })).toBeInTheDocument();
    expect(await screen.findByRole("button", { name: /Pagar \$\s?19,00/ })).toBeInTheDocument();
    expect(api.count("POST", "/api/v1/checkout")).toBe(0);
  });

  it("explains a P3002 stock conflict, refreshes the cart, and creates no order", async () => {
    stubApi({
      "GET /api/v1/cart": [
        () => json(cartBody()),
        () => json(cartBody()),
        () => json(cartBody([{ available: false, unavailabilityReason: "P3002" }])),
      ],
      "GET /api/v1/me/addresses": () => json([savedAddress]),
      "GET /api/v1/orders": () => json({ items: [], page: 0, pageSize: 1, totalCount: "0" }),
      "POST /api/v1/checkout": () => problem(409, "P3002", "Existencias insuficientes", "Uno o más libros ya no tienen existencias suficientes."),
    });
    const user = userEvent.setup();
    renderPurchaseRoute(routes, "/checkout");

    await fillCheckout(user, "Transferencia");
    await user.click(screen.getByRole("button", { name: /Pagar/ }));

    expect(await screen.findByRole("heading", { name: "La disponibilidad cambió y no se creó el pedido." })).toBeInTheDocument();
    // The summary renders as a mobile disclosure and a desktop aside; CSS shows one.
    expect((await screen.findAllByText("No hay existencias suficientes para esta cantidad.")).length).toBeGreaterThan(0);
    expect(screen.getByRole("link", { name: "Revisar el carrito" })).toHaveAttribute("href", "/cart");
  });

  it("maps P5004 to the address choice", async () => {
    stubApi({
      "GET /api/v1/cart": () => json(cartBody()),
      "GET /api/v1/me/addresses": () => json([savedAddress]),
      "GET /api/v1/orders": () => json({ items: [], page: 0, pageSize: 1, totalCount: "0" }),
      "POST /api/v1/checkout": () => problem(404, "P5004", "Dirección no disponible", "La dirección seleccionada no está disponible."),
    });
    const user = userEvent.setup();
    renderPurchaseRoute(routes, "/checkout");

    await fillCheckout(user, "Transferencia");
    await user.click(screen.getByRole("button", { name: /Pagar/ }));

    expect(await screen.findByText("Esa dirección ya no está disponible. Elige otra o agrega una nueva.")).toBeInTheDocument();
  });

  it("asks a guest to sign in and return to checkout", async () => {
    stubApi({});
    renderPurchaseRoute(routes, "/checkout", { role: null });

    expect(await screen.findByRole("heading", { name: "Inicia sesión para finalizar tu compra." })).toBeInTheDocument();
    // Both the page action and the header link keep the checkout intent.
    for (const link of screen.getAllByRole("link", { name: "Iniciar sesión" })) {
      expect(link).toHaveAttribute("href", "/sign-in?from=%2Fcheckout");
    }
  });

  it("clears the session and asks for sign-in again after a 401", async () => {
    stubApi({
      "GET /api/v1/cart": () => json(cartBody()),
      "GET /api/v1/me/addresses": () => json([savedAddress]),
      "GET /api/v1/orders": () => problem(401, "AUTH_INVALID_TOKEN", "Sesión no válida", "Inicia sesión otra vez."),
    });
    const user = userEvent.setup();
    renderPurchaseRoute(routes, "/checkout");

    await fillCheckout(user, "Transferencia");
    await user.click(screen.getByRole("button", { name: /Pagar/ }));

    await waitFor(() => expect(screen.getByRole("heading", { name: "Tu sesión ya no está activa." })).toBeInTheDocument());
  });
});
