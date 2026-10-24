import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createMemoryRouter, useLocation, Outlet, RouterProvider } from "react-router-dom";
import { expect, it, vi } from "vitest";
import { SignInPage } from "@/features/auth/AuthPages";
import { login } from "@/shared/api/auth";

vi.mock("@/shared/api/auth", () => ({ login: vi.fn() }));
import { SessionProvider, useSession } from "@/app/session";
import { BackNavigationProvider } from "./BackNavigationProvider";
import { useBackNavigation } from "./useBackNavigation";

function SessionControls() {
  const { establish, clear } = useSession();
  return <><button onClick={() => establish({ accessToken: "synthetic-navigation-session", expiresAt: Date.now() + 600000, user: { userId: "1", email: "navigation@example.invalid", role: "CUSTOMER" } })}>Login A</button><button onClick={() => clear()}>Logout</button></>;
}
function Probe() {
  const back = useBackNavigation();
  return <><button onClick={back.goBack}>Atrás</button><output>{String(back.canGoBack)}</output></>;
}
function setup(initialEntries: string[]) {
  const router = createMemoryRouter([{ path: "*", element: <BackNavigationProvider><SessionControls /><Probe /><Outlet /></BackNavigationProvider> }], { initialEntries });
  render(<QueryClientProvider client={new QueryClient()}><SessionProvider restoreOnMount={false}><RouterProvider router={router} /></SessionProvider></QueryClientProvider>);
  return router;
}
it("uses replace fallback on direct entry despite external/unknown browser predecessor", async () => {
  const router = setup(["/outside", "/catalog/editions/12"]);
  fireEvent.click(screen.getByText("Atrás"));
  await waitFor(() => expect(router.state.location.pathname).toBe("/catalog"));
  expect(router.state.historyAction).toBe("REPLACE");
});
it("skips grouped filters using known physical entries", async () => {
  const router = setup(["/ayuda"]);
  await act(async () => { await router.navigate("/catalog?que=uno"); });
  await act(async () => { await router.navigate("/catalog?que=dos"); });
  fireEvent.click(screen.getByText("Atrás"));
  await waitFor(() => expect(router.state.location.pathname).toBe("/ayuda"));
  expect(router.state.historyAction).toBe("POP");
});
it("hides return at the public root without a predecessor", () => {
  setup(["/"]);
  expect(screen.getByText("false")).toBeInTheDocument();
});
it("never returns to an auth form after leaving it", async () => {
  const router = setup(["/catalog"]);
  await act(async () => { await router.navigate("/sign-in?from=%2Fcart"); });
  await act(async () => { await router.navigate("/ayuda"); });
  fireEvent.click(screen.getByText("Atrás"));
  await waitFor(() => expect(router.state.location.pathname).toBe("/catalog"));
});
it("invalidates a late callback across A-B-A even when POP restores the same location key", async () => {
  let captured: (() => void) | undefined;
  function Capture() { captured = useBackNavigation().goBack; return <Probe />; }
  const router = createMemoryRouter([{ path: "*", element: <BackNavigationProvider><Capture /></BackNavigationProvider> }], { initialEntries: ["/ayuda"] });
  render(<QueryClientProvider client={new QueryClient()}><SessionProvider restoreOnMount={false}><RouterProvider router={router} /></SessionProvider></QueryClientProvider>);
  await act(async () => { await router.navigate("/catalog"); });
  const stale = captured!;
  await act(async () => { await router.navigate("/ofertas"); });
  await act(async () => { await router.navigate(-1); });
  await act(async () => { stale(); });
  expect(router.state.location.pathname).toBe("/catalog");
});
it("coalesces two activations before navigation commits", async () => {
  let goBack: (() => void) | undefined;
  function Capture() { goBack = useBackNavigation().goBack; return <Probe />; }
  const router = createMemoryRouter([{ path: "*", element: <BackNavigationProvider><Capture /></BackNavigationProvider> }], { initialEntries: ["/ayuda"] });
  render(<QueryClientProvider client={new QueryClient()}><SessionProvider restoreOnMount={false}><RouterProvider router={router} /></SessionProvider></QueryClientProvider>);
  await act(async () => { await router.navigate("/ofertas"); });
  await act(async () => { await router.navigate("/catalog"); });
  await act(async () => { goBack!(); goBack!(); });
  expect(router.state.location.pathname).toBe("/ofertas");
});

it.each(["/checkout", "/checkout/", "/checkout///"])("blocks native POP to retired %s before mounting its page", async checkoutPath => {
  let checkoutMounts = 0;
  function Page() { const { pathname } = useLocation(); if (pathname.startsWith("/checkout")) checkoutMounts++; return <Probe />; }
  const router = createMemoryRouter([{ path: "*", element: <BackNavigationProvider><SessionControls /><Page /></BackNavigationProvider> }], { initialEntries: ["/cart"] });
  render(<QueryClientProvider client={new QueryClient()}><SessionProvider restoreOnMount={false}><RouterProvider router={router} /></SessionProvider></QueryClientProvider>);
  fireEvent.click(screen.getByText("Login A"));
  await act(async () => { await router.navigate(`${checkoutPath}?method=TRANSFER#payment`); });
  await act(async () => { await router.navigate("/cart"); });
  await act(async () => { await router.navigate("/checkout"); });
  await act(async () => { await router.navigate("/orders/12", { replace: true, state: { purchased: true } }); });
  const before = checkoutMounts;
  await act(async () => { await router.navigate(-2); });
  await waitFor(() => expect(router.state.location.pathname).toBe("/cart"));
  expect(checkoutMounts).toBe(before);
});
it("invalidates private return predecessors after logout", async () => {
  const router = setup(["/catalog"]);
  fireEvent.click(screen.getByText("Login A"));
  await act(async () => { await router.navigate("/orders"); });
  await act(async () => { await router.navigate("/ayuda"); });
  fireEvent.click(screen.getByText("Logout"));
  fireEvent.click(screen.getByText("Atrás"));
  await waitFor(() => expect(router.state.location.pathname).toBe("/"));
});
it("does not mount a consumed auth form after a native POP", async () => {
  const router = setup(["/catalog"]);
  await act(async () => { await router.navigate("/restablecer-contrasena?token=synthetic"); });
  await act(async () => { await router.navigate("/ayuda"); });
  await act(async () => { await router.navigate(-1); });
  await waitFor(() => expect(router.state.location.pathname).toBe("/"));
});

it("lets real sign-in complete its edition return after establishing authority", async () => {
  vi.mocked(login).mockResolvedValueOnce({ accessToken: "synthetic-auth-return", tokenType: "Bearer", expiresInSeconds: 1800, user: { userId: "10", email: "navigation@example.invalid", role: "CUSTOMER" } });
  const destination = "/catalog/editions/12?from=%2Fofertas#edition";
  const router = createMemoryRouter([{
    element: <BackNavigationProvider><Outlet /></BackNavigationProvider>,
    children: [
      { path: "/sign-in", element: <SignInPage /> },
      { path: "/catalog/editions/12", element: <h1>Edición de origen</h1> },
      { path: "/", element: <h1>Inicio inesperado</h1> },
    ],
  }], { initialEntries: [`/sign-in?from=${encodeURIComponent(destination)}`] });
  render(<QueryClientProvider client={new QueryClient()}><SessionProvider restoreOnMount={false}><RouterProvider router={router} /></SessionProvider></QueryClientProvider>);
  fireEvent.change(screen.getByLabelText("Correo electrónico"), { target: { value: "navigation@example.invalid" } });
  fireEvent.change(screen.getByLabelText("Contraseña"), { target: { value: "synthetic-password" } });
  fireEvent.click(screen.getByRole("button", { name: "Iniciar sesión" }));
  await screen.findByRole("heading", { name: "Edición de origen" });
  expect(`${router.state.location.pathname}${router.state.location.search}${router.state.location.hash}`).toBe(destination);
  expect(router.state.historyAction).toBe("REPLACE");
});
