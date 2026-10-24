import { act, configure, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { json, problem, renderPurchaseRoute, stubApi } from "@/test/purchase";
import { VerifyEmailPage, ResendVerificationPage, ForgotPasswordPage, ResetPasswordPage } from "./EmailActionPages";
import { useSession } from "@/app/session";

const token = "a".repeat(43);
const routes = [
  { path: "/verificar-correo", element: <VerifyEmailPage /> },
  { path: "/reenviar-verificacion", element: <ResendVerificationPage /> },
  { path: "/recuperar-contrasena", element: <ForgotPasswordPage /> },
  { path: "/restablecer-contrasena", element: <ResetPasswordPage /> },
  { path: "/sign-in", element: <h1>Iniciar sesión</h1> },
];

describe("customer email actions", () => {
  afterEach(() => { vi.unstubAllGlobals(); configure({ reactStrictMode: false }); });

  it("preserves the cart origin through verification and automatic return without authorizing access", async () => {
    const destination = "/cart?source=edition#items";
    const from = new URLSearchParams({ from: destination }).toString();
    const api = stubApi({ "POST /api/v1/auth/verify-email": () => new Response(null, { status: 204 }) });
    const { router } = renderPurchaseRoute(routes, `/verificar-correo?${from}#token=${token}`, { role: null });
    await waitFor(() => expect(router.state.location.hash).toBe(""));
    expect(await screen.findByRole("status")).toHaveTextContent("Volviendo a donde estabas…");
    expect(screen.getByRole("link", { name: "Continuar" })).toHaveAttribute("href", destination);
    expect(screen.getAllByRole("link", { name: "Iniciar sesión" }).every(link => link.getAttribute("href") === `/sign-in?${from}`)).toBe(true);
    expect(api.count("POST", "/api/v1/auth/login")).toBe(0);
  });

  it("carries the validated origin into a resend request while keeping neutral feedback", async () => {
    const api = stubApi({ "POST /api/v1/auth/resend-verification": () => json({ message: "Si la cuenta cumple los requisitos, recibirás un correo." }, 202) });
    renderPurchaseRoute(routes, "/reenviar-verificacion?from=%2Fcart", { role: null });
    const user = userEvent.setup();
    await user.type(screen.getByLabelText("Correo electrónico"), "ana@example.com");
    await user.click(screen.getByRole("button", { name: "Solicitar enlace de verificación" }));
    expect(await screen.findByRole("status")).toHaveTextContent("Si la cuenta cumple");
    expect(api.calls.find(call => call.path === "/api/v1/auth/resend-verification")?.body).toEqual({ email: "ana@example.com", returnTo: "/cart" });
  });

  it("keeps a newer account signed in when an earlier password reset finishes", async () => {
    let finish!: (response: Response) => void;
    const pending = new Promise<Response>(resolve => { finish = resolve; });
    const api = stubApi({ "POST /api/v1/auth/reset-password": () => pending });
    function IdentityReset() {
      const { session, establish } = useSession();
      return <>
        <output aria-label="Cuenta actual">{session?.user.userId ?? "guest"}</output>
        <button onClick={() => establish({ accessToken: "synthetic-B", expiresAt: Date.now() + 1_800_000,
          user: { userId: "3", email: "b@example.invalid", role: "CUSTOMER" } })}>Cambiar cuenta</button>
        <ResetPasswordPage />
      </>;
    }
    renderPurchaseRoute([{ path: "/restablecer-contrasena", element: <IdentityReset /> }], `/restablecer-contrasena#token=${token}`);
    const user = userEvent.setup();
    await user.type(screen.getByLabelText("Nueva contraseña"), "segura123");
    await user.type(screen.getByLabelText("Confirma tu contraseña"), "segura123");
    await user.click(screen.getByRole("button", { name: "Restablecer contraseña" }));
    await waitFor(() => expect(api.count("POST", "/api/v1/auth/reset-password")).toBe(1));
    await user.click(screen.getByRole("button", { name: "Cambiar cuenta" }));
    await act(async () => { finish(new Response(null, { status: 204 })); });
    await screen.findByText("Inicia sesión con tu nueva contraseña.");
    expect(screen.getByLabelText("Cuenta actual")).toHaveTextContent("3");
  });

  it("automatically verifies a fragment token once and removes it from the URL", async () => {
    const api = stubApi({ "POST /api/v1/auth/verify-email": () => new Response(null, { status: 204 }) });
    const { router } = renderPurchaseRoute(routes, `/verificar-correo#token=${token}`, { role: null });
    await waitFor(() => expect(router.state.location.hash).toBe(""));
    expect(await screen.findByRole("status")).toHaveTextContent("Abriendo el inicio…");
    expect(api.calls.find(call => call.path === "/api/v1/auth/verify-email")?.body).toEqual({ token });
    expect(api.count("POST", "/api/v1/auth/login")).toBe(0);
  });

  it("shows progress and sends one verification command under Strict Mode", async () => {
    configure({ reactStrictMode: true });
    let finish!: (response: Response) => void;
    const api = stubApi({ "POST /api/v1/auth/verify-email": () => new Promise(resolve => { finish = resolve; }) });
    const { router } = renderPurchaseRoute(routes, `/verificar-correo#token=${token}`, { role: null });
    await waitFor(() => expect(api.count("POST", "/api/v1/auth/verify-email")).toBe(1));
    expect(screen.getByRole("status")).toHaveTextContent("Estamos comprobando el enlace");
    expect(screen.queryByRole("button", { name: "Verificar correo" })).not.toBeInTheDocument();
    await waitFor(() => expect(router.state.location.hash).toBe(""));
    await act(async () => finish(new Response(null, { status: 204 })));
    expect(await screen.findByRole("heading", { name: "Correo verificado" })).toBeInTheDocument();
    expect(api.count("POST", "/api/v1/auth/verify-email")).toBe(1);
  });

  it("preserves success when the same link is reopened without replaying verification", async () => {
    const api = stubApi({ "POST /api/v1/auth/verify-email": () => new Response(null, { status: 204 }) });
    const { router } = renderPurchaseRoute(routes, `/verificar-correo#token=${token}`, { role: null });
    await screen.findByRole("heading", { name: "Correo verificado" });
    await act(async () => { await router.navigate(`/verificar-correo#token=${token}`); });
    await waitFor(() => expect(router.state.location.hash).toBe(""));
    expect(screen.getByRole("status")).toHaveTextContent("Abriendo el inicio…");
    expect(api.count("POST", "/api/v1/auth/verify-email")).toBe(1);
  });

  it("keeps the current link result when an earlier verification finishes later", async () => {
    let finishOld!: (response: Response) => void;
    const api = stubApi({ "POST /api/v1/auth/verify-email": [
      () => new Promise(resolve => { finishOld = resolve; }),
      () => new Response(null, { status: 204 }),
    ] });
    const { router } = renderPurchaseRoute(routes, `/verificar-correo#token=${token}`, { role: null });
    await waitFor(() => expect(api.count("POST", "/api/v1/auth/verify-email")).toBe(1));
    const freshToken = "b".repeat(43);
    await act(async () => { await router.navigate(`/verificar-correo#token=${freshToken}`); });
    await screen.findByRole("heading", { name: "Correo verificado" });
    await act(async () => finishOld(problem(400, "EMAIL_ACTION_INVALID", "Enlace inválido", "El enlace venció o ya se utilizó.")));
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("Abriendo el inicio…");
    expect(api.calls.filter(call => call.path === "/api/v1/auth/verify-email").map(call => call.body)).toEqual([{ token }, { token: freshToken }]);
  });

  it("rejects missing and query-string tokens without sending them to the backend", async () => {
    const api = stubApi({});
    renderPurchaseRoute(routes, `/verificar-correo?token=${token}`, { role: null });
    expect(screen.getByRole("alert")).toHaveTextContent("Abre el enlace completo del correo");
    expect(screen.queryByRole("button", { name: "Verificar correo" })).not.toBeInTheDocument();
    expect(api.count("POST", "/api/v1/auth/verify-email")).toBe(0);
    expect(screen.getByRole("link", { name: "Solicitar otro enlace" })).toHaveAttribute("href", "/reenviar-verificacion");
  });

  it("offers a new verification link when a single-use token has expired", async () => {
    stubApi({ "POST /api/v1/auth/verify-email": () => problem(400, "EMAIL_ACTION_INVALID", "Enlace inválido", "El enlace venció o ya se utilizó.") });
    renderPurchaseRoute(routes, `/verificar-correo#token=${token}`, { role: null });
    expect(await screen.findByRole("alert")).toHaveTextContent("El enlace venció o ya se utilizó.");
    expect(screen.queryByRole("button", { name: "Verificar correo" })).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Este enlace ya no está disponible" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Solicitar otro enlace" })).toHaveAttribute("href", "/reenviar-verificacion");
  });

  it("captures a fresh fragment on the same mounted route after a rejected token", async () => {
    const freshToken = "b".repeat(43);
    const api = stubApi({ "POST /api/v1/auth/verify-email": [
      () => problem(400, "EMAIL_ACTION_INVALID", "Enlace inválido", "El enlace venció o ya se utilizó."),
      () => new Response(null, { status: 204 }),
    ] });
    const { router } = renderPurchaseRoute(routes, `/verificar-correo#token=${token}`, { role: null });
    expect(await screen.findByRole("alert")).toHaveTextContent("El enlace venció");
    await act(async () => { await router.navigate(`/verificar-correo#token=${freshToken}`); });
    await waitFor(() => expect(router.state.location.hash).toBe(""));
    expect(await screen.findByRole("status")).toHaveTextContent("Abriendo el inicio…");
    expect(api.calls.filter(call => call.path === "/api/v1/auth/verify-email").map(call => call.body)).toEqual([{ token }, { token: freshToken }]);
  });

  it.each([
    ["/reenviar-verificacion", "/api/v1/auth/resend-verification", "Solicitar enlace de verificación"],
    ["/recuperar-contrasena", "/api/v1/auth/forgot-password", "Solicitar recuperación"],
  ])("validates then submits %s with neutral accepted feedback", async (route, endpoint, label) => {
    const api = stubApi({ [`POST ${endpoint}`]: () => json({ message: "Si la cuenta cumple los requisitos, recibirás un correo con los pasos a seguir." }, 202) });
    renderPurchaseRoute(routes, route, { role: null });
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: label }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Escribe un correo válido.");
    expect(api.count("POST", endpoint)).toBe(0);
    await user.type(screen.getByLabelText("Correo electrónico"), "ANA@EXAMPLE.COM");
    await user.click(screen.getByRole("button", { name: label }));
    expect(await screen.findByRole("status")).toHaveTextContent("Si la cuenta cumple los requisitos");
    expect(api.calls.find(call => call.path === endpoint)?.body).toEqual({ email: "ana@example.com" });
    expect(screen.getByRole("button", { name: label })).toBeDisabled();
  });

  it("does not blindly retry a token after a lost verification response", async () => {
    const api = stubApi({ "POST /api/v1/auth/verify-email": () => { throw new TypeError("network"); } });
    renderPurchaseRoute(routes, `/verificar-correo#token=${token}`, { role: null });
    expect(await screen.findByRole("alert")).toHaveTextContent("No pudimos confirmar el resultado");
    expect(screen.queryByRole("button", { name: "Verificar correo" })).not.toBeInTheDocument();
    expect(api.count("POST", "/api/v1/auth/verify-email")).toBe(1);
  });

  it("does not replay an uncertain verification when reopening the same link", async () => {
    const api = stubApi({ "POST /api/v1/auth/verify-email": () => { throw new TypeError("network"); } });
    const { router } = renderPurchaseRoute(routes, `/verificar-correo#token=${token}`, { role: null });
    await screen.findByRole("alert");
    await act(async () => { await router.navigate(`/verificar-correo#token=${token}`); });
    await waitFor(() => expect(router.state.location.hash).toBe(""));
    expect(screen.getByRole("alert")).toHaveTextContent("No pudimos confirmar el resultado");
    expect(api.count("POST", "/api/v1/auth/verify-email")).toBe(1);
  });

  it("retains an uncertain result when revisiting its link after another verification", async () => {
    const freshToken = "b".repeat(43);
    const api = stubApi({ "POST /api/v1/auth/verify-email": [
      () => { throw new TypeError("network"); },
      () => new Response(null, { status: 204 }),
      () => new Response(null, { status: 204 }),
    ] });
    const { router } = renderPurchaseRoute(routes, `/verificar-correo#token=${token}`, { role: null });
    await screen.findByRole("alert");
    await act(async () => { await router.navigate(`/verificar-correo#token=${freshToken}`); });
    await screen.findByRole("heading", { name: "Correo verificado" });
    await act(async () => { await router.navigate(`/verificar-correo#token=${token}`); });
    await waitFor(() => expect(router.state.location.hash).toBe(""));
    expect(api.calls.filter(call => call.path === "/api/v1/auth/verify-email").map(call => call.body)).toEqual([{ token }, { token: freshToken }]);
    expect(await screen.findByRole("alert")).toHaveTextContent("No pudimos confirmar el resultado");
  });

  it("lets a customer correct a rejected email request without automatic retry", async () => {
    const api = stubApi({ "POST /api/v1/auth/resend-verification": [
      () => problem(400, "VALIDATION_ERROR", "Datos inválidos", "Revisa el correo."),
      () => json({ message: "Si la cuenta cumple los requisitos, recibirás un correo." }, 202),
    ] });
    renderPurchaseRoute(routes, "/reenviar-verificacion", { role: null });
    const user = userEvent.setup();
    await user.type(screen.getByLabelText("Correo electrónico"), "ana@example.com");
    await user.click(screen.getByRole("button", { name: "Solicitar enlace de verificación" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Revisa el correo");
    expect(screen.getByLabelText("Correo electrónico")).toBeEnabled();
    await user.clear(screen.getByLabelText("Correo electrónico"));
    await user.type(screen.getByLabelText("Correo electrónico"), "otra@example.com");
    await user.click(screen.getByRole("button", { name: "Solicitar enlace de verificación" }));
    expect(await screen.findByRole("status")).toHaveTextContent("Si la cuenta cumple");
    expect(api.count("POST", "/api/v1/auth/resend-verification")).toBe(2);
  });

  it("validates the reset password and confirmation before consuming the token", async () => {
    const api = stubApi({ "POST /api/v1/auth/reset-password": () => new Response(null, { status: 204 }) });
    renderPurchaseRoute(routes, `/restablecer-contrasena#token=${token}`, { role: null });
    const user = userEvent.setup();
    await user.type(screen.getByLabelText("Nueva contraseña"), "abc");
    await user.click(screen.getByRole("button", { name: "Restablecer contraseña" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Usa al menos 8 caracteres");
    await user.clear(screen.getByLabelText("Nueva contraseña"));
    await user.type(screen.getByLabelText("Nueva contraseña"), "segura123");
    await user.type(screen.getByLabelText("Confirma tu contraseña"), "distinta123");
    await user.click(screen.getByRole("button", { name: "Restablecer contraseña" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Las contraseñas no coinciden");
    expect(api.count("POST", "/api/v1/auth/reset-password")).toBe(0);
    await user.clear(screen.getByLabelText("Confirma tu contraseña"));
    await user.type(screen.getByLabelText("Confirma tu contraseña"), "segura123");
    await user.click(screen.getByRole("button", { name: "Restablecer contraseña" }));
    expect(await screen.findByRole("status")).toHaveTextContent("Inicia sesión con tu nueva contraseña.");
    expect(api.calls.find(call => call.path === "/api/v1/auth/reset-password")?.body).toEqual({ token, password: "segura123" });
    expect(screen.queryByLabelText("Nueva contraseña")).not.toBeInTheDocument();
  });

  it("shows the next reset action once and keeps session consequences in a closed disclosure", async () => {
    const api = stubApi({ "POST /api/v1/auth/reset-password": () => new Response(null, { status: 204 }) });
    renderPurchaseRoute(routes, `/restablecer-contrasena?from=%2Fcart#token=${token}`, { role: null });
    const user = userEvent.setup();
    await user.type(screen.getByLabelText("Nueva contraseña"), "segura123");
    await user.type(screen.getByLabelText("Confirma tu contraseña"), "segura123");
    await user.click(screen.getByRole("button", { name: "Restablecer contraseña" }));
    const status = await screen.findByRole("status");
    expect(status).toHaveTextContent(/^Inicia sesión con tu nueva contraseña\.$/);
    expect(screen.getByRole("heading", { name: "Contraseña actualizada" })).toBeInTheDocument();
    const summary = screen.getByText("Seguridad de tu cuenta", { selector: "summary" });
    const details = summary.closest("details")!;
    expect(details).not.toHaveAttribute("open");
    expect(details).toHaveTextContent(/puede seguir activo/);
    expect(details).toHaveTextContent(/caduque/);
    expect(details).not.toHaveTextContent(/inmediatamente|ya cerramos|en \d+ minutos/i);
    await user.click(summary);
    expect(details).toHaveAttribute("open");
    expect(screen.getAllByRole("link", { name: "Iniciar sesión" }).every(link => link.getAttribute("href") === "/sign-in?from=%2Fcart")).toBe(true);
    expect(api.count("POST", "/api/v1/auth/reset-password")).toBe(1);
  });

  it("keeps automatic verification feedback concise and shows the account is ready", async () => {
    const api = stubApi({ "POST /api/v1/auth/verify-email": () => new Response(null, { status: 204 }) });
    renderPurchaseRoute(routes, `/verificar-correo#token=${token}`, { role: null });
    expect(await screen.findByRole("status")).toHaveTextContent(/^Abriendo el inicio…$/);
    expect(screen.getByRole("heading", { name: "Correo verificado" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Verificar correo" })).not.toBeInTheDocument();
    expect(api.count("POST", "/api/v1/auth/verify-email")).toBe(1);
  });

  it.each([
    ["/reenviar-verificacion", "/api/v1/auth/resend-verification", "Solicitar enlace de verificación"],
    ["/recuperar-contrasena", "/api/v1/auth/forgot-password", "Solicitar recuperación"],
  ])("keeps %s brief and blocks replay after an unknown request outcome", async (route, endpoint, label) => {
    const api = stubApi({ [`POST ${endpoint}`]: () => { throw new TypeError("network"); } });
    renderPurchaseRoute(routes, route, { role: null });
    expect(screen.getByText("Escribe el correo de tu cuenta.")).toBeInTheDocument();
    const user = userEvent.setup();
    await user.type(screen.getByLabelText("Correo electrónico"), "ana@example.com");
    await user.click(screen.getByRole("button", { name: label }));
    expect(await screen.findByRole("alert")).toHaveTextContent("No pudimos confirmar el resultado");
    expect(screen.getByText(/espera un minuto/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: label })).toBeDisabled();
    expect(screen.getByLabelText("Correo electrónico")).toBeDisabled();
    await user.click(screen.getByRole("button", { name: label }));
    expect(api.count("POST", endpoint)).toBe(1);
  });
});
