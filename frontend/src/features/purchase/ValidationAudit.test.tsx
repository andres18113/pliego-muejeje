import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { json, renderPurchaseRoute, savedAddress, stubApi } from "@/test/purchase";
import { RegisterPage } from "@/features/auth/AuthPages";
import { AccountPage } from "@/features/account/AccountPage";
import { AddressForm } from "./AddressForm";

const profile = { customerId: "2", email: "ana@example.com", firstNames: "Ana", lastNames: "Pérez", phone: null, state: "ACTIVE", version: "0" };
const account = [{ path: "/account", element: <AccountPage /> }];
const registration = [{ path: "/register", element: <RegisterPage /> }];
async function fillRegistration(user: ReturnType<typeof userEvent.setup>, names = "Ana") {
  await user.type(screen.getByLabelText("Nombres"), names);
  await user.type(screen.getByLabelText("Apellidos"), "O’Connor-Pérez");
  await user.type(screen.getByLabelText("Correo electrónico"), "ana@example.com");
  await user.type(screen.getByLabelText("Contraseña"), "lecturaSegura123");
}
const fieldProblem = (field: string, message: string) => json({ code: "VALIDATION_ERROR", title: "Datos inválidos", detail: "Revisa los campos indicados.", violations: [{ field, message }] }, 400);

describe("confirmed validation audit regressions", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("rejects digits in registration names with specific feedback and preserves the draft", async () => {
    const api = stubApi({ "POST /api/v1/auth/register": () => json({ userId: "2", customerId: "2", state: "ACTIVE" }, 201) });
    renderPurchaseRoute(registration, "/register", { role: null });
    const user = userEvent.setup(); await fillRegistration(user, "Gat1n");
    await user.click(screen.getByRole("button", { name: "Crear cuenta" }));
    expect(await screen.findByText("Tus nombres solo pueden contener letras, espacios, apóstrofes y guiones.")).toBeInTheDocument();
    expect(screen.getByLabelText("Nombres")).toHaveValue("Gat1n");
    expect(api.count("POST", "/api/v1/auth/register")).toBe(0);
  });

  it("applies the same name rule to a profile edit", async () => {
    const api = stubApi({ "GET /api/v1/me": () => json(profile), "PATCH /api/v1/me": () => new Response(null, { status: 204 }) });
    renderPurchaseRoute(account, "/account");
    const user = userEvent.setup(); await user.click(await screen.findByRole("button", { name: "Editar nombres" }));
    await user.clear(screen.getByLabelText("Nombres")); await user.type(screen.getByLabelText("Nombres"), "Gat1n");
    await user.click(screen.getByRole("button", { name: "Guardar" }));
    expect(await screen.findByText("Tus nombres solo pueden contener letras, espacios, apóstrofes y guiones.")).toBeInTheDocument();
    expect(screen.getByLabelText("Nombres")).toHaveValue("Gat1n");
    expect(api.count("PATCH", "/api/v1/me")).toBe(0);
  });

  it("requires an explicit international prefix in registration instead of accepting an ambiguous national number", async () => {
    const api = stubApi({ "POST /api/v1/auth/register": () => json({ userId: "2", customerId: "2", state: "ACTIVE" }, 201) });
    renderPurchaseRoute(registration, "/register", { role: null });
    const user = userEvent.setup(); await fillRegistration(user);
    await user.click(screen.getByRole("button", { name: "Añadir teléfono (opcional)" }));
    await user.type(screen.getByLabelText(/Teléfono/), "0991234567");
    await user.click(screen.getByRole("button", { name: "Crear cuenta" }));
    expect(await screen.findByText("Incluye el prefijo internacional, por ejemplo +593 99 123 4567.")).toBeInTheDocument();
    expect(screen.getByLabelText(/Teléfono/)).toHaveValue("0991234567");
    expect(api.count("POST", "/api/v1/auth/register")).toBe(0);
  });

  it("does not silently turn a pasted phone extension into extra phone digits", async () => {
    const api = stubApi({ "GET /api/v1/me": () => json(profile), "PATCH /api/v1/me": () => new Response(null, { status: 204 }) });
    renderPurchaseRoute(account, "/account");
    const user = userEvent.setup(); await user.click(await screen.findByRole("button", { name: "Agregar teléfono" }));
    const phone = await screen.findByLabelText("Teléfono");
    await waitFor(() => expect(phone).toBeEnabled());
    await user.click(phone); await user.paste("+593 99 123 4567 ext 5");
    expect(screen.getByLabelText("Teléfono")).toHaveValue("+593 99 123 4567 ext 5");
    await user.click(screen.getByRole("button", { name: "Guardar" }));
    expect(await screen.findByText("Usa solo dígitos, espacios, paréntesis, puntos o guiones; no incluyas letras ni extensiones.")).toBeInTheDocument();
    expect(api.count("PATCH", "/api/v1/me")).toBe(0);
  });

  it("assigns a server password violation to password rather than the email field", async () => {
    stubApi({ "GET /api/v1/me": () => json(profile), "PUT /api/v1/me/email": () => fieldProblem("currentPassword", "Escribe tu contraseña actual para confirmar el cambio.") });
    renderPurchaseRoute(account, "/account");
    const user = userEvent.setup(); await user.click(await screen.findByRole("button", { name: "Editar correo electrónico" }));
    await user.type(screen.getByLabelText("Nuevo correo"), "nueva@example.com");
    await user.type(screen.getByLabelText("Contraseña actual"), "conservar-borrador");
    await user.click(screen.getByRole("button", { name: "Guardar" }));
    const password = screen.getByLabelText("Contraseña actual");
    await waitFor(() => expect(password).toHaveAttribute("aria-invalid", "true"));
    expect(password).toHaveAccessibleDescription("Escribe tu contraseña actual para confirmar el cambio.");
    expect(password).toHaveValue("conservar-borrador");
    expect(screen.getByLabelText("Nuevo correo")).not.toHaveAttribute("aria-invalid", "true");
  });

  it("routes a server city violation to the address control without losing other fields", async () => {
    const api = stubApi({ "PUT /api/v1/me/addresses/15": () => fieldProblem("city", "Escribe una ciudad de hasta 100 caracteres.") });
    renderPurchaseRoute([{ path: "/address", element: <AddressForm address={savedAddress} firstAddress={false}
      onSaved={async () => undefined} onUncertain={async () => undefined} onSessionExpired={() => undefined} /> }], "/address");
    const user = userEvent.setup(); await waitFor(() => expect(screen.getByRole("button", { name: "Guardar dirección" })).toBeEnabled());
    await user.click(screen.getByRole("button", { name: "Guardar dirección" }));
    const city = screen.getByLabelText("Ciudad");
    await waitFor(() => expect(city).toHaveAttribute("aria-invalid", "true"));
    expect(city).toHaveAccessibleDescription("Escribe una ciudad de hasta 100 caracteres.");
    expect(city).toHaveValue("Quito"); expect(screen.getByLabelText("Dirección", { exact: true })).toHaveValue(savedAddress.line1);
    expect(api.count("PUT", "/api/v1/me/addresses/15")).toBe(1);
  });

  it("offers recipient recovery when the server rejects an automatic recipient", async () => {
    stubApi({ "GET /api/v1/me": () => json({ ...profile, firstNames: "A".repeat(120), lastNames: "B".repeat(120) }),
      "POST /api/v1/me/addresses": () => fieldProblem("recipient", "El destinatario no puede superar 241 caracteres.") });
    renderPurchaseRoute([{ path: "/address", element: <AddressForm firstAddress
      onSaved={async () => undefined} onUncertain={async () => undefined} onSessionExpired={() => undefined} /> }], "/address");
    const user = userEvent.setup();
    await user.type(screen.getByLabelText("Dirección", { exact: true }), savedAddress.line1);
    await user.type(screen.getByLabelText("Ciudad"), "Quito"); await user.type(screen.getByLabelText("Provincia"), "Pichincha");
    await user.type(screen.getByLabelText("Teléfono de contacto"), "0991234567");
    await waitFor(() => expect(screen.getByRole("button", { name: "Guardar dirección" })).toBeEnabled());
    await user.click(screen.getByRole("button", { name: "Guardar dirección" }));
    const recipient = await screen.findByLabelText("Quién recibe el pedido");
    expect(recipient).toHaveValue(`${"A".repeat(120)} ${"B".repeat(120)}`);
    expect(recipient).toHaveAccessibleDescription("El destinatario no puede superar 241 caracteres.");
    await waitFor(() => expect(recipient).toHaveFocus());
  });
});
