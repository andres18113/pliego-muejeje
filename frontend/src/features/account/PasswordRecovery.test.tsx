import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import { useState } from "react";
import { useSession } from "@/app/session";
import { json, problem, renderPurchaseRoute, stubApi } from "@/test/purchase";
import { AccountPage } from "./AccountPage";
import { profileQueryKey } from "@/shared/api/customer";
import { PasswordRecovery } from "./PasswordRecovery";

const accepted = () => json({ message: "Si la cuenta cumple los requisitos, recibirás un correo." }, 202);
function renderRecovery(readCurrent = true) {
  return renderPurchaseRoute([{ path: "/account", element: <PasswordRecovery email="ana@example.invalid" readCurrent={readCurrent} /> }], "/account");
}
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

it("connects the profile action to recovery using the current server email and profile return path", async () => {
  const api = stubApi({
    "GET /api/v1/me": () => json({ customerId: "2", email: "actual@example.invalid", firstNames: "Ana", lastNames: "Pérez", phone: null, state: "ACTIVE", version: "0", emailVerified: true }),
    "GET /api/v1/me/billing-identity": () => new Response(null, { status: 204 }),
    "POST /api/v1/auth/forgot-password": accepted,
  });
  renderPurchaseRoute([{ path: "/account", element: <AccountPage /> }], "/account");
  const section = await screen.findByRole("region", { name: "Contraseña" });
  expect(api.count("POST", "/api/v1/auth/forgot-password")).toBe(0);
  expect(within(section).getByText("actual@example.invalid")).toBeVisible();
  await userEvent.setup().click(within(section).getByRole("button", { name: "Enviar enlace para restablecer" }));
  expect(await within(section).findByRole("status")).toHaveTextContent("Solicitud recibida. Revisa tu correo.");
  const request = api.calls.find(call => call.path === "/api/v1/auth/forgot-password")!;
  expect(request.body).toEqual({ email: "actual@example.invalid", returnTo: "/account" });
  expect(request.headers.has("Authorization")).toBe(false);
  expect(api.count("POST", "/api/v1/auth/reset-password")).toBe(0);
});

it("sends once on rapid clicks and permits an explicit resend after the cooldown", async () => {
  let finish!: (response: Response) => void;
  const api = stubApi({ "POST /api/v1/auth/forgot-password": [() => new Promise(resolve => { finish = resolve; }), accepted] });
  renderRecovery();
  vi.useFakeTimers();
  const action = screen.getByRole("button", { name: "Enviar enlace para restablecer" });
  fireEvent.click(action); fireEvent.click(action);
  await act(async () => { await Promise.resolve(); });
  expect(api.count("POST", "/api/v1/auth/forgot-password")).toBe(1);
  expect(action).toBeDisabled();
  await act(async () => finish(accepted()));
  expect(screen.getByRole("status")).toHaveTextContent("Solicitud recibida");
  expect(screen.getByRole("button", { name: "Solicitar otro enlace" })).toBeDisabled();
  await act(async () => vi.advanceTimersByTime(60_000));
  expect(api.count("POST", "/api/v1/auth/forgot-password")).toBe(1);
  fireEvent.click(screen.getByRole("button", { name: "Solicitar otro enlace" }));
  await act(async () => { await Promise.resolve(); });
  expect(api.count("POST", "/api/v1/auth/forgot-password")).toBe(2);
});

it.each(["network", "server", "malformed"])("does not automatically replay an uncertain %s response or claim the email was sent", async kind => {
  const api = stubApi({ "POST /api/v1/auth/forgot-password": () => {
    if (kind === "network") throw new TypeError("offline");
    return kind === "server" ? problem(503, "UNAVAILABLE", "Sin servicio", "Temporal") : json({}, 202);
  } });
  renderRecovery();
  await userEvent.setup().click(screen.getByRole("button", { name: "Enviar enlace para restablecer" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("No pudimos confirmar el envío. Revisa tu correo antes de solicitar otro enlace.");
  expect(screen.queryByText("Solicitud recibida. Revisa tu correo.")).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Solicitar otro enlace" })).toBeDisabled();
  expect(api.count("POST", "/api/v1/auth/forgot-password")).toBe(1);
});

it("allows recovery from a definite rejection without obscuring the next action", async () => {
  const api = stubApi({ "POST /api/v1/auth/forgot-password": [() => problem(400, "VALIDATION_FAILED", "Datos inválidos", "Revisa tu correo."), accepted] });
  renderRecovery(); const user = userEvent.setup();
  await user.click(screen.getByRole("button", { name: "Enviar enlace para restablecer" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("No pudimos solicitar el enlace. Inténtalo de nuevo.");
  await user.click(screen.getByRole("button", { name: "Enviar enlace para restablecer" }));
  expect(await screen.findByRole("status")).toHaveTextContent("Solicitud recibida");
  expect(api.count("POST", "/api/v1/auth/forgot-password")).toBe(2);
});

it("blocks requests when the displayed profile could not be refreshed", () => {
  const api = stubApi({}); renderRecovery(false);
  const action = screen.getByRole("button", { name: "Enviar enlace para restablecer" });
  expect(action).toBeDisabled(); fireEvent.click(action);
  expect(api.count("POST", "/api/v1/auth/forgot-password")).toBe(0);
});

it("respects an explicit rate-limit response before allowing a manual retry", async () => {
  const api = stubApi({ "POST /api/v1/auth/forgot-password": () => problem(429, "RATE_LIMITED", "Demasiadas solicitudes", "Espera.") });
  renderRecovery();
  await userEvent.setup().click(screen.getByRole("button", { name: "Enviar enlace para restablecer" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("Espera un minuto antes de solicitar otro enlace.");
  expect(screen.getByRole("button", { name: "Enviar enlace para restablecer" })).toBeDisabled();
  expect(api.count("POST", "/api/v1/auth/forgot-password")).toBe(1);
});

it("offers verification instead of requesting a reset for an unverified email", async () => {
  const api = stubApi({ "GET /api/v1/me": () => json({ customerId: "2", email: "pending@example.invalid", firstNames: "Ana", lastNames: "Pérez", phone: null, state: "ACTIVE", version: "0", emailVerified: false }), "GET /api/v1/me/billing-identity": () => new Response(null, { status: 204 }) });
  renderPurchaseRoute([{ path: "/account", element: <AccountPage /> }], "/account");
  const section = await screen.findByRole("region", { name: "Contraseña" });
  expect(within(section).getByText("Verifica tu correo para restablecer la contraseña.")).toBeVisible();
  expect(within(section).getByRole("link", { name: "Reenviar verificación de correo" })).toHaveAttribute("href", "/reenviar-verificacion");
  expect(within(section).queryByRole("button", { name: "Enviar enlace para restablecer" })).not.toBeInTheDocument();
  expect(api.count("POST", "/api/v1/auth/forgot-password")).toBe(0);
});

it("waits for a profile refresh before using an email from the cache", async () => {
  let finish!: (response: Response) => void;
  const oldProfile = { customerId: "2", email: "old@example.invalid", firstNames: "Ana", lastNames: "Pérez", phone: null, state: "ACTIVE", version: "0", emailVerified: true };
  const api = stubApi({ "GET /api/v1/me": [() => json(oldProfile), () => new Promise(resolve => { finish = resolve; })], "GET /api/v1/me/billing-identity": () => new Response(null, { status: 204 }), "POST /api/v1/auth/forgot-password": accepted });
  const { queryClient } = renderPurchaseRoute([{ path: "/account", element: <AccountPage /> }], "/account");
  const section = await screen.findByRole("region", { name: "Contraseña" });
  await waitFor(() => expect(within(section).getByRole("button")).toBeEnabled());
  act(() => { void queryClient.invalidateQueries({ queryKey: profileQueryKey }); });
  await waitFor(() => expect(within(section).getByRole("button")).toBeDisabled());
  fireEvent.click(within(section).getByRole("button"));
  expect(api.count("POST", "/api/v1/auth/forgot-password")).toBe(0);
  await act(async () => finish(json({ ...oldProfile, email: "new@example.invalid" })));
  await waitFor(() => expect(within(screen.getByRole("region", { name: "Contraseña" })).getByText("new@example.invalid")).toBeVisible());
  const updated = screen.getByRole("region", { name: "Contraseña" });
  await waitFor(() => expect(within(updated).getByRole("button")).toBeEnabled());
  await userEvent.setup().click(within(updated).getByRole("button"));
  await waitFor(() => expect(api.count("POST", "/api/v1/auth/forgot-password")).toBe(1));
  expect(api.calls.find(call => call.path === "/api/v1/auth/forgot-password")?.body).toEqual({ email: "new@example.invalid", returnTo: "/account" });
});

it("discards a late result after the email shown in the profile changes", async () => {
  let finish!: (response: Response) => void;
  const api = stubApi({ "POST /api/v1/auth/forgot-password": () => new Promise(resolve => { finish = resolve; }) });
  function Profile() {
    const [email, setEmail] = useState("old@example.invalid");
    return <><button onClick={() => setEmail("new@example.invalid")}>Cambiar correo</button><PasswordRecovery key={email} email={email} readCurrent /></>;
  }
  renderPurchaseRoute([{ path: "/account", element: <Profile /> }], "/account");
  const user = userEvent.setup();
  await user.click(screen.getByRole("button", { name: "Enviar enlace para restablecer" }));
  await waitFor(() => expect(api.count("POST", "/api/v1/auth/forgot-password")).toBe(1));
  await user.click(screen.getByRole("button", { name: "Cambiar correo" }));
  await act(async () => finish(accepted()));
  expect(screen.queryByRole("status")).not.toBeInTheDocument();
  expect(screen.getByText("new@example.invalid")).toBeVisible();
  expect(screen.getByRole("button", { name: "Enviar enlace para restablecer" })).toBeEnabled();
});

it("discards a late result after a different account signs in", async () => {
  let finish!: (response: Response) => void;
  stubApi({ "POST /api/v1/auth/forgot-password": () => new Promise(resolve => { finish = resolve; }) });
  function Profile() {
    const { session, establish } = useSession();
    return <><button onClick={() => establish({ accessToken: "synthetic-B", expiresAt: Date.now() + 1_800_000, user: { userId: "3", email: "b@example.invalid", role: "CUSTOMER" } })}>Cambiar cuenta</button>
      <PasswordRecovery key={session?.user.userId} email={session?.user.email ?? ""} readCurrent />
    </>;
  }
  renderPurchaseRoute([{ path: "/account", element: <Profile /> }], "/account");
  const user = userEvent.setup(); await user.click(screen.getByRole("button", { name: "Enviar enlace para restablecer" }));
  await user.click(screen.getByRole("button", { name: "Cambiar cuenta" }));
  await act(async () => finish(accepted()));
  expect(screen.queryByRole("status")).not.toBeInTheDocument();
  expect(screen.getByText("b@example.invalid")).toBeVisible();
});
