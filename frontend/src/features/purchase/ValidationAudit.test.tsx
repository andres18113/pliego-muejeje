import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { json, renderPurchaseRoute, savedAddress, stubApi, choosePlace, problem } from "@/test/purchase";
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

  it("rejects digits in registration names immediately without submitting", async () => {
    const api = stubApi({});
    renderPurchaseRoute(registration, "/register", { role: null });
    const user = userEvent.setup();
    await user.type(screen.getByLabelText("Nombres"), "Gatín1");
    expect(screen.getByLabelText("Nombres")).toHaveValue("Gatín");
    expect(screen.getByLabelText("Nombres")).toHaveAccessibleDescription(/letras|números/);
    expect(api.count("POST", "/api/v1/auth/register")).toBe(0);
  });

  it("rejects profile name digits immediately with the same name rule", async () => {
    const api = stubApi({ "GET /api/v1/me": () => json(profile) });
    renderPurchaseRoute(account, "/account");
    const user = userEvent.setup(); await user.click(await screen.findByRole("button", { name: "Editar nombres" }));
    await user.clear(screen.getByLabelText("Nombres")); await user.type(screen.getByLabelText("Nombres"), "Gatín1");
    expect(screen.getByLabelText("Nombres")).toHaveValue("Gatín");
    expect(screen.getByLabelText("Nombres")).toHaveAccessibleDescription(/letras|números/);
    expect(api.count("PATCH", "/api/v1/me")).toBe(0);
  });

  it("uses the fixed Ecuador prefix and normalizes national registration input", async () => {
    const api = stubApi({ "POST /api/v1/auth/register": () => json({ userId: "2", customerId: "2", state: "ACTIVE" }, 201) });
    renderPurchaseRoute(registration, "/register", { role: null });
    const user = userEvent.setup(); await fillRegistration(user);
    await user.click(screen.getByRole("button", { name: "Añadir teléfono (opcional)" }));
    await user.type(screen.getByLabelText(/Teléfono/), "991234567");
    expect(screen.getByLabelText(/Teléfono/)).toHaveValue("991234567");
    await user.click(screen.getByRole("button", { name: "Crear cuenta" }));
    await waitFor(() => expect(api.calls.find(call => call.method === "POST")?.body).toMatchObject({ phone: "+593991234567" }));
  });

  it("rejects a pasted extension immediately instead of changing it into phone digits", async () => {
    const api = stubApi({ "GET /api/v1/me": () => json(profile) });
    renderPurchaseRoute(account, "/account");
    const user = userEvent.setup(); await user.click(await screen.findByRole("button", { name: "Agregar teléfono" }));
    const phone = await screen.findByLabelText("Teléfono");
    await waitFor(() => expect(phone).toBeEnabled());
    await user.click(phone); await user.paste("+593 99 123 4567 ext 5");
    expect(phone).toHaveValue("");
    expect(phone).toHaveAccessibleDescription(/solo números/);
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
    const api = stubApi({ "PUT /api/v1/me/addresses/15": () => problem(400, "P5014", "Ciudad no válida", "La ciudad no pertenece a la provincia seleccionada.") });
    renderPurchaseRoute([{ path: "/address", element: <AddressForm address={savedAddress} firstAddress={false}
      onSaved={async () => undefined} onUncertain={async () => undefined} onSessionExpired={() => undefined} /> }], "/address");
    const user = userEvent.setup(); await waitFor(() => expect(screen.getByRole("button", { name: "Guardar dirección" })).toBeEnabled());
    await user.click(screen.getByRole("button", { name: "Guardar dirección" }));
    const city = screen.getByRole("combobox", { name: "Ciudad" });
    await waitFor(() => expect(city).toHaveAttribute("aria-invalid", "true"));
    expect(city).toHaveAccessibleDescription("La ciudad no pertenece a la provincia seleccionada.");
    await waitFor(() => expect(city).toHaveFocus());
    expect(city).toHaveTextContent("Quito"); expect(screen.getByLabelText("Dirección", { exact: true })).toHaveValue(savedAddress.line1);
    expect(api.count("PUT", "/api/v1/me/addresses/15")).toBe(1);
  });

  it.each(["after commit", "before commit"] as const)("offers recipient recovery when the frame runs %s", async (frameOrder) => {
    stubApi({ "GET /api/v1/me": () => json({ ...profile, firstNames: "A".repeat(120), lastNames: "B".repeat(120) }),
      "POST /api/v1/me/addresses": () => fieldProblem("recipient", "El destinatario no puede superar 241 caracteres.") });
    renderPurchaseRoute([{ path: "/address", element: <AddressForm firstAddress
      onSaved={async () => undefined} onUncertain={async () => undefined} onSessionExpired={() => undefined} /> }], "/address");
    const user = userEvent.setup();
    await user.type(screen.getByLabelText("Dirección", { exact: true }), savedAddress.line1);
    await choosePlace(document.querySelector<HTMLElement>(".address-form")!);
    await user.type(screen.getByLabelText("Teléfono de contacto"), "0991234567");
    await waitFor(() => expect(screen.getByRole("button", { name: "Guardar dirección" })).toBeEnabled());
    if (frameOrder === "before commit") {
      // A rendering frame can run before React commits the newly revealed recipient.
      vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
        callback(0);
        return 0;
      });
    }
    await user.click(screen.getByRole("button", { name: "Guardar dirección" }));
    const recipient = await screen.findByLabelText("Quién recibe el pedido");
    expect(recipient).toHaveValue(`${"A".repeat(120)} ${"B".repeat(120)}`);
    expect(recipient).toHaveAccessibleDescription("El destinatario no puede superar 241 caracteres.");
    await waitFor(() => expect(recipient).toHaveFocus());
    await user.keyboard("{End}"); await user.type(recipient, "Z");
    expect(recipient).toHaveValue(`${"A".repeat(120)} ${"B".repeat(120)}`);
    expect(recipient).toHaveAccessibleDescription(/241/);
    await user.clear(recipient); await user.type(recipient, "Ana1");
    expect(recipient).toHaveValue("Ana");
    expect(recipient).toHaveAccessibleDescription(/letras|números/);
  });
});
