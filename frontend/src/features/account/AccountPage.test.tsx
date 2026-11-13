import { act, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { json, problem, renderPurchaseRoute, savedAddress, stubApi as stubPurchaseApi, choosePlace } from "@/test/purchase";
import { AccountPage } from "./AccountPage";
import { AddressBookPage } from "./AddressBook";
import { useSession } from "@/app/session";

const routes = [
  { path: "/account", element: <AccountPage /> },
  { path: "/account/addresses", element: <AddressBookPage /> },
  { path: "/orders", element: <h1>Mis pedidos</h1> },
];
const stubApi = (routes: Parameters<typeof stubPurchaseApi>[0]) => stubPurchaseApi({"GET /api/v1/me/billing-identity": () => new Response(null, {status:204}), ...routes});

const profile = { customerId: "2", email: "ana@example.com", firstNames: "Ana", lastNames: "Pérez", phone: null, state: "ACTIVE", version: "0", emailVerified: true };

describe("customer account", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("keeps profile private and links to distinct account surfaces", async () => {
    const api = stubApi({});
    renderPurchaseRoute(routes, "/account", { role: null });
    expect(await screen.findByRole("heading", { name: "Inicia sesión para ver tu cuenta." })).toHaveFocus();
    expect(api.calls.filter(call => call.method === "GET" && call.path === "/api/v1/me").length).toBe(0);
  });

  it("shows a read-only profile without loading addresses and gives account navigation", async () => {
    const api = stubApi({ "GET /api/v1/me": () => json(profile) });
    renderPurchaseRoute(routes, "/account");
    expect(await screen.findByRole("heading", { level: 1, name: "Mi perfil" })).toBeInTheDocument();
    const region = await screen.findByRole("region", { name: "Perfil y datos personales" });
    expect(within(region).getByRole("heading", { level: 2, name: "Ana Pérez" })).toBeInTheDocument();
    expect(within(region).getByText(profile.email)).toBeInTheDocument();
    const phoneRow = within(region).getByText("Teléfono").closest("li")!;
    // An optional empty value is plain muted text: nothing is wrong, so it earns no chip.
    expect(within(phoneRow).getByText("Sin registrar")).not.toHaveAttribute("data-tone");
    expect(within(phoneRow).getByText("Opcional")).toBeInTheDocument();
    expect(within(region).queryByText("En uso")).not.toBeInTheDocument();
    // Nothing is editable until the reader chooses a field.
    expect(within(region).queryByRole("textbox")).not.toBeInTheDocument();
    expect(within(region).getByRole("button", { name: "Editar nombres" })).toBeInTheDocument();
    expect(within(region).getByRole("button", { name: "Editar correo electrónico" })).toBeInTheDocument();
    expect(within(region).getByRole("button", { name: "Agregar teléfono" })).toBeInTheDocument();
    // The header's account menu moves between Account pages; the page adds no second navigation.
    expect(screen.queryByRole("navigation", { name: "Secciones de mi cuenta" })).not.toBeInTheDocument();
    expect(api.count("GET", "/api/v1/me/addresses")).toBe(0);
  });

  it.each([true, undefined, null])("hides verification help unless the current email is explicitly unverified (%s)", async (emailVerified) => {
    stubApi({ "GET /api/v1/me": () => json({ ...profile, emailVerified }) });
    renderPurchaseRoute(routes, "/account");
    await screen.findByRole("region", { name: "Perfil y datos personales" });
    expect(screen.queryByRole("link", { name: "Reenviar verificación de correo" })).not.toBeInTheDocument();
  });

  it.each([undefined, null, { status: "OK", since: null }])("states nothing about delivery while the address accepts mail (%o)", async (emailDelivery) => {
    stubApi({ "GET /api/v1/me": () => json({ ...profile, emailDelivery }) });
    renderPurchaseRoute(routes, "/account");
    await screen.findByRole("region", { name: "Perfil y datos personales" });
    expect(screen.queryByText("No recibe correos")).not.toBeInTheDocument();
  });

  it("says under the stored address that it stopped accepting mail, and keeps Editar as the fix", async () => {
    stubApi({ "GET /api/v1/me": () => json({ ...profile, emailDelivery: { status: "UNDELIVERABLE", since: "2026-11-01T15:33:37Z" } }) });
    renderPurchaseRoute(routes, "/account");
    const region = await screen.findByRole("region", { name: "Perfil y datos personales" });
    expect(within(region).getByText(profile.email)).toBeInTheDocument();
    expect(within(region).getByText("No recibe correos")).toHaveAttribute("data-tone", "required");
    expect(within(region).getByText("No pudimos entregarte mensajes. Corrígela para recibir los avisos de tus pedidos.")).toBeInTheDocument();
    expect(within(region).getByRole("button", { name: "Editar correo electrónico" })).toBeEnabled();
  });

  it("resends or cancels a pending email change from its own panel in the Correo row", async () => {
    const pendingEmail = { address: "nueva@example.com", expiresAt: "2026-11-02T15:00:00Z", delivery: "OK" };
    const api = stubApi({
      "GET /api/v1/me": [() => json({ ...profile, pendingEmail }), () => json({ ...profile, pendingEmail }), () => json(profile)],
      "POST /api/v1/me/email-change/resend": [() => new Response(null, { status: 202 }), () => problem(429, "EMAIL_CHANGE_RATE_LIMITED", "Demasiados intentos", "Espera unos minutos antes de pedir otro enlace.")],
      "DELETE /api/v1/me/email-change": () => new Response(null, { status: 204 }),
    });
    renderPurchaseRoute(routes, "/account");
    const user = userEvent.setup();
    const region = await screen.findByRole("region", { name: "Perfil y datos personales" });
    const emailRow = within(region).getByText("Correo electrónico").closest("li")!;
    // The address in use and the requested one are told apart: "En uso" on the value, the new one inside the change.
    expect(within(emailRow).getByText("En uso")).toBeInTheDocument();
    const change = within(emailRow).getByRole("group", { name: "Cambio de correo" });
    expect(within(change).getByText("Nuevo correo")).toBeInTheDocument();
    expect(within(change).getByText("nueva@example.com")).toBeInTheDocument();
    expect(within(change).getByText("Por confirmar")).toHaveAttribute("data-tone", "pending");
    expect(within(change).queryByText("ana@example.com")).not.toBeInTheDocument();
    await user.click(within(change).getByRole("button", { name: "Reenviar enlace" }));
    expect(await within(change).findByText("Te enviamos otro enlace. Si no lo ves en unos minutos, revisa la carpeta de spam.")).toHaveAttribute("role", "status");
    await user.click(within(change).getByRole("button", { name: "Reenviar enlace" }));
    expect(await within(change).findByText("Demasiados intentos. Espera unos minutos antes de pedir otro enlace.")).toHaveAttribute("role", "alert");
    await user.click(within(change).getByRole("button", { name: "Cancelar cambio" }));
    expect(await within(emailRow).findByText("Cancelamos el cambio. Sigues usando ana@example.com.")).toBeInTheDocument();
    expect(api.count("DELETE", "/api/v1/me/email-change")).toBe(1);
    expect(within(region).queryByRole("group", { name: "Cambio de correo" })).not.toBeInTheDocument();
    expect(within(region).queryByText("En uso")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Reenviar enlace" })).not.toBeInTheDocument();
  });

  it("says when a requested address could not receive its link, and offers only to correct or cancel it", async () => {
    stubApi({ "GET /api/v1/me": () => json({ ...profile, pendingEmail: { address: "nueva@gmial.com", expiresAt: "2026-11-02T15:00:00Z", delivery: "UNDELIVERABLE" } }) });
    renderPurchaseRoute(routes, "/account");
    const region = await screen.findByRole("region", { name: "Perfil y datos personales" });
    const change = within(region).getByRole("group", { name: "Cambio de correo" });
    expect(within(change).getByText("No recibe correos")).toHaveAttribute("data-tone", "required");
    expect(within(change).getByText("nueva@gmial.com")).toBeInTheDocument();
    expect(within(region).getByText("ana@example.com")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Reenviar enlace" })).not.toBeInTheDocument();
    expect(within(change).getByRole("button", { name: "Cancelar cambio" })).toBeInTheDocument();
    expect(within(region).getByRole("button", { name: "Editar correo electrónico" })).toBeEnabled();
  });

  it("keeps verification help for an explicitly unverified current email", async () => {
    stubApi({ "GET /api/v1/me": () => json({ ...profile, emailVerified: false }) });
    const { router } = renderPurchaseRoute([...routes, { path: "/reenviar-verificacion", element: <h1>Reenviar verificación</h1> }], "/account");
    const link = await screen.findByRole("link", { name: "Reenviar verificación de correo" });
    // It belongs to the Correo row, beside the address it verifies; nothing about the account sits under the sheet.
    expect(link.closest("li")).toHaveTextContent("Correo electrónico");
    expect(within(link.closest("li")!).getByText("Sin verificar")).toHaveAttribute("data-tone", "required");
    await userEvent.click(link);
    expect(router.state.location.pathname).toBe("/reenviar-verificacion");
    expect(router.state.location.state).toEqual({ email: profile.email });
  });

  it("rejects invalid name characters immediately and validates incomplete phones on blur", async () => {
    const api = stubApi({ "GET /api/v1/me": () => json(profile) });
    renderPurchaseRoute(routes, "/account");
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Editar nombres" }));
    const names = screen.getByLabelText("Nombres");
    await user.clear(names); await user.type(names, "Ana7");
    expect(names).toHaveValue("Ana");
    expect(names).toHaveAccessibleDescription(/letras|números/);
    await user.click(screen.getByRole("button", { name: "Cancelar" }));
    await user.click(screen.getByRole("button", { name: "Agregar teléfono" }));
    const phone = screen.getByLabelText("Teléfono");
    await waitFor(() => expect(phone).toBeEnabled());
    await user.type(phone, "99");
    expect(phone).not.toHaveAttribute("aria-invalid", "true");
    await user.tab();
    expect(phone).toHaveAttribute("aria-invalid", "true");
    expect(phone).toHaveAccessibleDescription(/9 dígitos/);
    expect(api.count("PATCH", "/api/v1/me")).toBe(0);
  });

  it("edits Ecuador phones without depending on the former country picker lookup", async () => {
    const api = stubApi({
      "GET /api/v1/me": () => json(profile),
      "GET /api/v1/reference/countries": () => problem(503, "SERVICE_UNAVAILABLE", "No disponible", "Inténtalo otra vez."),
    });
    renderPurchaseRoute(routes, "/account");
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Agregar teléfono" }));
    const phone = screen.getByLabelText("Teléfono");
    expect(phone).toBeEnabled();
    await user.type(phone, "99");
    expect(phone).not.toHaveAttribute("aria-invalid", "true");
    await user.tab();
    expect(phone).toHaveAccessibleDescription(/9 dígitos/);
    expect(api.count("GET", "/api/v1/reference/countries")).toBe(0);
  });

  it("edits one name field at a time and returns focus to its action", async () => {
    const api = stubApi({
      "GET /api/v1/me": [() => json(profile), () => json({ ...profile, firstNames: "Ana María" })],
      "PATCH /api/v1/me": () => new Response(null, { status: 204 }),
    });
    renderPurchaseRoute(routes, "/account");
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Editar nombres" }));
    const names = screen.getByLabelText("Nombres");
    expect(names).toHaveFocus();
    expect(screen.getAllByRole("textbox")).toHaveLength(1);
    expect(screen.getByRole("button", { name: "Editar apellidos" })).toBeDisabled();
    await user.clear(names);
    await user.click(screen.getByRole("button", { name: "Guardar" }));
    expect(await screen.findByText("Escribe tus nombres.")).toBeInTheDocument();
    expect(api.count("PATCH", "/api/v1/me")).toBe(0);
    await user.type(names, "Ana María");
    await user.click(screen.getByRole("button", { name: "Guardar" }));
    await waitFor(() => expect(api.calls.find((call) => call.method === "PATCH")?.body).toEqual({ field: "firstNames", value: "Ana María", expectedVersion: "0" }));
    expect(await screen.findByText("Guardamos tus nombres.")).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole("button", { name: "Editar nombres" })).toHaveFocus());
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
  });

  it("cancels an edit with Escape without saving", async () => {
    const api = stubApi({ "GET /api/v1/me": () => json(profile) });
    renderPurchaseRoute(routes, "/account");
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Editar apellidos" }));
    await user.type(screen.getByLabelText("Apellidos"), " Andrade");
    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.getByRole("button", { name: "Editar apellidos" })).toHaveFocus());
    expect(screen.getByText("Pérez")).toBeInTheDocument();
    expect(api.count("PATCH", "/api/v1/me")).toBe(0);
  });

  it("validates and normalizes an international profile phone", async () => {
    const api = stubApi({
      "GET /api/v1/me": [() => json(profile), () => json({ ...profile, phone: "+593991234567" })],
      "PATCH /api/v1/me": () => new Response(null, { status: 204 }),
    });
    renderPurchaseRoute(routes, "/account");
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Agregar teléfono" }));
    const phone = await screen.findByLabelText("Teléfono");
    await waitFor(() => expect(phone).toBeEnabled());
    await user.type(phone, "99");
    await user.click(screen.getByRole("button", { name: "Guardar" }));
    expect(phone).toHaveAccessibleDescription(/9 dígitos/);
    expect(api.count("PATCH", "/api/v1/me")).toBe(0);
    await user.clear(phone);
    await user.type(phone, "0991234567");
    await user.click(screen.getByRole("button", { name: "Guardar" }));
    await waitFor(() => expect(api.calls.find((call) => call.method === "PATCH")?.body).toEqual({ field: "phone", value: "+593991234567", expectedVersion: "0" }));
    expect(await screen.findByText("Guardamos tu teléfono.")).toBeInTheDocument();
  });

  it("requests an email change only with the current password and keeps the address in use until it is confirmed", async () => {
    const api = stubApi({
      "GET /api/v1/me": [() => json(profile), () => json({ ...profile, pendingEmail: { address: "nueva@example.com", expiresAt: "2026-11-02T15:00:00Z", delivery: "OK" } })],
      "PUT /api/v1/me/email": [
        () => problem(400, "CURRENT_PASSWORD_INVALID", "Contraseña incorrecta", "La contraseña actual no es correcta."),
        () => problem(409, "P1101", "Correo ya registrado", "Ya existe una cuenta con ese correo electrónico."),
        () => json({ email: "ana@example.com", pendingEmail: { address: "nueva@example.com", expiresAt: "2026-11-02T15:00:00Z" } }, 202),
      ],
    });
    renderPurchaseRoute(routes, "/account");
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Editar correo electrónico" }));
    expect(screen.queryByRole("link", { name: "Reenviar verificación de correo" })).not.toBeInTheDocument();
    const email = screen.getByLabelText("Nuevo correo");
    expect(email).toHaveFocus();
    await user.type(email, "Nueva@Example.com");
    await user.click(screen.getByRole("button", { name: "Guardar" }));
    expect(await screen.findByText("Escribe tu contraseña actual para confirmar el cambio.")).toBeInTheDocument();
    expect(api.count("PUT", "/api/v1/me/email")).toBe(0);

    const password = screen.getByLabelText("Contraseña actual");
    await user.type(password, "equivocada");
    await user.click(screen.getByRole("button", { name: "Guardar" }));
    expect(await screen.findByText("La contraseña actual no es correcta.")).toBeInTheDocument();
    expect(password).toHaveFocus();

    await user.type(password, "Lectura-segura-2026");
    await user.click(screen.getByRole("button", { name: "Guardar" }));
    expect(await screen.findByText("Ya existe una cuenta con ese correo.")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Guardar" }));
    expect(await screen.findByText("Te enviamos el enlace. Si no lo ves en unos minutos, revisa la carpeta de spam.")).toBeInTheDocument();
    expect(api.calls.filter((call) => call.method === "PUT").at(-1)?.body).toEqual({ newEmail: "Nueva@Example.com", currentPassword: "Lectura-segura-2026" });
    const region = screen.getByRole("region", { name: "Perfil y datos personales" });
    // The verified address stays in use (and stays verified); the new one waits for its link.
    expect(within(region).getByText("ana@example.com")).toBeInTheDocument();
    expect(within(region).getByText("Por confirmar")).toHaveAttribute("data-tone", "pending");
    expect(within(region).getByText("En uso")).toBeInTheDocument();
    expect(within(region).getByText("nueva@example.com")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Reenviar verificación de correo" })).not.toBeInTheDocument();
  });

  it("does not restore a cleared session when a pending email change finishes", async () => {
    let finishChange!: (response: Response) => void;
    const changeResponse = new Promise<Response>(resolve => { finishChange = resolve; });
    const api = stubApi({
      "GET /api/v1/me": [() => json(profile), () => json({ ...profile, pendingEmail: { address: "nueva@example.com", expiresAt: "2026-11-02T15:00:00Z", delivery: "OK" } })],
      "PUT /api/v1/me/email": () => changeResponse,
    });
    function SessionHarness() {
      const { session, clear } = useSession();
      return <><button onClick={() => clear()}>Cerrar sesión externa</button>
        <output aria-label="Estado de sesión">{session ? session.user.email : "Sin sesión"}</output><AccountPage /></>;
    }
    renderPurchaseRoute([{ path: "/account", element: <SessionHarness /> }], "/account");
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Editar correo electrónico" }));
    await user.type(screen.getByLabelText("Nuevo correo"), "nueva@example.com");
    await user.type(screen.getByLabelText("Contraseña actual"), "Lectura-segura-2026");
    await user.click(screen.getByRole("button", { name: "Guardar" }));
    await waitFor(() => expect(api.count("PUT", "/api/v1/me/email")).toBe(1));
    await user.click(screen.getByRole("button", { name: "Cerrar sesión externa" }));
    expect(screen.getByLabelText("Estado de sesión")).toHaveTextContent("Sin sesión");
    await act(async () => { finishChange(json({ email: "ana@example.com", pendingEmail: { address: "nueva@example.com", expiresAt: "2026-11-02T15:00:00Z" } }, 202)); await changeResponse; });
    expect(api.calls.filter(call => call.method === "GET" && call.path === "/api/v1/me").length).toBe(1);
    expect(screen.getByLabelText("Estado de sesión")).toHaveTextContent("Sin sesión");
    expect(screen.getByRole("heading", { name: "Inicia sesión para ver tu cuenta." })).toBeInTheDocument();
  });

  it("shows each address as an entity with its human country name", async () => {
    stubApi({ "GET /api/v1/me/addresses": () => json([savedAddress]) });
    renderPurchaseRoute(routes, "/account/addresses");
    const card = (await screen.findByRole("heading", { name: /Casa/ })).closest("li")!;
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
    await screen.findByRole("dialog", { name: "Nueva dirección" });
    await user.type(screen.getByLabelText("Dirección", { exact: true }), "Av. Principal 123");
    await choosePlace(document.querySelector<HTMLElement>(".address-form")!);
    await user.type(screen.getByLabelText("Teléfono de contacto"), "0991234567");
    await waitFor(() => expect(screen.getByRole("button", { name: "Guardar dirección" })).toBeEnabled());
    await user.click(screen.getByRole("button", { name: "Guardar dirección" }));
    await waitFor(() => expect(api.calls.find((call) => call.method === "POST")?.body).toMatchObject({
      alias: "Casa", recipient: "Ana Pérez", countryCode: "EC", phone: "+593991234567", makePrimary: true,
    }));
  });

  it("limits delivery to Ecuador without changing the approved address fields", async () => {
    const api = stubApi({
      "GET /api/v1/me/addresses": () => json([]),
      "POST /api/v1/me/addresses": () => json({ addressId: "16" }, 201),
    });
    renderPurchaseRoute(routes, "/account/addresses");
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Agregar dirección" }));
    await screen.findByRole("dialog", { name: "Nueva dirección" });
    await user.type(screen.getByLabelText("Dirección", { exact: true }), "Calle 10");
    await choosePlace(document.querySelector<HTMLElement>(".address-form")!);
    expect(screen.getByLabelText("País de entrega")).toHaveValue("Ecuador");
    expect(screen.getByLabelText("País de entrega")).toHaveAttribute("readonly");
    expect(screen.queryByRole("combobox", { name: "País de entrega" })).not.toBeInTheDocument();
    await user.type(screen.getByLabelText("Teléfono de contacto"), "991234567");
    await user.click(screen.getByRole("button", { name: "Guardar dirección" }));
    await waitFor(() => expect(api.calls.find((call) => call.method === "POST")?.body).toMatchObject({ countryCode: "EC", phone: "+593991234567" }));
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
    const confirm = await screen.findByRole("dialog", { name: "¿Eliminar «Casa»?" });
    expect(within(confirm).getByText(/pedidos anteriores conservan/)).toBeInTheDocument();
    expect(api.count("DELETE", "/api/v1/me/addresses/15")).toBe(0);
    await user.click(within(confirm).getByRole("button", { name: "Eliminar dirección" }));
    expect(await screen.findByRole("heading", { name: "Aún no tienes direcciones guardadas." })).toBeInTheDocument();
    // A short toast reports it; the page keeps no banner, and focus moves to what is left.
    expect(await screen.findByText("Dirección eliminada")).toBeInTheDocument();
    expect(screen.queryByText(/Eliminamos la dirección/)).not.toBeInTheDocument();
    // Focus moves a frame after the list is read again; allow for a busy test runner.
    await waitFor(() => expect(screen.getByRole("button", { name: "Agregar dirección" })).toHaveFocus(), { timeout: 3000 });
    await user.click(screen.getByRole("button", { name: "Cerrar aviso" }));
    expect(screen.queryByText("Dirección eliminada")).not.toBeInTheDocument();
  });
});
