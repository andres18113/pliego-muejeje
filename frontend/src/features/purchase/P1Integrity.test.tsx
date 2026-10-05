import { act, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cartBody, json, problem, renderPurchaseRoute, savedAddress, stubApi } from "@/test/purchase";
import { CheckoutPage } from "./CheckoutPage";
import { AccountPage } from "@/features/account/AccountPage";
import { AddressBookPage } from "@/features/account/AddressBook";

const routes = [
  { path: "/checkout", element: <CheckoutPage /> },
  { path: "/account", element: <AccountPage /> },
  { path: "/account/addresses", element: <AddressBookPage /> },
  { path: "/orders/:orderId", element: <h1>Pedido resuelto</h1> },
];
const profile = { customerId: "2", email: "ana@example.com", firstNames: "Ana", lastNames: "Pérez", phone: null, state: "ACTIVE", version: "0" };

describe("P1 integrity regressions", () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => vi.unstubAllGlobals());

  it("keeps a lost checkout unresolved when orders are still empty and blocks another purchase", async () => {
    const api = stubApi({
      "GET /api/v1/cart": () => json(cartBody()),
      "GET /api/v1/me/addresses": () => json([savedAddress]),
      "GET /api/v1/orders": () => json({ items: [], page: 0, pageSize: 5, totalCount: "0" }),
      "POST /api/v1/checkout": () => { throw new TypeError("Lost response while commit is pending"); },
    });
    const user = userEvent.setup();
    renderPurchaseRoute(routes, "/checkout");
    await screen.findByText(/Av\. Principal 123/);
    await user.click(screen.getByRole("button", { name: /Transferencia/ }));
    await user.click(screen.getByRole("button", { name: "Hacer pedido" }));
    await user.click(await screen.findByRole("button", { name: /Consultar mis pedidos|Consultar resultado/ }));
    await waitFor(() => expect(api.calls.filter((call) => call.method === "GET" || call.path.includes("resolve")).length).toBeGreaterThan(3));
    expect(screen.queryByRole("heading", { name: "No se creó ningún pedido." })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Hacer pedido" })).toHaveAttribute("aria-disabled", "true");
    await user.click(screen.getByRole("button", { name: "Hacer pedido" }));
    expect(api.calls.filter((call) => call.method === "POST" && call.path === "/api/v1/checkout")).toHaveLength(1);
  });

  it("resolves a lost address response before allowing a second create", async () => {
    const api = stubApi({
      "GET /api/v1/me/addresses": () => json([]),
      "POST /api/v1/me/addresses": () => { throw new TypeError("Lost successful create response"); },
    });
    const user = userEvent.setup();
    renderPurchaseRoute(routes, "/account/addresses");
    await user.click(await screen.findByRole("button", { name: "Agregar dirección" }));
    await screen.findByRole("dialog", { name: "Nueva dirección" });
    await user.type(screen.getByLabelText("Dirección", { exact: true }), "Av. Principal 123");
    await user.type(screen.getByLabelText("Ciudad"), "Quito");
    await user.type(screen.getByLabelText("Provincia"), "Pichincha");
    await user.type(screen.getByLabelText("Teléfono de contacto"), "0991234567");
    await waitFor(() => expect(screen.getByRole("button", { name: "Guardar dirección" })).toBeEnabled());
    await user.click(screen.getByRole("button", { name: "Guardar dirección" }));
    await screen.findByRole("alert");
    await user.click(screen.getByRole("button", { name: /Guardar dirección|Consultar resultado/ }));
    expect(api.calls.filter((call) => call.method === "POST" && call.path === "/api/v1/me/addresses")).toHaveLength(1);
  });

  it("saves only the edited profile field with the version originally read", async () => {
    const api = stubApi({
      "GET /api/v1/me": [() => json(profile), () => json({ ...profile, firstNames: "Ana María", lastNames: "Andrade", version: "2" })],
      "PUT /api/v1/me": () => new Response(null, { status: 204 }),
      "PATCH /api/v1/me": () => new Response(null, { status: 204 }),
    });
    const user = userEvent.setup();
    renderPurchaseRoute(routes, "/account");
    await user.click(await screen.findByRole("button", { name: "Editar nombres" }));
    await user.clear(screen.getByLabelText("Nombres"));
    await user.type(screen.getByLabelText("Nombres"), "Ana María");
    await user.click(screen.getByRole("button", { name: "Guardar" }));
    await screen.findByText("Guardamos tus nombres.");
    expect(api.calls.find((call) => call.method === "PUT" || call.method === "PATCH")?.body).toEqual({ field: "firstNames", value: "Ana María", expectedVersion: "0" });
  });

  it("asks for card data only inside the card dialog, beside a real checkout action", async () => {
    stubApi({ "GET /api/v1/cart": () => json(cartBody()), "GET /api/v1/me/addresses": () => json([savedAddress]) });
    const user = userEvent.setup();
    renderPurchaseRoute(routes, "/checkout");
    await screen.findByText(/Av\. Principal 123/);
    expect(screen.getByRole("button", { name: "Hacer pedido" })).toBeInTheDocument();
    expect(screen.queryByLabelText("Número de tarjeta")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /Tarjeta de crédito/ }));
    const dialog = await screen.findByRole("dialog", { name: "Tarjeta de crédito o débito" });
    expect(within(dialog).getByLabelText("Número de tarjeta")).toBeInTheDocument();
  });

  it("recovers a pending checkout after remount even when the cart is now empty", async () => {
    const key = "550e8400-e29b-41d4-a716-446655440000";
    localStorage.setItem("pliego:pending:checkout:2", key);
    const api = stubApi({
      "GET /api/v1/cart": () => json(cartBody([])),
      "GET /api/v1/me/addresses": () => json([savedAddress]),
      "POST /api/v1/checkout/attempts/*/resolve": () => json({ state: "CREATED", order: { orderId: "700", orderState: "CONFIRMED", paymentState: "APPROVED", total: "18.50", paymentReference: "SIM-1" } }),
    });
    const user = userEvent.setup();
    renderPurchaseRoute(routes, "/checkout");
    await user.click(await screen.findByRole("button", { name: "Consultar resultado" }));
    expect(await screen.findByRole("heading", { name: "Pedido resuelto" })).toBeInTheDocument();
    expect(api.calls.some((call) => call.path === `/api/v1/checkout/attempts/${key}/resolve`)).toBe(true);
    expect(api.calls.some((call) => call.path === "/api/v1/checkout" && call.method === "POST")).toBe(false);
    expect(localStorage.getItem("pliego:pending:checkout:2")).toBeNull();
  });

  it("recovers a pending address without resubmitting fields and retains the key while resolution is pending", async () => {
    const key = "550e8400-e29b-41d4-a716-446655440000";
    localStorage.setItem("pliego:pending:address:2", key);
    const api = stubApi({
      "GET /api/v1/me/addresses": [() => json([]), () => json([savedAddress])],
      "POST /api/v1/me/addresses/attempts/*/resolve": [() => json({ state: "PENDING", addressId: null }), () => json({ state: "CREATED", addressId: "15" })],
    });
    const user = userEvent.setup();
    renderPurchaseRoute(routes, "/account/addresses");
    await user.click(await screen.findByRole("button", { name: "Agregar dirección" }));
    await screen.findByRole("dialog", { name: "Nueva dirección" });
    expect(screen.getByLabelText("Dirección", { exact: true })).toBeDisabled();
    await user.click(screen.getByRole("button", { name: "Consultar resultado" }));
    await screen.findByText(/La dirección sigue pendiente/);
    expect(localStorage.getItem("pliego:pending:address:2")).toBe(key);
    await user.click(screen.getByRole("button", { name: "Consultar resultado" }));
    await screen.findByText(/Guardamos la dirección/);
    expect(api.calls.some((call) => call.path === "/api/v1/me/addresses" && call.method === "POST")).toBe(false);
    expect(localStorage.getItem("pliego:pending:address:2")).toBeNull();
  });

  it("retains a draft and the original expected version after a conflict, requiring deliberate review", async () => {
    const api = stubApi({
      "GET /api/v1/me": [() => json(profile), () => json({ ...profile, firstNames: "Ana concurrente", version: "1" })],
      "PATCH /api/v1/me": () => problem(409, "P1104", "Tu perfil cambió", "Revisa los datos actuales."),
    });
    const user = userEvent.setup();
    renderPurchaseRoute(routes, "/account");
    await user.click(await screen.findByRole("button", { name: "Editar nombres" }));
    const input = screen.getByLabelText("Nombres");
    await user.clear(input); await user.type(input, "Mi borrador");
    await user.click(screen.getByRole("button", { name: "Guardar" }));
    await screen.findByText(/Tu perfil cambió mientras editabas/);
    expect(input).toHaveValue("Mi borrador");
    await user.click(screen.getByRole("button", { name: "Guardar" }));
    const patches = api.calls.filter((call) => call.method === "PATCH");
    expect(patches.map((call) => call.body)).toEqual([
      { field: "firstNames", value: "Mi borrador", expectedVersion: "0" },
      { field: "firstNames", value: "Mi borrador", expectedVersion: "0" },
    ]);
    await user.click(screen.getByRole("button", { name: "Cancelar" }));
    await user.click(screen.getByRole("button", { name: "Editar nombres" }));
    expect(screen.getByLabelText("Nombres")).toHaveValue("Ana concurrente");
  });

  it("confirms a lost profile response from the edited field without comparing unrelated fields", async () => {
    stubApi({
      "GET /api/v1/me": [() => json(profile), () => json({ ...profile, firstNames: "Ana María", lastNames: "Andrade", version: "2" })],
      "PATCH /api/v1/me": () => { throw new TypeError("Lost successful response"); },
    });
    const user = userEvent.setup();
    renderPurchaseRoute(routes, "/account");
    await user.click(await screen.findByRole("button", { name: "Editar nombres" }));
    await user.clear(screen.getByLabelText("Nombres")); await user.type(screen.getByLabelText("Nombres"), "Ana María");
    await user.click(screen.getByRole("button", { name: "Guardar" }));
    expect(await screen.findByText("Guardamos tus nombres.")).toBeInTheDocument();
    expect(screen.getByText("Andrade")).toBeInTheDocument();
  });

  it("keeps the resolver bound to its original attempt when another tab changes recovery storage", async () => {
    const original = "550e8400-e29b-41d4-a716-446655440000";
    const other = "550e8400-e29b-41d4-a716-446655440001";
    localStorage.setItem("pliego:pending:checkout:2", original);
    let complete!: (response: Response) => void;
    const api = stubApi({
      "GET /api/v1/cart": () => json(cartBody()),
      "GET /api/v1/me/addresses": () => json([savedAddress]),
      "POST /api/v1/checkout/attempts/*/resolve": [
        () => new Promise<Response>((resolve) => { complete = resolve; }),
        () => json({ state: "PENDING", order: null }),
      ],
    });
    const user = userEvent.setup();
    renderPurchaseRoute(routes, "/checkout");
    await user.click(await screen.findByRole("button", { name: "Consultar resultado" }));
    await waitFor(() => expect(complete).toBeTypeOf("function"));
    await act(async () => {
      localStorage.setItem("pliego:pending:checkout:2", other);
      window.dispatchEvent(new StorageEvent("storage"));
      complete(json({ state: "PENDING", order: null }));
    });
    await user.click(screen.getByRole("button", { name: "Consultar resultado" }));
    const calls = api.calls.filter((call) => call.path.includes("/resolve"));
    expect(calls.map((call) => call.path)).toEqual([
      `/api/v1/checkout/attempts/${original}/resolve`,
      `/api/v1/checkout/attempts/${original}/resolve`,
    ]);
  });

  it("finishes checkout preflight before adopting another tab's pending resolution", async () => {
    let finishPreflight!: (response: Response) => void;
    const api = stubApi({
      "GET /api/v1/cart": [() => json(cartBody()), () => new Promise<Response>((resolve) => { finishPreflight = resolve; })],
      "GET /api/v1/me/addresses": () => json([savedAddress]),
    });
    const user = userEvent.setup();
    renderPurchaseRoute(routes, "/checkout");
    await screen.findByText(/Av\. Principal 123/);
    await user.click(screen.getByRole("button", { name: /Transferencia/ }));
    await user.click(screen.getByRole("button", { name: "Hacer pedido" }));
    await waitFor(() => expect(finishPreflight).toBeTypeOf("function"));
    await act(async () => {
      localStorage.setItem("pliego:pending:checkout:2", "550e8400-e29b-41d4-a716-446655440000");
      window.dispatchEvent(new StorageEvent("storage"));
    });
    expect(screen.queryByRole("button", { name: "Consultar resultado" })).not.toBeInTheDocument();
    await act(async () => finishPreflight(json(cartBody())));
    expect(await screen.findByRole("button", { name: "Consultar resultado" })).toBeInTheDocument();
    expect(api.calls.some((call) => call.path === "/api/v1/checkout" && call.method === "POST")).toBe(false);
  });
});
