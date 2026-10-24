import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import { useState } from "react";
import { json, problem, renderPurchaseRoute, stubApi } from "@/test/purchase";
import { AccountPage } from "./AccountPage";
import { profileQueryKey } from "@/shared/api/customer";
import { PasswordRecoveryEditor } from "./PasswordRecovery";

const accepted = () => json({ message: "Si la cuenta cumple los requisitos, recibirás un correo." }, 202);
const profile = { customerId: "2", email: "actual@example.invalid", firstNames: "Ana", lastNames: "Pérez", phone: null, state: "ACTIVE", version: "0", emailVerified: true };
const noCedula = () => new Response(null, { status: 204 });
function renderAccount(routes: Parameters<typeof stubApi>[0] = {}, me: Record<string, unknown> = {}) {
  const api = stubApi({ "GET /api/v1/me": () => json({ ...profile, ...me }), "GET /api/v1/me/billing-identity": noCedula, ...routes });
  return { api, ...renderPurchaseRoute([{ path: "/account", element: <AccountPage /> }], "/account") };
}
const changeAction = () => screen.findByRole("button", { name: "Cambiar contraseña" });
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

it("is a row of the profile sheet that opens in place and sends only after Enviar enlace", async () => {
  const { api } = renderAccount({ "POST /api/v1/auth/forgot-password": accepted });
  const user = userEvent.setup();
  const action = await changeAction();
  expect(action.closest("ul")).toBe(screen.getByText("Nombres").closest("ul"));
  expect(screen.queryByRole("region", { name: "Contraseña" })).not.toBeInTheDocument();
  await user.click(action);
  const form = screen.getByRole("form", { name: "Cambiar contraseña" });
  expect(within(form).getByText("actual@example.invalid")).toBeVisible();
  expect(within(form).getByText(/Caduca en 15 minutos y sirve una sola vez/)).toBeVisible();
  expect(api.count("POST", "/api/v1/auth/forgot-password")).toBe(0);
  await user.click(within(form).getByRole("button", { name: "Enviar enlace" }));
  expect(await screen.findByRole("status")).toHaveTextContent("Solicitud recibida. Revisa actual@example.invalid; podrás pedir otro enlace en un minuto.");
  const request = api.calls.find(call => call.path === "/api/v1/auth/forgot-password")!;
  expect(request.body).toEqual({ email: "actual@example.invalid", returnTo: "/account" });
  expect(request.headers.has("Authorization")).toBe(false);
  await waitFor(() => expect(screen.getByRole("button", { name: "Cambiar contraseña" })).toHaveFocus());
  expect(screen.getByRole("button", { name: "Cambiar contraseña" })).toHaveAttribute("aria-disabled", "true");
  await user.click(screen.getByRole("button", { name: "Cambiar contraseña" }));
  expect(screen.queryByRole("form", { name: "Cambiar contraseña" })).not.toBeInTheDocument();
});

it("Escape and Cancelar close the step without sending", async () => {
  const { api } = renderAccount();
  const user = userEvent.setup();
  await user.click(await changeAction());
  await user.keyboard("{Escape}");
  await waitFor(() => expect(screen.getByRole("button", { name: "Cambiar contraseña" })).toHaveFocus());
  await user.click(screen.getByRole("button", { name: "Cambiar contraseña" }));
  await user.click(screen.getByRole("button", { name: "Cancelar" }));
  expect(screen.queryByRole("form", { name: "Cambiar contraseña" })).not.toBeInTheDocument();
  expect(api.count("POST", "/api/v1/auth/forgot-password")).toBe(0);
});

it("sends once on rapid clicks and permits an explicit request after the cooldown", async () => {
  let finish!: (response: Response) => void;
  const { api } = renderAccount({ "POST /api/v1/auth/forgot-password": [() => new Promise(resolve => { finish = resolve; }), accepted] });
  fireEvent.click(await changeAction());
  vi.useFakeTimers();
  const send = screen.getByRole("button", { name: "Enviar enlace" });
  fireEvent.click(send); fireEvent.click(send);
  await act(async () => { await Promise.resolve(); });
  expect(api.count("POST", "/api/v1/auth/forgot-password")).toBe(1);
  await act(async () => finish(accepted()));
  expect(screen.getByRole("status")).toHaveTextContent("Solicitud recibida");
  expect(screen.getByRole("button", { name: "Cambiar contraseña" })).toHaveAttribute("aria-disabled", "true");
  await act(async () => vi.advanceTimersByTime(60_000));
  expect(screen.getByRole("button", { name: "Cambiar contraseña" })).not.toHaveAttribute("aria-disabled");
  fireEvent.click(screen.getByRole("button", { name: "Cambiar contraseña" }));
  fireEvent.click(screen.getByRole("button", { name: "Enviar enlace" }));
  await act(async () => { await Promise.resolve(); });
  expect(api.count("POST", "/api/v1/auth/forgot-password")).toBe(2);
});

it.each(["network", "server", "malformed"])("does not replay an uncertain %s response or claim the email was sent", async kind => {
  const { api } = renderAccount({ "POST /api/v1/auth/forgot-password": () => {
    if (kind === "network") throw new TypeError("offline");
    return kind === "server" ? problem(503, "UNAVAILABLE", "Sin servicio", "Temporal") : json({}, 202);
  } });
  const user = userEvent.setup();
  await user.click(await changeAction());
  await user.click(screen.getByRole("button", { name: "Enviar enlace" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("No pudimos confirmar el envío. Revisa tu correo antes de pedir otro enlace.");
  expect(screen.queryByText(/Solicitud recibida/)).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Cambiar contraseña" })).toHaveAttribute("aria-disabled", "true");
  expect(api.count("POST", "/api/v1/auth/forgot-password")).toBe(1);
});

it("keeps the step open after a definite rejection so the reader can try again", async () => {
  const { api } = renderAccount({ "POST /api/v1/auth/forgot-password": [() => problem(400, "VALIDATION_FAILED", "Datos inválidos", "Revisa tu correo."), accepted] });
  const user = userEvent.setup();
  await user.click(await changeAction());
  await user.click(screen.getByRole("button", { name: "Enviar enlace" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("No pudimos solicitar el enlace. Inténtalo de nuevo.");
  await user.click(screen.getByRole("button", { name: "Enviar enlace" }));
  expect(await screen.findByRole("status")).toHaveTextContent("Solicitud recibida");
  expect(api.count("POST", "/api/v1/auth/forgot-password")).toBe(2);
});

it("respects an explicit rate-limit response", async () => {
  const { api } = renderAccount({ "POST /api/v1/auth/forgot-password": () => problem(429, "RATE_LIMITED", "Demasiadas solicitudes", "Espera.") });
  const user = userEvent.setup();
  await user.click(await changeAction());
  await user.click(screen.getByRole("button", { name: "Enviar enlace" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("Espera un minuto antes de pedir otro enlace.");
  expect(screen.getByRole("button", { name: "Cambiar contraseña" })).toHaveAttribute("aria-disabled", "true");
  expect(api.count("POST", "/api/v1/auth/forgot-password")).toBe(1);
});

it("asks to verify an unverified email first, with one quiet line under the sheet", async () => {
  const { api } = renderAccount({}, { email: "pending@example.invalid", emailVerified: false });
  expect(await screen.findByText("Verifica tu correo para cambiarla")).toBeVisible();
  expect(screen.getByRole("button", { name: "Cambiar contraseña" })).toBeDisabled();
  expect(screen.getByRole("link", { name: "Reenviar verificación de correo" })).toHaveAttribute("href", "/reenviar-verificacion");
  expect(api.count("POST", "/api/v1/auth/forgot-password")).toBe(0);
});

it("waits for a profile refresh and then uses the current server email", async () => {
  let finish!: (response: Response) => void;
  const api = stubApi({ "GET /api/v1/me": [() => json(profile), () => new Promise(resolve => { finish = resolve; })], "GET /api/v1/me/billing-identity": noCedula, "POST /api/v1/auth/forgot-password": accepted });
  const { queryClient } = renderPurchaseRoute([{ path: "/account", element: <AccountPage /> }], "/account");
  await waitFor(() => expect(screen.getByRole("button", { name: "Cambiar contraseña" })).toBeEnabled());
  act(() => { void queryClient.invalidateQueries({ queryKey: profileQueryKey }); });
  await waitFor(() => expect(screen.getByRole("button", { name: "Cambiar contraseña" })).toBeDisabled());
  await act(async () => finish(json({ ...profile, email: "new@example.invalid" })));
  await waitFor(() => expect(screen.getByRole("button", { name: "Cambiar contraseña" })).toBeEnabled());
  const user = userEvent.setup();
  await user.click(screen.getByRole("button", { name: "Cambiar contraseña" }));
  expect(within(screen.getByRole("form", { name: "Cambiar contraseña" })).getByText("new@example.invalid")).toBeVisible();
  await user.click(screen.getByRole("button", { name: "Enviar enlace" }));
  await waitFor(() => expect(api.count("POST", "/api/v1/auth/forgot-password")).toBe(1));
  expect(api.calls.find(call => call.path === "/api/v1/auth/forgot-password")?.body).toEqual({ email: "new@example.invalid", returnTo: "/account" });
});

it("blocks Enviar enlace while the shown profile is not current", () => {
  const api = stubApi({});
  renderPurchaseRoute([{ path: "/account", element: <PasswordRecoveryEditor email="ana@example.invalid" readCurrent={false} onDone={() => undefined} onRequested={() => undefined} /> }], "/account");
  const send = screen.getByRole("button", { name: "Enviar enlace" });
  expect(send).toHaveAttribute("aria-disabled", "true");
  fireEvent.click(send);
  expect(api.count("POST", "/api/v1/auth/forgot-password")).toBe(0);
});

it("discards a late result after the email shown in the profile changes", async () => {
  let finish!: (response: Response) => void;
  const api = stubApi({ "POST /api/v1/auth/forgot-password": () => new Promise(resolve => { finish = resolve; }) });
  const done = vi.fn();
  function Profile() {
    const [email, setEmail] = useState("old@example.invalid");
    return <><button onClick={() => setEmail("new@example.invalid")}>Cambiar correo</button><PasswordRecoveryEditor key={email} email={email} readCurrent onDone={done} onRequested={() => undefined} /></>;
  }
  renderPurchaseRoute([{ path: "/account", element: <Profile /> }], "/account");
  const user = userEvent.setup();
  await user.click(screen.getByRole("button", { name: "Enviar enlace" }));
  await waitFor(() => expect(api.count("POST", "/api/v1/auth/forgot-password")).toBe(1));
  await user.click(screen.getByRole("button", { name: "Cambiar correo" }));
  await act(async () => finish(accepted()));
  expect(done).not.toHaveBeenCalled();
  expect(screen.getByText("new@example.invalid")).toBeVisible();
});
