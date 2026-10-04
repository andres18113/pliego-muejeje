import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { PliegoThemeProvider } from "@/theme/PliegoThemeProvider";
import { render } from "@testing-library/react";
import { useEffect, useState, type ReactNode } from "react";
import { createMemoryRouter, RouterProvider, type RouteObject } from "react-router-dom";
import { vi } from "vitest";
import { SessionProvider, useSession } from "@/app/session";

export type Handler = (request: Request) => Response | Promise<Response>;

/** Routes fetch calls by "METHOD /path" and records every request for assertions. */
export function stubApi(routes: Record<string, Handler | Handler[]>) {
  const calls: { method: string; path: string; body: unknown }[] = [];
  const queues = new Map(Object.entries(routes).map(([key, value]) => [key, Array.isArray(value) ? [...value] : value]));
  const fetchMock = vi.fn(async (request: Request) => {
    const url = new URL(request.url);
    const key = `${request.method} ${url.pathname}`;
    const text = request.method === "GET" || request.method === "DELETE" ? "" : await request.clone().text();
    calls.push({ method: request.method, path: url.pathname + url.search, body: text ? JSON.parse(text) : undefined });
    const entry = queues.get(key);
    if (!entry && key === "POST /api/v1/auth/refresh") return new Response(null, { status: 204 });
    if (!entry && key === "POST /api/v1/auth/logout") return new Response(null, { status: 204 });
    if (!entry && key === "GET /api/v1/reference/countries") return json([{ code: "EC", name: "Ecuador" }, { code: "CO", name: "Colombia" }]);
    if (!entry && key === "GET /api/v1/reference/transfer-details") return json({ bank: "Banco Guayaquil", beneficiary: "PLIEGO", accountType: "Ahorros", accountNumber: "2557897233", identification: "1751550656" });
    if (!entry && key === "GET /api/v1/me") return json({ customerId: "2", email: "ana@example.com", firstNames: "Ana", lastNames: "Pérez", phone: null, state: "ACTIVE" });
    if (!entry) return json({ title: "Sin ruta de prueba", detail: key }, 599);
    if (Array.isArray(entry)) {
      const next = entry.length > 1 ? entry.shift()! : entry[0];
      return next(request);
    }
    return entry(request);
  });
  vi.stubGlobal("fetch", fetchMock);
  return { calls, fetchMock, count: (method: string, path: string) => calls.filter((call) => call.method === method && call.path.startsWith(path)).length };
}

export function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": status >= 400 ? "application/problem+json" : "application/json" },
  });
}

export function problem(status: number, code: string, title: string, detail: string) {
  return json({ type: `urn:pliego:problem:${code}`, title, status, detail, code, traceId: "trace" }, status);
}

function SignedIn({ role, children }: { role: "CUSTOMER" | "ADMIN" | null; children: ReactNode }) {
  const { establish } = useSession();
  const [ready, setReady] = useState(role === null);
  useEffect(() => {
    if (role === null) return;
    establish({
      accessToken: "customer-token",
      expiresAt: Date.now() + 1_800_000,
      user: { userId: "2", email: "ana@example.com", role },
    });
    setReady(true);
    // Sign in once; `establish` changes identity whenever the session changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return ready ? <>{children}</> : null;
}

export function renderPurchaseRoute(
  routes: RouteObject[],
  initialEntry: string,
  { role = "CUSTOMER" }: { role?: "CUSTOMER" | "ADMIN" | null } = {},
) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const router = createMemoryRouter(routes, { initialEntries: [initialEntry] });
  const view = render(
    <PliegoThemeProvider><QueryClientProvider client={queryClient}>
      <SessionProvider restoreOnMount={false}>
        <SignedIn role={role}>
          <RouterProvider router={router} />
        </SignedIn>
      </SessionProvider>
    </QueryClientProvider></PliegoThemeProvider>,
  );
  return { ...view, router, queryClient };
}

export function cartBody(items: Partial<CartItemFixture>[] = [{}], total?: string) {
  const lines = items.map((item, index) => ({ ...cartItem(index), ...item }));
  return {
    cartId: lines.length ? "40" : null,
    state: lines.length ? "ACTIVE" : null,
    items: lines,
    totalCurrent: total ?? lines.reduce((sum, line) => sum + Number(line.currentSubtotal), 0).toFixed(2),
  };
}

type CartItemFixture = ReturnType<typeof cartItem>;

function cartItem(index: number) {
  return {
    cartItemId: String(100 + index),
    editionId: String(42 + index),
    title: index === 0 ? "Cien años de soledad" : `Edición ${index}`,
    authors: "Gabriel García Márquez",
    sku: `PLG-${index}`,
    coverUrl: null as string | null,
    quantity: 1,
    currentPrice: "18.50",
    currentSubtotal: "18.50",
    available: true,
    unavailabilityReason: null as string | null,
  };
}

export const savedAddress = {
  addressId: "15",
  alias: "Casa",
  recipient: "Ana Pérez",
  line1: "Av. Principal 123",
  line2: null,
  city: "Quito",
  province: "Pichincha",
  countryCode: "EC",
  postalCode: null,
  reference: null,
  phone: "+59325550134",
  primary: true,
};
