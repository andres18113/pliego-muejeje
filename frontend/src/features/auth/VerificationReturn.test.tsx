import { act, configure, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { useLocation, type RouteObject } from "react-router-dom";
import { VerifyEmailPage } from "./EmailActionPages";
import { CustomerOnly } from "@/features/purchase/PurchaseChrome";
import { problem, renderPurchaseRoute, stubApi } from "@/test/purchase";

const token = "a".repeat(43);
function Destination() {
  const location = useLocation();
  return <output aria-label="Destino">{location.pathname + location.search + location.hash}</output>;
}
const routes = [
  { path: "/verificar-correo", element: <VerifyEmailPage /> },
  { path: "/", element: <Destination /> },
  { path: "/catalog", element: <Destination /> },
  { path: "/catalog/editions/:editionId", element: <Destination /> },
  { path: "/cart", element: <CustomerOnly intent="/cart" task="ver tu carrito"><Destination /></CustomerOnly> },
];

afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); configure({ reactStrictMode: false }); });

async function pendingVerification(from?: string, role: "CUSTOMER" | null = null, destinations: RouteObject[] = routes) {
  let finish!: (response: Response) => void;
  const api = stubApi({ "POST /api/v1/auth/verify-email": () => new Promise(resolve => { finish = resolve; }) });
  const path = `/verificar-correo${from === undefined ? "" : `?${new URLSearchParams({ from })}`}#token=${token}`;
  const view = renderPurchaseRoute(destinations, path, { role });
  await waitFor(() => expect(api.count("POST", "/api/v1/auth/verify-email")).toBe(1));
  await waitFor(() => expect(view.router.state.location.hash).toBe(""));
  vi.useFakeTimers();
  return { ...view, api, finish };
}

async function settle(finish: (response: Response) => void, response = new Response(null, { status: 204 })) {
  await act(async () => { finish(response); await vi.advanceTimersByTimeAsync(0); });
}

it.each([
  [undefined, "/"],
  ["/catalog?que=Gabriel+Garc%C3%ADa&sort=PRICE_ASC&page=2#results", "/catalog?que=Gabriel+Garc%C3%ADa&sort=PRICE_ASC&page=2#results"],
  ["/catalog/editions/42?source=search#details", "/catalog/editions/42?source=search#details"],
  ["https://example.invalid/account", "/"],
  ["//example.invalid/catalog", "/"],
  ["/admin", "/"],
  ["/sign-in?from=%2Fverificar-correo", "/"],
  ["/verificar-correo#token=unsafe", "/"],
])("automatically returns from %s to the validated destination %s after confirmed verification", async (from, destination) => {
  const { router, api, finish } = await pendingVerification(from);
  await settle(finish);
  expect(screen.getByRole("heading", { name: "Correo verificado" })).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "Continuar" })).toHaveAttribute("href", destination);
  await act(async () => vi.advanceTimersByTimeAsync(2_000));
  expect(screen.getByLabelText("Destino")).toHaveTextContent(destination);
  expect(router.state.historyAction).toBe("REPLACE");
  expect(api.count("POST", "/api/v1/auth/verify-email")).toBe(1);
  expect(api.count("POST", "/api/v1/auth/login")).toBe(0);
});

it("returns a guest to the protected cart without authenticating or issuing purchase commands", async () => {
  const { router, api, finish } = await pendingVerification("/cart?source=edition#items");
  await settle(finish);
  await act(async () => vi.advanceTimersByTimeAsync(2_000));
  expect(router.state.location.pathname).toBe("/cart");
  expect(screen.getByRole("heading", { name: "Inicia sesión para ver tu carrito." })).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "Iniciar sesión" })).toHaveAttribute("href", "/sign-in?from=%2Fcart%3Fsource%3Dedition%23items");
  expect(api.count("POST", "/api/v1/auth/login")).toBe(0);
  expect(api.count("POST", "/api/v1/checkout")).toBe(0);
  expect(api.count("GET", "/api/v1/cart")).toBe(0);
});

it("retains the existing customer session while returning to its protected destination", async () => {
  const { api, finish } = await pendingVerification("/cart", "CUSTOMER");
  await settle(finish);
  await act(async () => vi.advanceTimersByTimeAsync(2_000));
  expect(screen.getByLabelText("Destino")).toHaveTextContent("/cart");
  expect(api.count("POST", "/api/v1/auth/login")).toBe(0);
  expect(api.count("POST", "/api/v1/auth/reset-password")).toBe(0);
});

it.each([400, 503])("does not redirect an invalid or unconfirmed verification (%s)", async status => {
  const { router, finish } = await pendingVerification("/catalog?que=libros");
  await settle(finish, problem(status, status === 400 ? "EMAIL_ACTION_INVALID" : "UNAVAILABLE", "No disponible", "Solicita otro enlace."));
  expect(screen.getByRole("alert")).toBeInTheDocument();
  await act(async () => vi.advanceTimersByTimeAsync(3_000));
  expect(router.state.location.pathname).toBe("/verificar-correo");
});

it("cancels the automatic return if the user already navigated elsewhere", async () => {
  const { router, finish } = await pendingVerification("/catalog/editions/42");
  await settle(finish);
  await act(async () => { await router.navigate("/catalog?que=otra"); });
  await act(async () => vi.advanceTimersByTimeAsync(2_000));
  expect(screen.getByLabelText("Destino")).toHaveTextContent("/catalog?que=otra");
});

it("does not replace the user's next navigation while its page is still loading", async () => {
  let finishDestination!: (value: null) => void;
  const destinations = [...routes, { path: "/ofertas", loader: () => new Promise<null>(resolve => { finishDestination = resolve; }), element: <Destination /> }];
  const { router, finish } = await pendingVerification("/catalog/editions/42", null, destinations);
  await settle(finish);
  act(() => { void router.navigate("/ofertas"); });
  expect(router.state.navigation.location?.pathname).toBe("/ofertas");
  await act(async () => vi.advanceTimersByTimeAsync(2_000));
  expect(router.state.navigation.location?.pathname).toBe("/ofertas");
  expect(router.state.location.pathname).toBe("/verificar-correo");
  await act(async () => { finishDestination(null); await vi.advanceTimersByTimeAsync(0); });
  expect(screen.getByLabelText("Destino")).toHaveTextContent("/ofertas");
});

it("cancels an earlier success redirect when a different link is being verified", async () => {
  let finishFresh!: (response: Response) => void;
  const { router, api, finish } = await pendingVerification("/catalog/editions/42");
  await settle(finish);
  // Replace the request fixture while retaining the mounted page and its old success.
  const originalFetch = globalThis.fetch;
  vi.stubGlobal("fetch", async (request: Request) => {
    if (request.url.endsWith("/api/v1/auth/verify-email")) return new Promise<Response>(resolve => { finishFresh = resolve; });
    return originalFetch(request);
  });
  await act(async () => { await router.navigate(`/verificar-correo?from=%2Fcatalog%3Fque%3Dnueva#token=${"b".repeat(43)}`); await vi.advanceTimersByTimeAsync(0); });
  expect(screen.getByRole("status")).toHaveTextContent("Estamos comprobando el enlace");
  await act(async () => vi.advanceTimersByTimeAsync(2_000));
  expect(router.state.location.pathname).toBe("/verificar-correo");
  await settle(finishFresh);
  await act(async () => vi.advanceTimersByTimeAsync(2_000));
  expect(screen.getByLabelText("Destino")).toHaveTextContent("/catalog?que=nueva");
  expect(api.count("POST", "/api/v1/auth/verify-email")).toBe(1);
});

it("returns once under Strict Mode without replaying verification", async () => {
  configure({ reactStrictMode: true });
  const { router, api, finish } = await pendingVerification();
  await settle(finish);
  await act(async () => vi.advanceTimersByTimeAsync(2_000));
  expect(router.state.location.pathname).toBe("/");
  expect(api.count("POST", "/api/v1/auth/verify-email")).toBe(1);
});
