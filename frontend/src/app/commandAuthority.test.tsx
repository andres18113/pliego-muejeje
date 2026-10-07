import { act, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { QueryClient } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useSession } from "@/app/session";
import { useCartControl, useFavoriteControl } from "@/features/catalog/useBookCardActions";
import { CartPage } from "@/features/purchase/CartPage";
import { OrderPage } from "@/features/purchase/OrderPage";
import { cartBody, json, problem, renderPurchaseRoute, stubApi } from "@/test/purchase";
import { orderDetailFixture } from "@/test/orders";

function deferredResponse() {
  let resolve!: (response: Response) => void;
  const promise = new Promise<Response>((accept) => { resolve = accept; });
  return { promise, resolve };
}

/** Mutations still publish their final action after identity changes evict them from the cache. */
function mutationCompletion(queryClient: QueryClient) {
  return new Promise<void>((resolve) => {
    const unsubscribe = queryClient.getMutationCache().subscribe((event) => {
      if (event.type !== "updated" || (event.action.type !== "success" && event.action.type !== "error")) return;
      unsubscribe();
      resolve();
    });
  });
}

async function settle(response: ReturnType<typeof deferredResponse>, completion: Promise<void>, value: Response) {
  await act(async () => {
    response.resolve(value);
    await completion;
  });
}

function IdentityShell({ children }: { children: ReactNode }) {
  const { session, establish } = useSession();
  return <>
    <output aria-label="Cuenta actual">{session?.user.userId ?? "guest"}</output>
    <button type="button" onClick={() => establish({
      accessToken: "synthetic-actor-b", expiresAt: Date.now() + 1_800_000,
      user: { userId: "3", email: "b@example.invalid", role: "CUSTOMER" },
    })}>Cambiar a B</button>
    {children}
  </>;
}

function CartAction() {
  const control = useCartControl({ editionId: "42", available: true, format: "PAPERBACK", returnHref: "/catalog", onFeedback: () => undefined });
  return <button type="button" onClick={"onPress" in control ? control.onPress : undefined}>Agregar edición</button>;
}

function FavoriteAction() {
  const { session } = useSession();
  const control = useFavoriteControl({ editionId: "42", isFavorite: false, ready: true,
    queryKey: ["customer-favorite-status", session?.user.userId, ["42"]], returnHref: "/catalog", onFeedback: () => undefined });
  return <button type="button" onClick={"onPress" in control ? control.onPress : undefined}>Guardar favorito</button>;
}

async function switchToB(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole("button", { name: "Cambiar a B" }));
  expect(screen.getByLabelText("Cuenta actual")).toHaveTextContent("3");
}

const expired = () => problem(401, "UNAUTHORIZED", "Sesión caducada", "Vuelve a iniciar sesión.");
afterEach(() => vi.unstubAllGlobals());

describe("commands issued by a previous account", () => {
  it("does not add to B's cart when A's preflight finishes after switching accounts", async () => {
    const preflight = deferredResponse();
    const api = stubApi({ "GET /api/v1/cart": () => preflight.promise,
      "POST /api/v1/cart/items": () => json({ cartId: "99", cartItemId: "101", quantity: 1 }, 201) });
    const { queryClient, router } = renderPurchaseRoute([{ path: "/catalog", element: <IdentityShell><CartAction /></IdentityShell> }], "/catalog");
    const completion = mutationCompletion(queryClient), user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Agregar edición" }));
    await waitFor(() => expect(api.count("GET", "/api/v1/cart")).toBe(1));
    await switchToB(user);
    await settle(preflight, completion, json(cartBody([])));
    expect(api.count("POST", "/api/v1/cart/items")).toBe(0);
    expect(screen.getByLabelText("Cuenta actual")).toHaveTextContent("3");
    expect(router.state.location.pathname).toBe("/catalog");
  });

  it("keeps B signed in when A's favorite command returns a late 401", async () => {
    const response = deferredResponse();
    const api = stubApi({ "PUT /api/v1/me/favorites/42": () => response.promise });
    const { queryClient, router } = renderPurchaseRoute([
      { path: "/catalog", element: <IdentityShell><FavoriteAction /></IdentityShell> },
      { path: "/sign-in", element: <p>Iniciar sesión</p> },
    ], "/catalog");
    const completion = mutationCompletion(queryClient), user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Guardar favorito" }));
    await waitFor(() => expect(api.count("PUT", "/api/v1/me/favorites/42")).toBe(1));
    await switchToB(user);
    await settle(response, completion, expired());
    expect(screen.getByLabelText("Cuenta actual")).toHaveTextContent("3");
    expect(router.state.location.pathname).toBe("/catalog");
  });

  it("keeps B signed in when A's cart removal returns a late 401", async () => {
    const response = deferredResponse();
    const api = stubApi({
      "GET /api/v1/cart": (request) => json(request.headers.get("Authorization") === "Bearer synthetic-actor-b" ? cartBody([]) : cartBody()),
      "DELETE /api/v1/cart/items/100": () => response.promise,
    });
    const { queryClient } = renderPurchaseRoute([{ path: "/cart", element: <IdentityShell><CartPage /></IdentityShell> }], "/cart");
    const completion = mutationCompletion(queryClient), user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Quitar Cien años de soledad del carrito" }));
    await waitFor(() => expect(api.count("DELETE", "/api/v1/cart/items/100")).toBe(1));
    await switchToB(user);
    await settle(response, completion, expired());
    expect(screen.getByLabelText("Cuenta actual")).toHaveTextContent("3");
  });

  it("keeps B signed in when A's order cancellation returns a late 401", async () => {
    const response = deferredResponse();
    const api = stubApi({
      "GET /api/v1/orders/700": (request) => request.headers.get("Authorization") === "Bearer synthetic-actor-b"
        ? problem(404, "P5001", "Pedido no disponible", "No encontramos el pedido.") : json(orderDetailFixture()),
      "POST /api/v1/orders/700/cancel": () => response.promise,
    });
    const { queryClient } = renderPurchaseRoute([{ path: "/orders/:orderId", element: <IdentityShell><OrderPage /></IdentityShell> }], "/orders/700");
    const completion = mutationCompletion(queryClient), user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Cancelar pedido" }));
    await user.click(await screen.findByRole("button", { name: "Confirmar cancelación" }));
    await waitFor(() => expect(api.count("POST", "/api/v1/orders/700/cancel")).toBe(1));
    await switchToB(user);
    await settle(response, completion, expired());
    expect(screen.getByLabelText("Cuenta actual")).toHaveTextContent("3");
  });
});


function RefreshIdentityShell({ children }: { children: ReactNode }) {
  const { session, retryRestore } = useSession();
  return <>
    <output aria-label="Cuenta actual">{session?.user.userId ?? "guest"}</output>
    <output aria-label="Estado de renovación">{session?.accessToken === "synthetic-renewed-a" ? "renovada" : "original"}</output>
    <button type="button" onClick={() => void retryRestore()}>Renovar sesión</button>
    {children}
  </>;
}

it("keeps the renewed customer session when an older favorite request returns 401", async () => {
  const response = deferredResponse();
  const api = stubApi({
    "PUT /api/v1/me/favorites/42": () => response.promise,
    "GET /api/v1/me/favorites/status": () => json([{ editionId: "42", favorite: false }]),
    "POST /api/v1/auth/refresh": () => json({ accessToken: "synthetic-renewed-a", tokenType: "Bearer", expiresInSeconds: 1800,
      user: { userId: "2", email: "ana@example.com", role: "CUSTOMER" } }),
  });
  const { queryClient, router } = renderPurchaseRoute([
    { path: "/catalog", element: <RefreshIdentityShell><FavoriteAction /></RefreshIdentityShell> },
    { path: "/sign-in", element: <p>Iniciar sesión</p> },
  ], "/catalog");
  const completion = mutationCompletion(queryClient), user = userEvent.setup();
  await user.click(screen.getByRole("button", { name: "Guardar favorito" }));
  await waitFor(() => expect(api.count("PUT", "/api/v1/me/favorites/42")).toBe(1));
  expect(api.calls.find((call) => call.method === "PUT")?.headers.get("Authorization")).toBe("Bearer customer-token");
  await user.click(screen.getByRole("button", { name: "Renovar sesión" }));
  await waitFor(() => expect(screen.getByLabelText("Estado de renovación")).toHaveTextContent("renovada"));
  await settle(response, completion, expired());
  expect(screen.getByLabelText("Cuenta actual")).toHaveTextContent("2");
  expect(screen.getByLabelText("Estado de renovación")).toHaveTextContent("renovada");
  expect(router.state.location.pathname).toBe("/catalog");
  expect(api.count("PUT", "/api/v1/me/favorites/42")).toBe(1);
});
