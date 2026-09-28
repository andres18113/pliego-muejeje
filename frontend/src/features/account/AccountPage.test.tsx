import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { json, renderPurchaseRoute, savedAddress, stubApi } from "@/test/purchase";
import { AccountPage } from "./AccountPage";
import { AddressBookPage } from "./AddressBook";

const routes = [
  { path: "/account", element: <AccountPage /> },
  { path: "/account/addresses", element: <AddressBookPage /> },
  { path: "/orders", element: <h1>Mis pedidos</h1> },
];
const profile = { customerId: "2", email: "ana@example.com", firstNames: "Ana", lastNames: "Pérez", phone: null, state: "ACTIVE" };

describe("customer account", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("keeps profile private and links to distinct account surfaces", async () => {
    const api = stubApi({});
    renderPurchaseRoute(routes, "/account", { role: null });
    expect(await screen.findByRole("heading", { name: "Inicia sesión para ver tu cuenta." })).toHaveFocus();
    expect(api.count("GET", "/api/v1/me")).toBe(0);
  });

  it("shows profile without loading addresses and gives account navigation", async () => {
    const api = stubApi({ "GET /api/v1/me": () => json(profile) });
    renderPurchaseRoute(routes, "/account");
    expect(await screen.findByRole("heading", { name: "Mi cuenta" })).toBeInTheDocument();
    expect(await screen.findByLabelText("Nombres")).toHaveValue("Ana");
    expect(within(screen.getByRole("region", { name: "Perfil y datos personales" })).getByText(profile.email)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Direcciones" })).toHaveAttribute("href", "/account/addresses");
    expect(screen.getByRole("link", { name: "Mis pedidos" })).toHaveAttribute("href", "/orders");
    expect(api.count("GET", "/api/v1/me/addresses")).toBe(0);
  });

  it("updates profile names through the existing API", async () => {
    const api = stubApi({
      "GET /api/v1/me": [() => json(profile), () => json({ ...profile, firstNames: "Ana María" })],
      "PUT /api/v1/me": () => new Response(null, { status: 204 }),
    });
    renderPurchaseRoute(routes, "/account");
    const user = userEvent.setup();
    const names = await screen.findByLabelText("Nombres");
    await user.clear(names);
    await user.type(names, "Ana María");
    await user.click(screen.getByRole("button", { name: "Guardar datos personales" }));
    await waitFor(() => expect(api.calls.find((call) => call.method === "PUT")?.body).toMatchObject({ firstNames: "Ana María" }));
    expect(await screen.findByText("Guardamos tus datos personales.")).toBeInTheDocument();
  });

  it("validates and normalizes an international profile phone", async () => {
    const api = stubApi({
      "GET /api/v1/me": [() => json(profile), () => json({ ...profile, phone: "+593991234567" })],
      "PUT /api/v1/me": () => new Response(null, { status: 204 }),
    });
    renderPurchaseRoute(routes, "/account");
    const user = userEvent.setup();
    const phone = await screen.findByLabelText("Teléfono (opcional)");
    await waitFor(() => expect(phone).toBeEnabled());
    await user.type(phone, "123");
    await user.click(screen.getByRole("button", { name: "Guardar datos personales" }));
    expect(await screen.findByText("Escribe un número válido para el país elegido.")).toBeInTheDocument();
    expect(api.count("PUT", "/api/v1/me")).toBe(0);
    await user.clear(phone);
    await user.type(phone, "0991234567");
    await user.click(screen.getByRole("button", { name: "Guardar datos personales" }));
    await waitFor(() => expect(api.calls.find((call) => call.method === "PUT")?.body).toMatchObject({ phone: "+593991234567" }));
  });

  it("shows each address as an entity with its human country name", async () => {
    stubApi({ "GET /api/v1/me/addresses": () => json([savedAddress]) });
    renderPurchaseRoute(routes, "/account/addresses");
    const card = await screen.findByRole("listitem");
    expect(within(card).getByRole("heading", { name: /Casa/ })).toBeInTheDocument();
    expect(card).toHaveTextContent("Ecuador");
    expect(card).toHaveTextContent("Principal");
    expect(card).not.toHaveTextContent(/, EC/);
    expect(screen.queryByLabelText("Quién recibe")).not.toBeInTheDocument();
  });

  it("creates a principal address with normalized phone and profile recipient", async () => {
    const api = stubApi({
      "GET /api/v1/me/addresses": [() => json([]), () => json([savedAddress])],
      "POST /api/v1/me/addresses": () => json({ addressId: "15" }, 201),
    });
    renderPurchaseRoute(routes, "/account/addresses");
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Agregar dirección" }));
    await user.type(screen.getByLabelText("Dirección", { exact: true }), "Av. Principal 123");
    await user.type(screen.getByLabelText("Ciudad"), "Quito");
    await user.type(screen.getByLabelText("Provincia"), "Pichincha");
    await user.type(screen.getByLabelText("Teléfono de contacto"), "0991234567");
    await waitFor(() => expect(screen.getByRole("button", { name: "Guardar dirección" })).toBeEnabled());
    await user.click(screen.getByRole("button", { name: "Guardar dirección" }));
    await waitFor(() => expect(api.calls.find((call) => call.method === "POST")?.body).toMatchObject({
      alias: "Casa", recipient: "Ana Pérez", countryCode: "EC", phone: "+593991234567", makePrimary: true,
    }));
  });

  it("searches backend countries and stores only the ISO code", async () => {
    const api = stubApi({
      "GET /api/v1/me/addresses": () => json([]),
      "POST /api/v1/me/addresses": () => json({ addressId: "16" }, 201),
    });
    renderPurchaseRoute(routes, "/account/addresses");
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Agregar dirección" }));
    await user.type(screen.getByLabelText("Dirección", { exact: true }), "Calle 10");
    await user.type(screen.getByLabelText("Ciudad"), "Bogotá");
    await user.type(screen.getByLabelText("Provincia"), "Cundinamarca");
    await user.click(screen.getByRole("combobox", { name: "País de entrega" }));
    const countrySearch = await screen.findByRole("combobox", { name: "Buscar país de entrega" });
    await user.type(countrySearch, "Colom");
    await user.keyboard("{ArrowDown}{Enter}");
    expect(screen.getByRole("combobox", { name: "País de entrega" })).toHaveTextContent("Colombia");
    await user.type(screen.getByLabelText("Teléfono de contacto"), "3001234567");
    await user.click(screen.getByRole("button", { name: "Guardar dirección" }));
    await waitFor(() => expect(api.calls.find((call) => call.method === "POST")?.body).toMatchObject({ countryCode: "CO", phone: "+573001234567" }));
  });

  it("requires confirmation before deleting an address", async () => {
    const api = stubApi({
      "GET /api/v1/me/addresses": [() => json([savedAddress]), () => json([])],
      "DELETE /api/v1/me/addresses/15": () => new Response(null, { status: 204 }),
    });
    renderPurchaseRoute(routes, "/account/addresses");
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Eliminar Casa" }));
    expect(api.count("DELETE", "/api/v1/me/addresses/15")).toBe(0);
    await user.click(screen.getByRole("button", { name: "Confirmar eliminación" }));
    expect(await screen.findByRole("heading", { name: "Aún no tienes direcciones guardadas." })).toBeInTheDocument();
  });
});
