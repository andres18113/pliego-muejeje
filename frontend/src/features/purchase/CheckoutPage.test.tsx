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
    await user.type(screen.getByLabelText("Caducidad (MM/AA)"), "12/30");
    await user.type(screen.getByLabelText("Código de seguridad"), "123");
    await user.type(screen.getByLabelText("Nombre en la tarjeta"), "Ana Pérez");
  }
}

describe("CheckoutPage", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("shows only card brands supported by the current validator before entry", async () => {
    stubApi({
      "GET /api/v1/cart": () => json(cartBody()),
      "GET /api/v1/me/addresses": () => json([savedAddress]),
    });
    const user = userEvent.setup();
    renderPurchaseRoute(routes, "/checkout");
    await screen.findByText(/Av\. Principal 123/);

    await user.click(screen.getByRole("radio", { name: /Tarjeta/ }));

    expect(screen.getByText("Proceso de compra seguro")).toBeInTheDocument();
    expect(screen.getByRole("list", { name: "Tarjetas aceptadas" })).toBeInTheDocument();
    for (const brand of ["Visa", "Mastercard", "American Express", "Diners Club"]) {
      expect(screen.getByRole("img", { name: brand })).toBeInTheDocument();
    }
    expect(screen.queryByRole("img", { name: /Discover|JCB/ })).not.toBeInTheDocument();
  });

  it("formats expiry digits as MM / AA and remains editable with the keyboard", async () => {
    stubApi({
      "GET /api/v1/cart": () => json(cartBody()),
      "GET /api/v1/me/addresses": () => json([savedAddress]),
    });
    const user = userEvent.setup();
    renderPurchaseRoute(routes, "/checkout");
    await screen.findByText(/Av\. Principal 123/);
    await user.click(screen.getByRole("radio", { name: /Tarjeta/ }));

    const expiry = screen.getByLabelText("Caducidad (MM/AA)");
    await user.type(expiry, "1");
    expect(expiry).toHaveValue("1");
    await user.type(expiry, "a");
    expect(expiry).toHaveValue("1");
    await user.type(expiry, "0");
    expect(expiry).toHaveValue("10 /");
    await user.type(expiry, "2");
    expect(expiry).toHaveValue("10 / 2");
    await user.type(expiry, "0");
    expect(expiry).toHaveValue("10 / 20");
    await user.keyboard("{Backspace}");
    expect(expiry).toHaveValue("10 / 2");
    await user.type(expiry, "0");
    expect(expiry).toHaveValue("10 / 20");
    await user.type(expiry, "789");
    expect(expiry).toHaveValue("10 / 20");
    expect(expiry).toHaveAttribute("inputmode", "numeric");
  });

  it("advances through valid card fields and keeps focus on incomplete or invalid values", async () => {
    stubApi({
      "GET /api/v1/cart": () => json(cartBody()),
      "GET /api/v1/me/addresses": () => json([savedAddress]),
    });
    const user = userEvent.setup();
    renderPurchaseRoute(routes, "/checkout");
    await fillCheckout(user, "Tarjeta");

    const number = screen.getByLabelText("Número de tarjeta");
    await user.type(number, "411111111111111");
    expect(number).toHaveFocus();
    await user.keyboard("1");
    const expiry = screen.getByLabelText("Caducidad (MM/AA)");
    await waitFor(() => expect(expiry).toHaveFocus());

    await user.type(expiry, "1328");
    expect(expiry).toHaveFocus();
    await user.clear(expiry);
    await user.type(expiry, "1228");
    const cvv = screen.getByLabelText("Código de seguridad");
    await waitFor(() => expect(cvv).toHaveFocus());

    await user.type(cvv, "12");
    expect(cvv).toHaveFocus();
    await user.keyboard("3");
    await waitFor(() => expect(screen.getByLabelText("Nombre en la tarjeta")).toHaveFocus());
  });

  it("keeps transaction feedback visible before navigating to the created order", async () => {
    stubApi({
      "GET /api/v1/cart": () => json(cartBody()),
      "GET /api/v1/me/addresses": () => json([savedAddress]),
      "GET /api/v1/orders": () => json({ items: [], page: 0, pageSize: 1, totalCount: "0" }),
      "POST /api/v1/checkout": () => json(approved, 201),
    });
    const user = userEvent.setup();
    renderPurchaseRoute(routes, "/checkout");
    await fillCheckout(user, "Transferencia");
    const submittedAt = Date.now();

    await user.click(screen.getByRole("button", { name: /Pagar/ }));

    expect(await screen.findByText("Procesando tu pago…")).toBeInTheDocument();
    expect(await screen.findByRole("heading", { name: "Pedido abierto" })).toBeInTheDocument();
    expect(Date.now() - submittedAt).toBeGreaterThanOrEqual(480);
  });

  it("rejects expiry months outside 01–12, identifies the field, and focuses it", async () => {
    const api = stubApi({
      "GET /api/v1/cart": () => json(cartBody()),
      "GET /api/v1/me/addresses": () => json([savedAddress]),
    });
    const user = userEvent.setup();
    renderPurchaseRoute(routes, "/checkout");

    await fillCheckout(user, "Tarjeta", "4111111111111111");
    const expiry = screen.getByLabelText("Caducidad (MM/AA)");
    await user.clear(expiry);
    await user.type(expiry, "1328");
    await user.click(screen.getByRole("button", { name: /Pagar/ }));

    expect(await screen.findByText("Escribe la fecha de caducidad en formato MM/AA.")).toBeInTheDocument();
    expect(expiry).toHaveAttribute("aria-invalid", "true");
    expect(expiry).toHaveFocus();
    expect(api.count("POST", "/api/v1/checkout")).toBe(0);
  });

  it("rejects an expired month and year before sending checkout", async () => {
    const api = stubApi({
      "GET /api/v1/cart": () => json(cartBody()),
      "GET /api/v1/me/addresses": () => json([savedAddress]),
    });
    const user = userEvent.setup();
    renderPurchaseRoute(routes, "/checkout");

    await fillCheckout(user, "Tarjeta", "4111111111111111");
    const previousMonth = new Date(new Date().getFullYear(), new Date().getMonth() - 1, 1);
    const expiredDigits = `${String(previousMonth.getMonth() + 1).padStart(2, "0")}${String(previousMonth.getFullYear() % 100).padStart(2, "0")}`;
    const expiry = screen.getByLabelText("Caducidad (MM/AA)");
    await user.clear(expiry);
    await user.type(expiry, expiredDigits);
    await user.click(screen.getByRole("button", { name: /Pagar/ }));

    expect(await screen.findByText("La fecha de caducidad de la tarjeta ya venció.")).toBeInTheDocument();
    expect(expiry).toHaveFocus();
    expect(api.count("POST", "/api/v1/checkout")).toBe(0);
  });

  it("uses the shared searchable country picker for a new checkout address", async () => {
    stubApi({
      "GET /api/v1/cart": () => json(cartBody()),
      "GET /api/v1/me/addresses": () => json([]),
    });
    const user = userEvent.setup();
    renderPurchaseRoute(routes, "/checkout");

    const country = await screen.findByRole("combobox", { name: "País de entrega" });
    await user.click(country);
    const search = await screen.findByRole("combobox", { name: "Buscar país de entrega" });
    await user.type(search, "Colom");
    await user.keyboard("{ArrowDown}{Enter}");

    expect(country).toHaveTextContent("Colombia");
    expect(screen.queryByRole("combobox", { name: "Buscar país de entrega" })).not.toBeInTheDocument();
  });

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

    expect(await screen.findByText("Este número de tarjeta no es válido. Revisa los dígitos.")).toBeInTheDocument();
    expect(screen.getByLabelText("Número de tarjeta")).toHaveFocus();
    expect(api.count("POST", "/api/v1/checkout")).toBe(0);
  });

  it("identifies the card-number field in a server validation error", async () => {
    const api = stubApi({
      "GET /api/v1/cart": () => json(cartBody()),
      "GET /api/v1/me/addresses": () => json([savedAddress]),
      "GET /api/v1/orders": () => json({ items: [], page: 0, pageSize: 1, totalCount: "0" }),
      "POST /api/v1/checkout": () => problem(400, "INVALID_CARD_NUMBER", "Número de tarjeta no válido", "El número no pasó la validación."),
    });
    const user = userEvent.setup();
    renderPurchaseRoute(routes, "/checkout");

    await fillCheckout(user, "Tarjeta", "4111111111111111");
    await user.click(screen.getByRole("button", { name: /Pagar/ }));

    await waitFor(() => expect(api.count("POST", "/api/v1/checkout")).toBe(1));
    expect(await screen.findByText("Número de tarjeta: El número no pasó la validación. Vuelve a escribirlo.")).toBeInTheDocument();
    expect(screen.getByLabelText("Número de tarjeta")).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByLabelText("Número de tarjeta")).toHaveValue("");
    await waitFor(() => expect(screen.getByLabelText("Número de tarjeta")).toHaveFocus());
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
    expect(screen.getByLabelText("Código de seguridad")).toHaveAttribute("maxlength", "4");
    await user.clear(screen.getByLabelText("Código de seguridad"));
    await user.type(screen.getByLabelText("Código de seguridad"), "1234");
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
    expect(await screen.findByText("Banco Guayaquil")).toBeInTheDocument();
    expect(screen.getByText("2557897233")).toBeInTheDocument();
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
