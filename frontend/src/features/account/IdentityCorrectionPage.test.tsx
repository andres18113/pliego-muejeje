import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import { json, problem, renderPurchaseRoute, stubApi } from "@/test/purchase";
import { AccountPage } from "./AccountPage";
import { IdentityCorrectionPage } from "./IdentityCorrectionPage";

const profile = { customerId: "2", email: "ana@example.invalid", firstNames: "Ana", lastNames: "Pérez", phone: null, state: "ACTIVE", version: "0", emailVerified: true };
const none = () => new Response(null, { status: 204 });
const done = () => new Response(null, { status: 204 });
const stored = (number: string) => () => json({ type: number.length === 13 ? "EC_RUC" : "EC_CEDULA", number });
const used = (number: string, correctionRequest: object | null = null) => () => json({ type: "EC_CEDULA", number, used: true, correctionMode: "REQUEST", correctionRequest });
const pendingRequest = { id: "17", status: "PENDING", proposedType: "EC_CEDULA", proposedNumber: "1710034065", reasonCode: "DOCUMENT_TYPO",
  createdAt: "2026-10-25T17:00:00Z", dueAt: "2026-11-09T17:00:00Z", decidedAt: null, decisionReason: null };

function renderPage(routes: Parameters<typeof stubApi>[0], start = "/account/identity") {
  const api = stubApi({ "GET /api/v1/me": () => json(profile), ...routes });
  const view = renderPurchaseRoute([
    { path: "/account", element: <AccountPage /> },
    { path: "/account/identity", element: <IdentityCorrectionPage /> },
  ], start);
  return { api, router: view.router, user: userEvent.setup() };
}
const number = () => screen.getByLabelText("Número correcto");
afterEach(() => vi.unstubAllGlobals());

it("is a child of Mi perfil reached from the cédula row, with its way back named", async () => {
  const { router, user } = renderPage({ "GET /api/v1/me/billing-identity": stored("0912345675") }, "/account");
  await user.click(await screen.findByRole("link", { name: "Corregir cédula o RUC" }));
  expect(router.state.location.pathname).toBe("/account/identity");
  expect(await screen.findByRole("heading", { level: 1, name: "Cédula o RUC" })).toBeVisible();
  expect(screen.getByRole("link", { name: "Volver a Mi perfil" })).toHaveAttribute("href", "/account");
  expect(screen.getByRole("heading", { name: "Cédula en uso" })).toBeVisible();
  expect(screen.getByText("0912345675", { selector: "p" })).toBeVisible();
  // No password: it would prove the session, not the number.
  expect(screen.queryByLabelText(/Contraseña/)).not.toBeInTheDocument();
});

it("corrects a number that is on no invoice directly, read back, then returns to Mi perfil with the outcome", async () => {
  const { api, router, user } = renderPage({ "GET /api/v1/me/billing-identity": [stored("0912345675"), stored("1710034065")], "POST /api/v1/me/billing-identity/correction": done });
  await screen.findByRole("heading", { name: "Corregir identificación" });
  // What will happen is said before anything is typed.
  expect(number()).toHaveAccessibleDescription(/la corrección se aplica en cuanto la confirmes/);
  expect(number()).toHaveValue("0912345675");
  expect(screen.queryByRole("radio")).not.toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "Corregir" }));
  expect(number()).toHaveAccessibleDescription(/Ese ya es tu número\. Escribe el correcto\./);
  await user.clear(number());
  await user.type(number(), "1710034065");
  await user.click(screen.getByRole("button", { name: "Corregir" }));
  const dialog = await screen.findByRole("dialog", { name: "¿Corregir tu identificación?" });
  expect(within(dialog).getByText("1710034065")).toBeInTheDocument();
  expect(within(dialog).getByText(/Las anteriores conservan la identificación con la que se emitieron/)).toBeInTheDocument();
  expect(within(dialog).getByRole("button", { name: "Editar" })).toHaveFocus();
  await user.click(within(dialog).getByRole("button", { name: "Sí, corregir" }));
  await waitFor(() => expect(router.state.location.pathname).toBe("/account"));
  expect(await screen.findByText("Corregimos tu identificación. Tus facturas anteriores no cambian.")).toHaveAttribute("role", "status");
  expect(screen.getByRole("link", { name: "Corregir cédula o RUC" })).toBeVisible();
  expect(api.calls.find(call => call.path === "/api/v1/me/billing-identity/correction")?.body)
    .toEqual({ type: "EC_CEDULA", currentNumber: "0912345675", number: "1710034065" });
});

it("sends a number already on an invoice to review with one reason, then tracks the request on the same page", async () => {
  const { api, router, user } = renderPage({ "GET /api/v1/me/billing-identity": [used("0912345675"), used("0912345675", pendingRequest)],
    "POST /api/v1/me/billing-identity/correction-requests": () => json(pendingRequest, 201) });
  await screen.findByRole("heading", { name: "Corregir identificación" });
  expect(number()).toHaveAccessibleDescription(/Ya figura en una factura: revisaremos la corrección y te responderemos en un plazo de 15 días/);
  await user.clear(number());
  await user.type(number(), "1710034065");
  // The action names the outcome: a request, not an edit.
  await user.click(screen.getByRole("button", { name: "Enviar solicitud" }));
  expect(screen.getByText("Elige qué pasó con el número.")).toBeVisible();
  expect(screen.getByRole("radio", { name: "Lo escribí mal" })).toHaveFocus();
  await user.click(screen.getByRole("radio", { name: "Lo escribí mal" }));
  await user.click(screen.getByRole("button", { name: "Enviar solicitud" }));
  const dialog = await screen.findByRole("dialog", { name: "¿Enviar la corrección?" });
  expect(within(dialog).getByText(/te responderemos en un plazo de 15 días/)).toBeInTheDocument();
  await user.click(within(dialog).getByRole("button", { name: "Enviar solicitud" }));
  const notice = await screen.findByRole("status");
  expect(notice).toHaveTextContent("Enviamos tu solicitud. Te responderemos en un plazo de 15 días.");
  await waitFor(() => expect(notice).toHaveFocus());
  expect(router.state.location.pathname).toBe("/account/identity");
  const request = screen.getByRole("region", { name: "Solicitud de corrección" });
  expect(within(request).getByText("En revisión")).toBeVisible();
  expect(within(request).getByText("Cédula solicitada").nextElementSibling).toHaveTextContent("1710034065");
  expect(within(request).getByText("Motivo").nextElementSibling).toHaveTextContent("Lo escribí mal");
  expect(within(request).getByText("Respuesta antes del").nextElementSibling).toHaveTextContent("9 nov 2026");
  expect(screen.queryByLabelText("Número correcto")).not.toBeInTheDocument();
  // The number in use does not change while staff review.
  expect(screen.getByText("0912345675", { selector: "p" })).toBeVisible();
  const call = api.calls.find(entry => entry.path === "/api/v1/me/billing-identity/correction-requests")!;
  expect(call.body).toEqual({ type: "EC_CEDULA", currentNumber: "0912345675", number: "1710034065", reasonCode: "DOCUMENT_TYPO" });
  expect(call.headers.get("Idempotency-Key")).toMatch(/^[0-9a-f-]{36}$/);
  expect(api.count("POST", "/api/v1/me/billing-identity/correction")).toBe(1);
});

it("switches between the same person's cédula and RUC directly, even once the number is on an invoice", async () => {
  const { api, user } = renderPage({ "GET /api/v1/me/billing-identity": [used("1710034065"), stored("1710034065001")], "POST /api/v1/me/billing-identity/correction": done });
  await screen.findByRole("heading", { name: "Corregir identificación" });
  await user.type(number(), "001");
  expect(number()).toHaveAccessibleDescription(/este cambio se aplica de inmediato, sin revisión/);
  expect(screen.queryByRole("radio")).not.toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "Corregir" }));
  await user.click(await screen.findByRole("button", { name: "Sí, corregir" }));
  expect(await screen.findByText("Corregimos tu identificación. Tus facturas anteriores no cambian.")).toBeVisible();
  expect(api.calls.find(call => call.path === "/api/v1/me/billing-identity/correction")?.body)
    .toEqual({ type: "EC_RUC", currentNumber: "1710034065", number: "1710034065001" });
  expect(api.count("POST", "/api/v1/me/billing-identity/correction-requests")).toBe(0);
});

it("turns a direct correction the server refuses as already invoiced into a request, without losing the number", async () => {
  const { api, user } = renderPage({ "GET /api/v1/me/billing-identity": stored("0912345675"),
    "POST /api/v1/me/billing-identity/correction": () => problem(409, "P1107", "Esta identificación requiere revisión", "Esta identificación ya figura en una factura.") });
  await screen.findByRole("heading", { name: "Corregir identificación" });
  await user.clear(number());
  await user.type(number(), "1710034065");
  await user.click(screen.getByRole("button", { name: "Corregir" }));
  await user.click(await screen.findByRole("button", { name: "Sí, corregir" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("Esta identificación ya figura en una factura: revisaremos la corrección antes de aplicarla.");
  expect(number()).toHaveValue("1710034065");
  await waitFor(() => expect(screen.getByRole("radio", { name: "Lo escribí mal" })).toHaveFocus());
  expect(screen.getByRole("button", { name: "Enviar solicitud" })).toBeVisible();
  expect(api.count("POST", "/api/v1/me/billing-identity/correction")).toBe(1);
});

it("turns to the request already in review when the server says one exists", async () => {
  const { user } = renderPage({ "GET /api/v1/me/billing-identity": [used("0912345675"), used("0912345675", pendingRequest)],
    "POST /api/v1/me/billing-identity/correction-requests": () => problem(409, "P1108", "Ya hay una solicitud", "Tienes una solicitud pendiente.") });
  await screen.findByRole("heading", { name: "Corregir identificación" });
  await user.clear(number());
  await user.type(number(), "1710034065");
  await user.click(screen.getByRole("radio", { name: "Ahora uso otro documento" }));
  await user.click(screen.getByRole("button", { name: "Enviar solicitud" }));
  await user.click(await within(await screen.findByRole("dialog")).findByRole("button", { name: "Enviar solicitud" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("Ya tienes una solicitud de corrección en revisión.");
  expect(await screen.findByRole("region", { name: "Solicitud de corrección" })).toBeVisible();
});

it("asks before withdrawing a request, says what it means, and keeping it changes nothing", async () => {
  const { api, user } = renderPage({ "GET /api/v1/me/billing-identity": used("0912345675", pendingRequest),
    "POST /api/v1/me/billing-identity/correction-requests/17/withdraw": done });
  const withdraw = await screen.findByRole("button", { name: "Retirar solicitud" });
  await user.click(withdraw);
  const dialog = await screen.findByRole("dialog", { name: "¿Retirar tu solicitud de corrección?" });
  expect(dialog).toHaveTextContent("Cancelaremos la revisión. Tu cédula actual no cambiará y podrás enviar otra solicitud después.");
  // Focus opens on the answer that changes nothing.
  expect(within(dialog).getByRole("button", { name: "Conservar solicitud" })).toHaveFocus();
  await user.click(within(dialog).getByRole("button", { name: "Conservar solicitud" }));
  await waitFor(() => expect(withdraw).toHaveFocus());
  expect(api.count("POST", "/api/v1/me/billing-identity/correction-requests/17/withdraw")).toBe(0);
  await user.click(withdraw);
  await user.keyboard("{Escape}");
  await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  expect(api.count("POST", "/api/v1/me/billing-identity/correction-requests/17/withdraw")).toBe(0);
});

it("withdraws a confirmed request once, keeps the current number and offers the correction again", async () => {
  const { api, user } = renderPage({ "GET /api/v1/me/billing-identity": [used("0912345675", pendingRequest), used("0912345675", { ...pendingRequest, status: "WITHDRAWN", decidedAt: "2026-10-26T10:00:00Z" })],
    "POST /api/v1/me/billing-identity/correction-requests/17/withdraw": done });
  await user.click(await screen.findByRole("button", { name: "Retirar solicitud" }));
  await user.click(within(await screen.findByRole("dialog")).getByRole("button", { name: "Retirar solicitud" }));
  const notice = await screen.findByRole("status");
  expect(notice).toHaveTextContent("Retiraste la solicitud. Tu identificación sigue siendo 0912345675.");
  await waitFor(() => expect(notice).toHaveFocus());
  expect(api.count("POST", "/api/v1/me/billing-identity/correction-requests/17/withdraw")).toBe(1);
  expect(screen.queryByRole("region", { name: "Solicitud de corrección" })).not.toBeInTheDocument();
  expect(screen.getByRole("heading", { name: "Corregir identificación" })).toBeVisible();
  expect(number()).toHaveValue("0912345675");
});

it.each([
  ["decided meanwhile", () => problem(409, "P1111", "La solicitud ya no está pendiente", "Ya fue revisada."), { ...pendingRequest, status: "APPROVED", decidedAt: "2026-10-26T10:00:00Z" }, "Ya revisamos tu solicitud, así que no se puede retirar."],
  ["withdrawn though the reply was lost", () => { throw new TypeError("offline"); }, { ...pendingRequest, status: "WITHDRAWN", decidedAt: "2026-10-26T10:00:00Z" }, "Retiraste la solicitud."],
  ["still in review after a lost reply", () => { throw new TypeError("offline"); }, pendingRequest, "No pudimos confirmar si se retiró. Sigue en revisión; vuelve a intentarlo."],
])("answers a withdrawal that did not reply cleanly from the stored state (%s)", async (_case, reply, after, message) => {
  const { api, user } = renderPage({ "GET /api/v1/me/billing-identity": [used("0912345675", pendingRequest), used(after.status === "APPROVED" ? "1710034065" : "0912345675", after)],
    "POST /api/v1/me/billing-identity/correction-requests/17/withdraw": reply });
  await user.click(await screen.findByRole("button", { name: "Retirar solicitud" }));
  await user.click(within(await screen.findByRole("dialog")).getByRole("button", { name: "Retirar solicitud" }));
  expect(await screen.findByText(new RegExp(message.replace(/[.;]/g, "\\$&")))).toBeVisible();
  await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  expect(api.count("POST", "/api/v1/me/billing-identity/correction-requests/17/withdraw")).toBe(1);
});

it("states a recent rejection with its reason above a fresh correction", async () => {
  renderPage({ "GET /api/v1/me/billing-identity": used("0912345675", { ...pendingRequest, status: "REJECTED", decidedAt: "2026-10-27T15:00:00Z",
    decisionReason: "La documentación no permite confirmar el cambio." }) });
  expect(await screen.findByText(/No aplicamos tu solicitud del/)).toHaveTextContent("No aplicamos tu solicitud del 25 oct 2026 para cambiarla a 1710034065: La documentación no permite confirmar el cambio.");
  expect(screen.getByRole("heading", { name: "Corregir identificación" })).toBeVisible();
});

it("sends an account without a cédula or RUC to Mi perfil to add one", async () => {
  renderPage({ "GET /api/v1/me/billing-identity": none });
  expect(await screen.findByRole("heading", { name: "Todavía no registraste tu cédula o RUC" })).toBeVisible();
  expect(screen.getByRole("link", { name: "Ir a Mi perfil" })).toHaveAttribute("href", "/account");
  expect(screen.queryByLabelText("Número correcto")).not.toBeInTheDocument();
});

it("offers a retry when the identification cannot be read", async () => {
  const { user } = renderPage({ "GET /api/v1/me/billing-identity": [() => problem(503, "UNAVAILABLE", "Sin servicio", "Temporal"), stored("0912345675")] });
  expect(await screen.findByText("No pudimos consultar tu identificación.")).toBeVisible();
  await user.click(screen.getByRole("button", { name: /Volver a intentar|Reintentar|Actualizar/ }));
  expect(await screen.findByText("0912345675", { selector: "p" })).toBeVisible();
});
