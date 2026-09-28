import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SessionProvider, useSession } from "./session";
import { logoutSession, refreshSession } from "@/shared/api/auth";

vi.mock("@/shared/api/auth", () => ({
  logoutSession: vi.fn(),
  refreshSession: vi.fn(),
}));

const mockRefresh = vi.mocked(refreshSession);
const mockLogout = vi.mocked(logoutSession);

function Probe() {
  const { session, expired, restoreState, clear, logout, retryRestore } = useSession();
  if (restoreState === "restoring") return <p role="status">Comprobando sesión</p>;
  if (restoreState === "unavailable") return <button onClick={() => void retryRestore()}>Reintentar</button>;
  return (
    <section>
      <p>{session ? `${session.user.role}:${session.user.email}` : expired ? "Sesión vencida" : "Guest"}</p>
      <button onClick={() => void logout()}>Cerrar sesión</button>
      <button onClick={() => clear("expired")}>Forzar restauración</button>
    </section>
  );
}

function renderSession() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <SessionProvider>
        <Probe />
      </SessionProvider>
    </QueryClientProvider>,
  );
}

function restoredSession(role: "CUSTOMER" | "ADMIN" = "CUSTOMER") {
  return {
    accessToken: "memory-only-access-token",
    tokenType: "Bearer" as const,
    expiresInSeconds: 1800,
    user: { userId: "100", email: "ana@example.com", role },
  };
}

afterEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  sessionStorage.clear();
});

describe("persistent session restoration", () => {
  it("keeps Guest hidden until the backend restores the CUSTOMER session", async () => {
    let resolveRestore: ((value: ReturnType<typeof restoredSession> | null) => void) | undefined;
    mockRefresh.mockImplementation(() => new Promise((resolve) => { resolveRestore = resolve; }));
    renderSession();

    expect(screen.getByRole("status")).toHaveTextContent("Comprobando sesión");
    expect(screen.queryByText("Guest")).not.toBeInTheDocument();
    await act(async () => { resolveRestore?.(restoredSession("CUSTOMER")); });

    expect(screen.getByText("CUSTOMER:ana@example.com")).toBeInTheDocument();
    expect(mockRefresh).toHaveBeenCalledTimes(1);
    expect(localStorage.length).toBe(0);
    expect(sessionStorage.length).toBe(0);
  });

  it("restores ADMIN with the backend role and expires an invalid session to Guest", async () => {
    mockRefresh.mockResolvedValueOnce(restoredSession("ADMIN")).mockResolvedValueOnce(null);
    renderSession();
    expect(await screen.findByText("ADMIN:ana@example.com")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Forzar restauración" }));
    expect(await screen.findByText("Sesión vencida")).toBeInTheDocument();
    expect(mockRefresh).toHaveBeenCalledTimes(2);
  });

  it("revokes the backend session before clearing the local authenticated state", async () => {
    mockRefresh.mockResolvedValueOnce(restoredSession("CUSTOMER"));
    renderSession();
    expect(await screen.findByText("CUSTOMER:ana@example.com")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Cerrar sesión" }));
    expect(await screen.findByText("Guest")).toBeInTheDocument();
    expect(mockLogout).toHaveBeenCalledTimes(1);
  });
});
