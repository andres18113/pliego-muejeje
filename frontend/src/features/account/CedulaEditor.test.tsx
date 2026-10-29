import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import { json, problem, renderPurchaseRoute, stubApi } from "@/test/purchase";
import { AccountPage } from "./AccountPage";

const profile = { customerId: "2", email: "ana@example.invalid", firstNames: "Ana", lastNames: "Pérez", phone: null, state: "ACTIVE", version: "0", emailVerified: true };
const none = () => new Response(null, { status: 204 });
const stored = (number: string) => () => json({ type: "EC_CEDULA", number });
const done = () => new Response(null, { status: 204 });
function renderAccount(routes: Parameters<typeof stubApi>[0]) {
  const api = stubApi({ "GET /api/v1/me": () => json(profile), ...routes });
  renderPurchaseRoute([{ path: "/account", element: <AccountPage /> }], "/account");
  return { api, user: userEvent.setup() };
}
const row = () => screen.getByText("Cédula o RUC", { selector: "span,label" }).closest("li")!;
afterEach(() => vi.unstubAllGlobals());

it("sits in the profile sheet, is required to buy and is never removable", async () => {
  const { api } = renderAccount({ "GET /api/v1/me/billing-identity": none });
  const action = await screen.findByRole("button", { name: "Agregar cédula o RUC" });
  expect(action.closest("ul")).toBe(screen.getByText("Nombres").closest("ul"));
  expect(within(row()).getByText("Sin registrar")).toHaveAttribute("data-tone", "required");
  expect(within(row()).getByText("Necesaria para comprar")).toBeVisible();
  // Adding reads as adding: Material add, never the pencil that means editing an existing value.
  expect(action).toHaveTextContent(/^addAgregar/);
  expect(within(row()).queryByText(/opcional/i)).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: /Quitar/ })).not.toBeInTheDocument();
  expect(api.count("DELETE", "/api/v1/me/billing-identity")).toBe(0);
});

it("validates on leaving the field with one message, then reads the number back before registering it", async () => {
  const { api, user } = renderAccount({ "GET /api/v1/me/billing-identity": [none, stored("1710034065")], "PUT /api/v1/me/billing-identity": done });
  await user.click(await screen.findByRole("button", { name: "Agregar cédula o RUC" }));
  const input = screen.getByLabelText("Cédula o RUC");
  expect(input).toHaveFocus();
  await user.tab();
  expect(input).toHaveAccessibleDescription("Escribe tu cédula o RUC.");
  await user.type(input, "17100");
  expect(input).toHaveAccessibleDescription("Cédula: faltan 5 dígitos.");
  expect(input).not.toHaveAttribute("aria-invalid");
  await user.type(input, "34066");
  expect(input).toHaveAccessibleDescription("El dígito verificador no coincide. Revisa los números.");
  expect(input).toHaveAttribute("aria-invalid", "true");
  expect(screen.getByText("El dígito verificador no coincide. Revisa los números.", { selector: "[aria-live]" })).toBeInTheDocument();
  await user.clear(input);
  await user.type(input, "1710034065");
  await user.click(screen.getByRole("button", { name: "Guardar" }));
  const dialog = await screen.findByRole("dialog", { name: "¿Es correcta tu cédula?" });
  expect(within(dialog).getByText("1710034065")).toBeInTheDocument();
  expect(within(dialog).getByText("La usaremos por defecto para tus facturas.")).toBeInTheDocument();
  // The answer that changes nothing takes focus first; it returns to the field to edit the number.
  expect(within(dialog).getByRole("button", { name: "Editar" })).toHaveFocus();
  await user.click(within(dialog).getByRole("button", { name: "Editar" }));
  await waitFor(() => expect(screen.getByLabelText("Cédula o RUC")).toHaveFocus());
  expect(api.count("PUT", "/api/v1/me/billing-identity")).toBe(0);
  await user.click(screen.getByRole("button", { name: "Guardar" }));
  await user.click(await screen.findByRole("button", { name: "Confirmar cédula" }));
  expect(await screen.findByRole("status")).toHaveTextContent("Guardamos tu cédula.");
  expect(api.calls.find(call => call.method === "PUT")?.body).toEqual({ type: "EC_CEDULA", number: "1710034065" });
  expect(within(row()).getByText("1710034065")).toBeVisible();
  expect(screen.getByRole("link", { name: "Corregir cédula o RUC" })).toBeVisible();
  expect(screen.queryByRole("button", { name: "Editar cédula" })).not.toBeInTheDocument();
});

const used = (number: string, correctionRequest: object | null = null) => () => json({ type: "EC_CEDULA", number, used: true, correctionMode: "REQUEST", correctionRequest });
const pendingRequest = { id: "17", status: "PENDING", proposedType: "EC_CEDULA", proposedNumber: "1710034065", reasonCode: "DOCUMENT_TYPO",
  createdAt: "2026-10-25T17:00:00Z", dueAt: "2026-11-09T17:00:00Z", decidedAt: null, decisionReason: null };

it("leads a stored number to its own correction page instead of editing it in the sheet", async () => {
  const { user } = renderAccount({ "GET /api/v1/me/billing-identity": stored("0912345675") });
  const correct = await screen.findByRole("link", { name: "Corregir cédula o RUC" });
  expect(correct).toHaveAttribute("href", "/account/identity");
  // Navigation reads as navigation: the words, then a chevron — never the pencil of an edit in place.
  expect(correct).toHaveTextContent(/^Corregir cédula o RUCchevron_right$/);
  await user.click(screen.getByRole("button", { name: "Editar nombres" }));
  // One field at a time: while a name is open the correction waits, as every other action does.
  expect(screen.queryByRole("link", { name: "Corregir cédula o RUC" })).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Corregir cédula o RUC" })).toBeDisabled();
});

it("states a request in review in one quiet line and leads to it, with nothing to withdraw in the sheet", async () => {
  const { api } = renderAccount({ "GET /api/v1/me/billing-identity": used("0912345675", pendingRequest) });
  expect(await screen.findByText("0912345675")).toBeVisible();
  expect(within(row()).getByText("En revisión")).toBeVisible();
  expect(within(row()).queryByText(/Pediste cambiarla a/)).toBeNull();
  // The requested number is the info toggletip's description, heard unopened and shown on hover, focus or press.
  const info = within(row()).getByRole("button", { name: "Detalles de la corrección en revisión" });
  await waitFor(() => expect(info).toHaveAccessibleDescription(/Cédula solicitada\s*1710034065/));
  expect(screen.getByRole("link", { name: "Ver solicitud de corrección de la cédula o RUC" })).toHaveAttribute("href", "/account/identity");
  expect(screen.queryByRole("button", { name: /Retirar/ })).not.toBeInTheDocument();
  expect(screen.queryByRole("link", { name: "Corregir cédula o RUC" })).not.toBeInTheDocument();
  expect(api.count("POST", "/api/v1/me/billing-identity/correction-requests")).toBe(0);
});

it("says a request was not applied and leaves the reason to the correction page", async () => {
  renderAccount({ "GET /api/v1/me/billing-identity": used("0912345675", { ...pendingRequest, status: "REJECTED", decidedAt: "2026-10-27T15:00:00Z",
    decisionReason: "La documentación no permite confirmar el cambio." }) });
  expect(await screen.findByText(/No aplicamos tu corrección a/)).toHaveTextContent("No aplicamos tu corrección a 1710034065.");
  expect(screen.queryByText(/La documentación/)).not.toBeInTheDocument();
  expect(screen.getByRole("link", { name: "Corregir cédula o RUC" })).toBeVisible();
});

it("explains a stale registration without overwriting the stored cédula", async () => {
  const { api, user } = renderAccount({ "GET /api/v1/me/billing-identity": [none, stored("0912345675")],
    "PUT /api/v1/me/billing-identity": () => problem(409, "P1105", "Tu cédula cambió", "La cédula de tu perfil no es la que estabas viendo.") });
  await user.click(await screen.findByRole("button", { name: "Agregar cédula o RUC" }));
  await user.type(screen.getByLabelText("Cédula o RUC"), "1710034065");
  await user.click(screen.getByRole("button", { name: "Guardar" }));
  await user.click(await screen.findByRole("button", { name: "Confirmar cédula" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("Tu perfil ya tiene una cédula o RUC. Revísala y, si no es correcta, usa Corregir.");
  expect(within(row()).getByText("0912345675")).toBeVisible();
  await waitFor(() => expect(screen.getByRole("link", { name: "Corregir cédula o RUC" })).toHaveFocus());
  expect(api.count("PUT", "/api/v1/me/billing-identity")).toBe(1);
});

it.each([["applied", "1710034065", "Guardamos tu cédula."], ["not applied", null, "No pudimos confirmar el cambio."]])("reconciles a lost reply (%s) by reading the cédula, never by replaying", async (_case, after, message) => {
  const { api, user } = renderAccount({ "GET /api/v1/me/billing-identity": [none, after ? stored(after) : none],
    "PUT /api/v1/me/billing-identity": () => { throw new TypeError("offline"); } });
  await user.click(await screen.findByRole("button", { name: "Agregar cédula o RUC" }));
  await user.type(screen.getByLabelText("Cédula o RUC"), "1710034065");
  await user.click(screen.getByRole("button", { name: "Guardar" }));
  await user.click(await screen.findByRole("button", { name: "Confirmar cédula" }));
  expect(await screen.findByText(new RegExp(message))).toBeVisible();
  expect(api.count("PUT", "/api/v1/me/billing-identity")).toBe(1);
});

it("offers a retry when the cédula cannot be read", async () => {
  const { user } = renderAccount({ "GET /api/v1/me/billing-identity": [() => problem(503, "UNAVAILABLE", "Sin servicio", "Temporal"), stored("0912345675")] });
  expect(await screen.findByText("No pudimos consultarla.")).toBeVisible();
  await user.click(screen.getByRole("button", { name: "Volver a consultar cédula o RUC" }));
  expect(await screen.findByText("0912345675")).toBeVisible();
});

it("refuses more than 13 digits or any other character, explains it and returns to the live check", async () => {
  const { api, user } = renderAccount({ "GET /api/v1/me/billing-identity": none });
  await user.click(await screen.findByRole("button", { name: "Agregar cédula o RUC" }));
  const input = screen.getByLabelText("Cédula o RUC");
  await user.type(input, "17900169190019");
  expect(input).toHaveValue("1790016919001");
  expect(input).toHaveAccessibleDescription("Máximo 13 dígitos: la cédula tiene 10 y el RUC 13.");
  await user.type(input, "{Backspace}");
  expect(input).toHaveAccessibleDescription("RUC de sociedad: falta 1 dígito.");
  await user.type(input, "a");
  expect(input).toHaveValue("179001691900");
  expect(input).toHaveAccessibleDescription("Escribe solo números: sin letras, espacios ni guiones.");
  expect(input).toHaveAttribute("aria-invalid", "true");
  await user.type(input, "1");
  expect(input).toHaveAccessibleDescription("RUC de sociedad válido.");
  expect(api.count("PUT", "/api/v1/me/billing-identity")).toBe(0);
});

it("keeps the pencil for changing a value, the plus for adding one, and a specific name on every action", async () => {
  renderAccount({ "GET /api/v1/me/billing-identity": stored("1710034065") });
  const correct = await screen.findByRole("link", { name: "Corregir cédula o RUC" });
  expect(correct).toHaveTextContent(/^Corregir/);
  expect(screen.getByRole("button", { name: "Agregar teléfono" })).toHaveTextContent(/^addAgregar/);
  expect(screen.getByRole("button", { name: "Editar nombres" })).toHaveTextContent(/^editEditar/);
  expect(screen.getByRole("button", { name: "Cambiar contraseña" })).toHaveTextContent(/^lockCambiar/);
  // A fixed eight-dot mask for the eye, the row's state for assistive technology.
  expect(screen.getByText("••••••••")).toHaveAttribute("aria-hidden", "true");
  expect(screen.getByText("••••••••").parentElement).toHaveTextContent(/^••••••••Contraseña configurada$/);
  expect(screen.getByText("Contraseña configurada")).toHaveClass("visually-hidden");
  const names = [...screen.getByText("Nombres").closest("ul")!.querySelectorAll("button, a")].map(action => action.textContent?.replace(/^(add|edit|lock|refresh)|chevron_right$/g, ""));
  expect(names).toEqual(["Editar nombres", "Editar apellidos", "Corregir cédula o RUC", "Editar correo electrónico", "Agregar teléfono", "Cambiar contraseña"]);
  expect(new Set(names).size).toBe(names.length);
  expect(screen.getByText("1710034065").closest("li")!.querySelector("[data-tone]")).toBeNull();
  expect(document.querySelector("[data-stop]")).toBeNull();
});
