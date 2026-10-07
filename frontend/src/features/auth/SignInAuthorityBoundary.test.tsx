import { act, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useSession } from "@/app/session";
import { login } from "@/shared/api/auth";
import { setApiAccessToken } from "@/shared/api/client";
import { renderPurchaseRoute } from "@/test/purchase";
import { SignInPage } from "@/features/auth/AuthPages";

vi.mock("@/shared/api/auth", () => ({
  login: vi.fn(), register: vi.fn(), logoutSession: vi.fn().mockResolvedValue(undefined),
  refreshSession: vi.fn().mockResolvedValue(null),
}));
const mockLogin = vi.mocked(login);
const response = {
  accessToken: "token-A", tokenType: "Bearer" as const, expiresInSeconds: 1800,
  user: { userId: "2", email: "ana@example.com", role: "CUSTOMER" as const },
};

function setupSignIn() {
  function Probe({ signIn = false }: { signIn?: boolean }) {
    const { session, establish } = useSession();
    return <>
      <output aria-label="Sesión actual">{session?.user.email ?? "Sin sesión"}</output>
      {signIn && <>
        <button onClick={() => establish({
          accessToken: "token-B", expiresAt: Date.now() + 1_800_000,
          user: { userId: "3", email: "bea@example.com", role: "CUSTOMER" },
        })}>Establecer otra sesión</button>
        <SignInPage />
      </>}
    </>;
  }
  return renderPurchaseRoute([
    { path: "/sign-in", element: <Probe signIn /> },
    { path: "/account", element: <Probe /> },
    { path: "/catalog", element: <Probe /> },
  ], "/sign-in?from=%2Faccount", { role: null });
}

async function submitSignIn() {
  const user = userEvent.setup();
  await user.type(screen.getByLabelText("Correo electrónico"), "ana@example.com");
  await user.type(screen.getByLabelText("Contraseña"), "Lectura-segura-2026");
  await user.click(screen.getByRole("button", { name: "Iniciar sesión" }));
  await waitFor(() => expect(mockLogin).toHaveBeenCalledTimes(1));
  return user;
}

describe("sign-in authority and view boundaries", () => {
  afterEach(() => { vi.clearAllMocks(); setApiAccessToken(null); });

  it("preserves newer credentials when an earlier sign-in response arrives", async () => {
    let finish!: (value: typeof response) => void;
    const pending = new Promise<typeof response>(resolve => { finish = resolve; });
    mockLogin.mockReturnValueOnce(pending);
    const { router } = setupSignIn();
    const user = await submitSignIn();
    await user.click(screen.getByRole("button", { name: "Establecer otra sesión" }));
    await act(async () => { finish(response); await pending; });
    expect(screen.getByLabelText("Sesión actual")).toHaveTextContent("bea@example.com");
    expect(router.state.location.pathname).toBe("/sign-in");
  });

  it("does not establish credentials or redirect after leaving the pending sign-in view", async () => {
    let finish!: (value: typeof response) => void;
    const pending = new Promise<typeof response>(resolve => { finish = resolve; });
    mockLogin.mockReturnValueOnce(pending);
    const { router } = setupSignIn();
    await submitSignIn();
    await act(async () => { await router.navigate("/catalog"); });
    await act(async () => { finish(response); await pending; });
    expect(screen.getByLabelText("Sesión actual")).toHaveTextContent("Sin sesión");
    expect(router.state.location.pathname).toBe("/catalog");
  });

  it("does not redirect from a completed sign-in after the reader moves to another view", async () => {
    mockLogin.mockResolvedValueOnce(response);
    const { router } = setupSignIn();
    await submitSignIn();
    await waitFor(() => expect(screen.getByLabelText("Sesión actual")).toHaveTextContent("ana@example.com"));
    await act(async () => { await router.navigate("/catalog"); });
    await act(async () => {
      await new Promise<void>(resolve => window.setTimeout(resolve, 250));
    });
    expect(router.state.location.pathname).toBe("/catalog");
  });
});
