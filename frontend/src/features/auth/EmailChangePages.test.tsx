import { configure, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { json, problem, renderPurchaseRoute, stubApi } from "@/test/purchase";
import { CancelEmailChangePage, ConfirmEmailChangePage } from "./EmailActionPages";

const token = "b".repeat(43);
const routes = [
  { path: "/confirmar-correo", element: <ConfirmEmailChangePage /> },
  { path: "/cancelar-cambio-correo", element: <CancelEmailChangePage /> },
  { path: "/sign-in", element: <h1>Iniciar sesión</h1> },
];

describe("email change links", () => {
  afterEach(() => { vi.unstubAllGlobals(); configure({ reactStrictMode: false }); });

  it("confirms a requested address once from its fragment link and leads to signing in with it", async () => {
    configure({ reactStrictMode: true });
    const api = stubApi({ "POST /api/v1/auth/email-change/confirm": () => json({ email: "nueva@example.com" }) });
    const { router } = renderPurchaseRoute(routes, `/confirmar-correo#token=${token}`, { role: null });
    await waitFor(() => expect(router.state.location.hash).toBe(""));
    expect(await screen.findByRole("heading", { name: "Correo confirmado" })).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("Desde ahora entras con nueva@example.com. Por seguridad cerramos tus sesiones abiertas.");
    expect(api.count("POST", "/api/v1/auth/email-change/confirm")).toBe(1);
    expect(api.calls.find(call => call.path === "/api/v1/auth/email-change/confirm")?.body).toEqual({ token });
    expect(screen.getAllByRole("link", { name: "Iniciar sesión" }).some(link => link.getAttribute("href")?.startsWith("/sign-in"))).toBe(true);
  });

  it("explains a finished confirmation link and offers to request the change again", async () => {
    stubApi({ "POST /api/v1/auth/email-change/confirm": () => problem(410, "EMAIL_CHANGE_TOKEN_EXPIRED", "Enlace vencido", "Solicita el cambio otra vez desde tu perfil.") });
    renderPurchaseRoute(routes, `/confirmar-correo#token=${token}`, { role: null });
    expect(await screen.findByRole("alert")).toHaveTextContent("Enlace vencido. Solicita el cambio otra vez desde tu perfil.");
    expect(screen.getByRole("link", { name: "Ir a Mi perfil" })).toHaveAttribute("href", "/account");
  });

  it("never sends a missing or query-string token", async () => {
    const api = stubApi({});
    renderPurchaseRoute(routes, `/confirmar-correo?token=${token}`, { role: null });
    expect(await screen.findByRole("heading", { name: "Falta el enlace del correo" })).toBeInTheDocument();
    expect(api.count("POST", "/api/v1/auth/email-change/confirm")).toBe(0);
  });

  it("cancels from the current address only after an explicit press, then points to changing the password", async () => {
    const api = stubApi({ "POST /api/v1/auth/email-change/cancel": () => json({}) });
    const { router } = renderPurchaseRoute(routes, `/cancelar-cambio-correo#token=${token}`, { role: null });
    await waitFor(() => expect(router.state.location.hash).toBe(""));
    expect(await screen.findByRole("heading", { name: "¿No pediste este cambio?" })).toBeInTheDocument();
    // A link scanner that opens the page cancels nothing.
    expect(api.count("POST", "/api/v1/auth/email-change/cancel")).toBe(0);
    await userEvent.setup().click(screen.getByRole("button", { name: "Cancelar el cambio" }));
    expect(await screen.findByRole("heading", { name: "Cambio cancelado" })).toBeInTheDocument();
    expect(api.count("POST", "/api/v1/auth/email-change/cancel")).toBe(1);
    expect(api.calls.find(call => call.path === "/api/v1/auth/email-change/cancel")?.body).toEqual({ token });
    expect(screen.getByRole("link", { name: "Cambiar contraseña" })).toHaveAttribute("href", "/recuperar-contrasena");
  });

  it("sends a change that was already confirmed to Ayuda for recovery", async () => {
    stubApi({ "POST /api/v1/auth/email-change/cancel": () => problem(410, "EMAIL_CHANGE_ALREADY_CONFIRMED", "Cambio ya confirmado", "La dirección nueva ya está en uso.") });
    renderPurchaseRoute(routes, `/cancelar-cambio-correo#token=${token}`, { role: null });
    await userEvent.setup().click(await screen.findByRole("button", { name: "Cancelar el cambio" }));
    expect(await screen.findByRole("heading", { name: "El cambio ya se confirmó" })).toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent("Si no fuiste tú, escríbenos desde Ayuda para recuperarla.");
    expect(screen.getByRole("link", { name: "Ir a Ayuda" })).toHaveAttribute("href", "/ayuda");
  });
});
