import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SessionProvider, useSession, type AuthSession } from "./session";
import { logoutSession, refreshSession } from "@/shared/api/auth";
import { apiClient, setApiAccessToken } from "@/shared/api/client";

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
  vi.unstubAllGlobals();
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

describe("session identity boundaries", () => {
  function setupBoundary() {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    let controls: ReturnType<typeof useSession>;
    function BoundaryProbe() {
      controls = useSession();
      return <p>{controls.session?.user.email ?? "Guest"}</p>;
    }
    const view = render(<QueryClientProvider client={client}><SessionProvider restoreOnMount={false}><BoundaryProbe /></SessionProvider></QueryClientProvider>);
    return { client, get controls() { return controls!; }, ...view };
  }
  function identity(userId: string, email: string): AuthSession {
    return { accessToken: `token-${userId}`, expiresAt: Date.now() + 1_800_000, user: { userId, email, role: "CUSTOMER" } };
  }

  it("removes private A caches before establishing B while retaining public catalog data", () => {
    const boundary = setupBoundary();
    act(() => boundary.controls.establish(identity("100", "ana@example.com")));
    boundary.client.setQueryDefaults(["customer-profile"], { meta: { authRequired: true } });
    boundary.client.setQueryData(["customer-profile"], { email: "ana@example.com" });
    boundary.client.setQueryData(["catalog"], { title: "Libro público" });
    act(() => boundary.controls.establish(identity("200", "bea@example.com")));
    expect(screen.getByText("bea@example.com")).toBeInTheDocument();
    expect(boundary.client.getQueryData(["customer-profile"])).toBeUndefined();
    expect(boundary.client.getQueryData(["catalog"])).toEqual({ title: "Libro público" });
  });

  it.each(["clear", "replace"] as const)("ignores a pending restore after %s changes the session", async (change) => {
    let resolve: (value: ReturnType<typeof restoredSession>) => void = () => {};
    mockRefresh.mockImplementationOnce(() => new Promise((done) => { resolve = done; }));
    const boundary = setupBoundary();
    act(() => boundary.controls.establish(identity("100", "ana@example.com")));
    let restore: Promise<void>;
    act(() => { restore = boundary.controls.retryRestore(); });
    act(() => {
      if (change === "clear") boundary.controls.clear();
      else boundary.controls.establish(identity("200", "bea@example.com"));
    });
    await act(async () => { resolve(restoredSession()); await restore!; });
    expect(screen.getByText(change === "clear" ? "Guest" : "bea@example.com")).toBeInTheDocument();
    expect(boundary.controls.restoreState).toBe("ready");
  });

  it("ignores a late restore failure after establishing another identity", async () => {
    let reject: (reason: Error) => void = () => {};
    mockRefresh.mockImplementationOnce(() => new Promise((_, fail) => { reject = fail; }));
    const boundary = setupBoundary();
    let restore: Promise<void>;
    act(() => { restore = boundary.controls.retryRestore(); });
    act(() => boundary.controls.establish(identity("200", "bea@example.com")));
    await act(async () => { reject(new Error("offline")); await restore!; });
    expect(boundary.controls.restoreState).toBe("ready");
    expect(screen.getByText("bea@example.com")).toBeInTheDocument();
  });

  it("cancels in-flight private reads during an identity change", async () => {
    const boundary = setupBoundary();
    act(() => boundary.controls.establish(identity("100", "ana@example.com")));
    let aborted = false;
    const pending = boundary.client.fetchQuery({ queryKey: ["customer-profile"], meta: { authRequired: true }, queryFn: ({ signal }) => new Promise(resolve => {
      signal.addEventListener("abort", () => { aborted = true; resolve({ email: "ana@example.com" }); });
    }) }).catch(() => undefined);
    act(() => boundary.controls.establish(identity("200", "bea@example.com")));
    await pending;
    expect(aborted).toBe(true);
    expect(boundary.client.getQueryData(["customer-profile"])).toBeUndefined();
  });

  it("synchronizes another tab's identity change through the cookie without retaining A data", async () => {
    const channels: { onmessage: ((event: { data: string }) => void) | null }[] = [];
    class Channel {
      onmessage: ((event: { data: string }) => void) | null = null;
      constructor() { channels.push(this); }
      postMessage() {}
      close() {}
    }
    vi.stubGlobal("BroadcastChannel", Channel);
    mockRefresh.mockResolvedValueOnce({ ...restoredSession(), accessToken: "token-200", user: { userId: "200", email: "bea@example.com", role: "CUSTOMER" } });
    const boundary = setupBoundary();
    act(() => boundary.controls.establish(identity("100", "ana@example.com")));
    boundary.client.setQueryDefaults(["customer-profile"], { meta: { authRequired: true } });
    boundary.client.setQueryData(["customer-profile"], { email: "ana@example.com" });
    await act(async () => { channels.find(channel => channel.onmessage)?.onmessage?.({ data: "changed" }); });
    expect(screen.getByText("bea@example.com")).toBeInTheDocument();
    expect(boundary.client.getQueryData(["customer-profile"])).toBeUndefined();
  });

  it("clears a successful logout even when a same-user refresh finished while it waited", async () => {
    let refresh: (value: ReturnType<typeof restoredSession>) => void = () => {};
    let finishLogout: () => void = () => {};
    mockRefresh.mockImplementationOnce(() => new Promise(done => { refresh=done; }));
    mockLogout.mockImplementationOnce(() => new Promise(done => { finishLogout=done; }));
    const boundary=setupBoundary();
    act(() => boundary.controls.establish(identity("100","ana@example.com")));
    let restore: Promise<void>,logout: Promise<void>;
    act(() => { restore=boundary.controls.retryRestore(); logout=boundary.controls.logout(); });
    await act(async () => { refresh(restoredSession()); await restore!; });
    await act(async () => { finishLogout(); await logout!; });
    expect(screen.getByText("Guest")).toBeInTheDocument();
  });

  it("does not let an unmounted provider's restore overwrite a newer provider token", async () => {
    let finish: (value: ReturnType<typeof restoredSession>) => void = () => {};
    mockRefresh.mockImplementationOnce(() => new Promise(done => { finish=done; }));
    const boundary=setupBoundary(); let restore: Promise<void>;
    act(() => { restore=boundary.controls.retryRestore(); });
    boundary.unmount();
    setApiAccessToken("new-provider-B");
    await act(async () => { finish(restoredSession()); await restore!; });
    const fetch=vi.fn(async (_request: Request) => new Response("{}",{status:200,headers:{"Content-Type":"application/json"}}));
    vi.stubGlobal("fetch",fetch);
    await apiClient.GET("/api/v1/me");
    expect((fetch.mock.calls[0][0] as Request).headers.get("Authorization")).toBe("Bearer new-provider-B");
  });

  it("retires the original authority across A to B to A without invalidating normal token rotation", async () => {
    const boundary=setupBoundary();
    act(()=>boundary.controls.establish(identity("100","ana@example.com")));
    const original=boundary.controls.captureAuthority(boundary.controls.session);
    mockRefresh.mockResolvedValueOnce({...restoredSession(),accessToken:"renewed-A"});
    await act(async()=>{await boundary.controls.retryRestore();});
    expect(original.isCurrent()).toBe(true);
    act(()=>boundary.controls.establish(identity("200","bea@example.com")));
    act(()=>boundary.controls.establish(identity("100","ana@example.com")));
    expect(original.isCurrent()).toBe(false);
    expect(boundary.controls.captureAuthority(boundary.controls.session).isCurrent()).toBe(true);
  });

  it("removes private mutation records at identity replacement while retaining public cache", async () => {
    const boundary=setupBoundary();
    act(()=>boundary.controls.establish(identity("100","ana@example.com")));
    const mutation=boundary.client.getMutationCache().build(boundary.client,{meta:{authRequired:true},mutationFn:async()=>({recipient:"Ana"})});
    await mutation.execute(undefined);
    boundary.client.setQueryData(["catalog"],{title:"Libro público"});
    act(()=>boundary.controls.establish(identity("200","bea@example.com")));
    expect(boundary.client.getMutationCache().getAll()).toHaveLength(0);
    expect(boundary.client.getQueryData(["catalog"])).toEqual({title:"Libro público"});
  });
});
