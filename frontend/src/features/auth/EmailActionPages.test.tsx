import { act, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { json, problem, renderPurchaseRoute, stubApi } from "@/test/purchase";
import { VerifyEmailPage, ResendVerificationPage, ForgotPasswordPage, ResetPasswordPage } from "./EmailActionPages";

const token = "a".repeat(43);
const routes = [
  { path: "/verificar-correo", element: <VerifyEmailPage /> },
  { path: "/reenviar-verificacion", element: <ResendVerificationPage /> },
  { path: "/recuperar-contrasena", element: <ForgotPasswordPage /> },
  { path: "/restablecer-contrasena", element: <ResetPasswordPage /> },
  { path: "/sign-in", element: <h1>Iniciar sesión</h1> },
];

describe("customer email actions", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("consumes a fragment token only after explicit confirmation and removes it from the URL", async () => {
    const api = stubApi({ "POST /api/v1/auth/verify-email": () => new Response(null, { status: 204 }) });
    const { router } = renderPurchaseRoute(routes, `/verificar-correo#token=${token}`, { role: null });
    expect(api.count("POST", "/api/v1/auth/verify-email")).toBe(0);
    await waitFor(() => expect(router.state.location.hash).toBe(""));
    await userEvent.setup().click(screen.getByRole("button", { name: "Verificar correo" }));
    expect(await screen.findByText("Tu correo está verificado. Ya puedes iniciar sesión.")).toBeInTheDocument();
    expect(api.calls.find(call => call.path === "/api/v1/auth/verify-email")?.body).toEqual({ token });
    expect(api.count("POST", "/api/v1/auth/login")).toBe(0);
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
    await userEvent.setup().click(screen.getByRole("button", { name: "Verificar correo" }));
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
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Verificar correo" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("El enlace venció");
    await act(async () => { await router.navigate(`/verificar-correo#token=${freshToken}`); });
    await waitFor(() => expect(router.state.location.hash).toBe(""));
    await user.click(await screen.findByRole("button", { name: "Verificar correo" }));
    expect(await screen.findByRole("status")).toHaveTextContent("Tu correo está verificado");
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
    await userEvent.setup().click(screen.getByRole("button", { name: "Verificar correo" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("No pudimos confirmar el resultado");
    expect(screen.queryByRole("button", { name: "Verificar correo" })).not.toBeInTheDocument();
    expect(api.count("POST", "/api/v1/auth/verify-email")).toBe(1);
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
    expect(await screen.findByRole("status")).toHaveTextContent("Tu contraseña cambió");
    expect(api.calls.find(call => call.path === "/api/v1/auth/reset-password")?.body).toEqual({ token, password: "segura123" });
    expect(screen.queryByLabelText("Nueva contraseña")).not.toBeInTheDocument();
  });
});
