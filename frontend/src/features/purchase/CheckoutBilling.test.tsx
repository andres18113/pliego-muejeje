import { chooseBillingPlace } from "./billingTestFixtures";
import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import { cartBody, json, renderPurchaseRoute, savedAddress, stubApi } from "@/test/purchase";
import { pickupLocation } from "@/test/pickup";
import { CheckoutPage } from "./CheckoutPage";

const routes = [{ path: "/checkout", element: <CheckoutPage /> }, { path: "/orders/:orderId", element: <h1>Pedido confirmado</h1> }];
const profile = { customerId: "2", email: "reader@example.test", firstNames: "Lectora", lastNames: "Prueba", phone: null, state: "ACTIVE", version: "0" };
const office = { ...savedAddress, addressId: "16", alias: "Oficina", line1: "Calle Oficina 9", city: "Cuenca", province: "Azuay", provinceId: "1", cityId: "1", primary: false };
const approved = { orderId: "700", orderState: "CONFIRMED", paymentState: "APPROVED", total: "18.50" };
const noIdentity = () => new Response(null, { status: 204 });
const digitalCart = () => json(cartBody([{ format: "EBOOK", requiresPhysicalFulfillment: false }]));

function install({ post = () => json(approved, 201), cart = digitalCart, addresses = [] as unknown[], identity = noIdentity }: {
  post?: (request: Request) => Promise<Response> | Response; cart?: () => Response; addresses?: unknown[]; identity?: () => Response;
} = {}) {
  return stubApi({ "GET /api/v1/cart": cart, "GET /api/v1/me": () => json(profile), "GET /api/v1/me/billing-identity": identity,
    "GET /api/v1/me/addresses": () => json(addresses), "GET /api/v1/pickup-locations": () => json([pickupLocation]), "POST /api/v1/checkout": post });
}
const billingSection = () => within(document.getElementById("checkout-billing")!);
/** The invoice section once checkout has rendered it. */
async function billingArea() { return within(await screen.findByRole("region", { name: "Factura" })); }
async function transfer(user = userEvent.setup()) {
  await user.click(await screen.findByRole("button", { name: /Transferencia/ }));
  await screen.findByText("Banco Guayaquil");
}
/** The invoice's own address: the street typed, then province and city chosen from the catalog. */
async function typeAddress() {
  const billing = billingSection();
  fireEvent.change(billing.getByLabelText("Dirección", { exact: true }), { target: { value: "Calle Fiscal de prueba" } });
  await chooseBillingPlace();
}
const checkoutBody = (api: ReturnType<typeof stubApi>) => api.calls.find(call => call.method === "POST" && call.path === "/api/v1/checkout")?.body;
afterEach(() => vi.unstubAllGlobals());

it("reuses the delivery address for the invoice: a chip says so, no address is typed twice", async () => {
  const api = install({ cart: () => json(cartBody()), addresses: [savedAddress], identity: () => json({ type: "EC_CEDULA", number: "1710034065" }) });
  renderPurchaseRoute(routes, "/checkout");
  const billing = within(await screen.findByRole("region", { name: "Factura" }));
  expect(await billing.findByText("Igual que la entrega")).toBeVisible();
  expect(billing.getByText("Av. Principal 123, Quito")).toBeVisible();
  expect(billing.getByText("Lectora Prueba")).toBeVisible();
  expect(billing.getByText("1710034065")).toBeVisible();
  expect(billing.queryByRole("textbox")).not.toBeInTheDocument();
  expect(screen.queryByText(/SIMULACIÓN ACADÉMICA/)).not.toBeInTheDocument();
  await transfer();
  await userEvent.click(screen.getByRole("button", { name: "Hacer pedido" }));
  await screen.findByRole("heading", { name: "Pedido confirmado" });
  expect(checkoutBody(api)).toMatchObject({ fulfillmentMethod: "HOME_DELIVERY", addressId: "15", buyerName: "Lectora Prueba",
    billingIdentity: { type: "EC_CEDULA", number: "1710034065" },
    billingAddress: { line1: "Av. Principal 123", provinceId: "17", cityId: "893", countryCode: "EC" } });
});

it("follows the delivery address when it changes", async () => {
  install({ cart: () => json(cartBody()), addresses: [savedAddress, office] });
  const user = userEvent.setup();
  renderPurchaseRoute(routes, "/checkout");
  expect(await (await billingArea()).findByText("Av. Principal 123, Quito")).toBeVisible();
  await user.click(screen.getByRole("button", { name: "Cambiar dirección" }));
  await user.click(screen.getByRole("radio", { name: /Oficina/ }));
  expect(await (await billingArea()).findByText("Calle Oficina 9, Cuenca")).toBeVisible();
  expect(billingSection().getByText("Igual que la entrega")).toBeVisible();
});

it("waits for the delivery address instead of asking for a second one", async () => {
  install({ cart: () => json(cartBody()), addresses: [] });
  renderPurchaseRoute(routes, "/checkout");
  const billing = within(await screen.findByRole("region", { name: "Factura" }));
  expect(await billing.findByText("Elige primero dónde entregar.")).toBeVisible();
  expect(billing.queryByLabelText("Dirección", { exact: true })).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Añadir dirección" })).toBeVisible();
});

it("takes a different invoice address only when asked, and keeps what was typed when switching back and forth", async () => {
  const api = install({ cart: () => json(cartBody()), addresses: [savedAddress], identity: () => json({ type: "EC_CEDULA", number: "1710034065" }) });
  const user = userEvent.setup();
  renderPurchaseRoute(routes, "/checkout");
  await (await billingArea()).findByText("Igual que la entrega");
  await user.click(screen.getByRole("button", { name: "Cambiar datos de factura" }));
  expect(screen.getByRole("radio", { name: /Misma dirección de entrega/ })).toBeChecked();
  await user.click(screen.getByRole("radio", { name: /Otra dirección/ }));
  expect(billingSection().queryByLabelText("Complemento (opcional)")).not.toBeInTheDocument();
  await typeAddress();
  await user.click(billingSection().getByRole("button", { name: "Añadir complemento o código postal" }));
  await waitFor(() => expect(billingSection().getByLabelText("Complemento (opcional)")).toHaveFocus());
  fireEvent.change(billingSection().getByLabelText("Código postal (opcional)"), { target: { value: "170101" } });
  await user.click(screen.getByRole("radio", { name: /Misma dirección de entrega/ }));
  expect(billingSection().queryByLabelText("Dirección", { exact: true })).not.toBeInTheDocument();
  await user.click(screen.getByRole("radio", { name: /Otra dirección/ }));
  expect(billingSection().getByLabelText("Dirección", { exact: true })).toHaveValue("Calle Fiscal de prueba");
  await user.click(screen.getByRole("button", { name: "Usar estos datos" }));
  await waitFor(() => expect(screen.getByRole("button", { name: "Cambiar datos de factura" })).toHaveFocus());
  await transfer(user);
  await user.click(screen.getByRole("button", { name: "Hacer pedido" }));
  await screen.findByRole("heading", { name: "Pedido confirmado" });
  expect(checkoutBody(api)).toMatchObject({ addressId: "15", billingAddress: { line1: "Calle Fiscal de prueba", provinceId: "17", cityId: "893", postalCode: "170101", countryCode: "EC" } });
});

it("changes the name for this invoice only, never the profile", async () => {
  const api = install({ cart: () => json(cartBody()), addresses: [savedAddress], identity: () => json({ type: "EC_CEDULA", number: "1710034065" }) });
  const user = userEvent.setup();
  renderPurchaseRoute(routes, "/checkout");
  await (await billingArea()).findByText("Lectora Prueba");
  await user.click(screen.getByRole("button", { name: "Cambiar datos de factura" }));
  // The details open on who the invoice is for; the account holder stays chosen.
  await waitFor(() => expect(billingSection().getByRole("radio", { name: /Para mí/ })).toHaveFocus());
  expect(billingSection().getByRole("radio", { name: /Para mí/ })).toBeChecked();
  const name = billingSection().getByLabelText("Nombre para la factura");
  expect(name).toHaveAccessibleDescription("Solo para esta factura; tu perfil no cambia.");
  await user.clear(name);
  await user.type(name, "Editorial Lectora");
  await user.click(screen.getByRole("button", { name: "Usar estos datos" }));
  expect(await (await billingArea()).findByText("Editorial Lectora")).toBeVisible();
  await transfer(user);
  await user.click(screen.getByRole("button", { name: "Hacer pedido" }));
  await screen.findByRole("heading", { name: "Pedido confirmado" });
  expect(checkoutBody(api)).toMatchObject({ billingRecipient: "ACCOUNT", buyerName: "Editorial Lectora", billingIdentity: { type: "EC_CEDULA", number: "1710034065" } });
  expect(api.calls.some(call => call.path.startsWith("/api/v1/me") && call.method !== "GET")).toBe(false);
});

it("invoices another person or company for this purchase only, keeping name and number together", async () => {
  const api = install({ cart: () => json(cartBody()), addresses: [savedAddress], identity: () => json({ type: "EC_CEDULA", number: "1710034065" }) });
  const user = userEvent.setup();
  renderPurchaseRoute(routes, "/checkout");
  await (await billingArea()).findByText("Lectora Prueba");
  await user.click(screen.getByRole("button", { name: "Cambiar datos de factura" }));
  await user.click(billingSection().getByRole("radio", { name: /Otra persona o empresa/ }));
  // Nothing of the account carries over: an empty name for a person or a company, and its own number.
  const name = billingSection().getByLabelText("Nombre o razón social");
  expect(name).toHaveValue("");
  const number = billingSection().getByLabelText("Cédula o RUC");
  expect(number).toHaveValue("");
  expect(number).toHaveAccessibleDescription(/Solo para esta factura; no se guarda en tu perfil\./);
  await user.click(screen.getByRole("button", { name: "Usar estos datos" }));
  expect(await billingSection().findByText("Escribe el nombre o la razón social.")).toBeVisible();
  await user.type(name, "Distribuidora Andina S.A.");
  await user.type(number, "1790016919001");
  await user.click(screen.getByRole("button", { name: "Usar estos datos" }));
  expect(await (await billingArea()).findByText("Distribuidora Andina S.A.")).toBeVisible();
  expect(billingSection().getByText("Otra persona o empresa · solo esta factura")).toBeVisible();
  expect(billingSection().getByText("1790016919001")).toBeVisible();
  await transfer(user);
  await user.click(screen.getByRole("button", { name: "Hacer pedido" }));
  await screen.findByRole("heading", { name: "Pedido confirmado" });
  expect(checkoutBody(api)).toMatchObject({ billingRecipient: "OTHER", buyerName: "Distribuidora Andina S.A.", billingIdentity: { type: "EC_RUC", number: "1790016919001" } });
  expect(api.calls.some(call => call.path.startsWith("/api/v1/me") && call.method !== "GET")).toBe(false);
});

it("returns to the account holder's own name and number when switching back", async () => {
  install({ cart: () => json(cartBody()), addresses: [savedAddress], identity: () => json({ type: "EC_CEDULA", number: "1710034065" }) });
  const user = userEvent.setup();
  renderPurchaseRoute(routes, "/checkout");
  await (await billingArea()).findByText("Lectora Prueba");
  await user.click(screen.getByRole("button", { name: "Cambiar datos de factura" }));
  await user.click(billingSection().getByRole("radio", { name: /Otra persona o empresa/ }));
  await user.type(billingSection().getByLabelText("Nombre o razón social"), "Comprador tercero");
  await user.click(billingSection().getByRole("radio", { name: /Para mí/ }));
  expect(billingSection().getByLabelText("Nombre para la factura")).toHaveValue("Lectora Prueba");
  expect(billingSection().getByText("1710034065")).toBeVisible();
  // The other recipient's typing waits for the customer if they change their mind again.
  await user.click(billingSection().getByRole("radio", { name: /Otra persona o empresa/ }));
  expect(billingSection().getByLabelText("Nombre o razón social")).toHaveValue("Comprador tercero");
});

it("for pickup, invoices a saved address, shown with its name", async () => {
  const api = install({ cart: () => json(cartBody()), addresses: [{ ...office, primary: true }], identity: () => json({ type: "EC_RUC", number: "1790016919001" }) });
  const user = userEvent.setup();
  renderPurchaseRoute(routes, "/checkout");
  await user.click(await screen.findByRole("tab", { name: "Retiro" }));
  await user.click(await screen.findByRole("radio", { name: new RegExp(pickupLocation.name) }));
  const billing = billingSection();
  expect(await billing.findByText("Oficina")).toBeVisible();
  expect(billing.getByText("Calle Oficina 9, Cuenca")).toBeVisible();
  expect(billing.getByText("RUC")).toBeVisible();
  await transfer(user);
  await user.click(screen.getByRole("button", { name: "Hacer pedido" }));
  await screen.findByRole("heading", { name: "Pedido confirmado" });
  expect(checkoutBody(api)).toMatchObject({ fulfillmentMethod: "STORE_PICKUP", billingIdentity: { type: "EC_RUC", number: "1790016919001" }, billingAddress: { line1: "Calle Oficina 9", provinceId: "1", cityId: "1" } });
});

it("asks a digital purchase with no saved address only for street, city and province, and sends one snapshot", async () => {
  const api = install();
  const user = userEvent.setup();
  renderPurchaseRoute(routes, "/checkout");
  const billing = within(await screen.findByRole("region", { name: "Factura" }));
  expect(await billing.findByRole("group", { name: "Dirección de facturación" })).toBeVisible();
  expect(billing.queryByLabelText("Código postal (opcional)")).not.toBeInTheDocument();
  await transfer(user);
  await user.click(screen.getByRole("button", { name: "Hacer pedido" }));
  expect(api.count("POST", "/api/v1/checkout")).toBe(0);
  await waitFor(() => expect(billing.getByLabelText("Cédula o RUC")).toHaveAccessibleDescription(/Escribe tu cédula o RUC\./));
  fireEvent.change(billing.getByLabelText("Cédula o RUC"), { target: { value: "0123456782" } });
  await typeAddress();
  await user.click(screen.getByRole("button", { name: "Hacer pedido" }));
  await screen.findByRole("heading", { name: "Pedido confirmado" });
  const posts = api.calls.filter(call => call.method === "POST" && call.path === "/api/v1/checkout");
  expect(posts).toHaveLength(1);
  expect(posts[0].body).toMatchObject({ fulfillmentMethod: "DIGITAL_ONLY", billingIdentity: { type: "EC_CEDULA", number: "0123456782" }, buyerName: "Lectora Prueba",
    billingAddress: { line1: "Calle Fiscal de prueba", provinceId: "17", cityId: "893", countryCode: "EC" } });
  expect(posts[0].body).not.toHaveProperty("addressId");
  expect(Object.keys(localStorage).filter(key => key.startsWith("pliego:checkout-billing:"))).toHaveLength(0);
});

it("stores no fiscal data while the recovery key survives remount without replay", async () => {
  const api = install({ post: () => Promise.reject(new TypeError("Network unavailable")) });
  const view = renderPurchaseRoute(routes, "/checkout");
  await transfer();
  fireEvent.change(await (await billingArea()).findByLabelText("Cédula o RUC"), { target: { value: "0123456782" } });
  await typeAddress();
  await userEvent.click(screen.getByRole("button", { name: "Hacer pedido" }));
  await waitFor(() => expect(api.count("POST", "/api/v1/checkout")).toBe(1));
  await screen.findByText(/El resultado sigue pendiente/);
  for (const storage of [localStorage, sessionStorage]) {
    const persisted = JSON.stringify(storage);
    expect(persisted).not.toContain("0123456782");
    expect(persisted).not.toContain("Calle Fiscal de prueba");
  }
  expect(Object.keys(localStorage).some(key => key.startsWith("pliego:pending:checkout:"))).toBe(true);
  view.unmount();
  renderPurchaseRoute(routes, "/checkout");
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 50)); });
  expect(api.count("POST", "/api/v1/checkout")).toBe(1);
});

it("routes authoritative fiscal validation back to the field", async () => {
  const api = install({ post: () => json({ status: 400, code: "VALIDATION_ERROR", title: "Datos inválidos", detail: "Revisa los datos fiscales.", violations: [{ field: "billingIdentity.number", message: "Revisa la cédula enviada." }] }, 400) });
  renderPurchaseRoute(routes, "/checkout");
  await transfer();
  fireEvent.change(await (await billingArea()).findByLabelText("Cédula o RUC"), { target: { value: "0123456782" } });
  await typeAddress();
  await userEvent.click(screen.getByRole("button", { name: "Hacer pedido" }));
  const field = billingSection().getByLabelText("Cédula o RUC");
  await waitFor(() => expect(field).toHaveAccessibleDescription(/Revisa la cédula enviada\./));
  await waitFor(() => expect(field).toHaveFocus());
  expect(api.count("POST", "/api/v1/checkout")).toBe(1);
});

it("asks for a cédula or RUC the profile lacks, says it is saved to the profile, and judges it live", async () => {
  install();
  renderPurchaseRoute(routes, "/checkout");
  const input = await (await billingArea()).findByLabelText("Cédula o RUC");
  expect(input).toHaveAccessibleDescription(/La guardaremos en tu perfil para tus próximas compras\./);
  const user = userEvent.setup();
  await user.type(input, "179");
  expect(input).toHaveAccessibleDescription(/RUC de sociedad: faltan 10 dígitos\./);
  // A company RUC has no check digit to judge (SRI, ADR 0043): only what is missing is counted.
  await user.type(input, "0016918");
  expect(input).toHaveAccessibleDescription(/RUC de sociedad: faltan 3 dígitos\./);
  expect(input).not.toHaveAttribute("aria-invalid");
  await user.clear(input);
  await user.type(input, "177");
  expect(input).toHaveAttribute("aria-invalid", "true");
  await user.clear(input);
  await user.type(input, "17900169190019");
  expect(input).toHaveValue("1790016919001");
  expect(input).toHaveAccessibleDescription(/Máximo 13 dígitos/);
  await user.type(input, "{Backspace}1");
  expect(input).toHaveAccessibleDescription(/RUC de sociedad válido\./);
});

it("explains a cédula different from the profile's and shows the registered one; no order is created", async () => {
  let identity = 0;
  const api = install({ cart: () => json(cartBody()), addresses: [savedAddress],
    identity: () => identity++ === 0 ? noIdentity() : json({ type: "EC_CEDULA", number: "1710034065" }),
    post: () => json({ status: 409, code: "P1106", title: "Identificación distinta a la de tu perfil", detail: "La factura usa la cédula o el RUC registrado en tu perfil." }, 409) });
  renderPurchaseRoute(routes, "/checkout");
  await transfer();
  fireEvent.change(await (await billingArea()).findByLabelText("Cédula o RUC"), { target: { value: "0123456782" } });
  await userEvent.click(screen.getByRole("button", { name: "Hacer pedido" }));
  expect(await screen.findByText("La identificación no coincide con la de tu perfil.")).toBeInTheDocument();
  expect(await (await billingArea()).findByText("1710034065")).toBeVisible();
  expect(api.count("POST", "/api/v1/checkout")).toBe(1);
});

it("shows a registered number that no longer validates as something to fix in Mi perfil", async () => {
  install({ identity: () => json({ type: "EC_CEDULA", number: "0012345674" }) });
  renderPurchaseRoute(routes, "/checkout");
  const alert = await (await billingArea()).findByRole("alert");
  expect(alert).toHaveTextContent("No es válida.");
  expect(within(alert).getByRole("link", { name: "Corrígela en Mi perfil" })).toHaveAttribute("href", "/account");
});
