import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { PliegoThemeProvider } from "@/theme/PliegoThemeProvider";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { useEffect, useState, type ReactNode } from "react";
import { createMemoryRouter, RouterProvider, type RouteObject } from "react-router-dom";
import { expect, vi } from "vitest";
import { SessionProvider, useSession } from "@/app/session";

export type Handler = (request: Request) => Response | Promise<Response>;

/** Routes fetch calls by "METHOD /path" and records every request for assertions. */
export function stubApi(routes: Record<string, Handler | Handler[]>) {
  const calls: { method: string; path: string; body: unknown; headers: Headers }[] = [];
  const queues = new Map(Object.entries(routes).map(([key, value]) => [key, Array.isArray(value) ? [...value] : value]));
  const fetchMock = vi.fn(async (request: Request) => {
    const url = new URL(request.url);
    const key = `${request.method} ${url.pathname}`;
    const text = request.method === "GET" || request.method === "DELETE" ? "" : await request.clone().text();
    calls.push({ method: request.method, path: url.pathname + url.search, body: text ? JSON.parse(text) : undefined, headers: request.headers });
    const entry = queues.get(key) ?? [...queues].find(([pattern]) => pattern.includes("*") && new RegExp(`^${pattern.replaceAll("*", "[^/]+")}$`).test(key))?.[1];
    if (!entry && key === "POST /api/v1/auth/refresh") return new Response(null, { status: 204 });
    if (!entry && key === "POST /api/v1/auth/logout") return new Response(null, { status: 204 });
    if (!entry && key === "GET /api/v1/reference/countries") return json([{ code: "EC", name: "Ecuador" }, { code: "CO", name: "Colombia" }]);
    if (!entry && key === "GET /api/v1/reference/transfer-details") return json({ bank: "Banco Guayaquil", beneficiary: "PLIEGO", accountType: "Ahorros", accountNumber: "2557897233", identification: "1751550656" });
    if (!entry && key === "GET /api/v1/me") return json({ customerId: "2", email: "ana@example.com", firstNames: "Ana", lastNames: "Pérez", phone: null, state: "ACTIVE", version: "0" });
    if (!entry && key === "GET /api/v1/me/favorites") return json({ items: [], page: 0, pageSize: 20, totalCount: "0" });
    if (!entry && key === "GET /api/v1/geo/provinces") return json(geoProvincesFixture);
    if (!entry && key.startsWith("GET /api/v1/geo/provinces/") && key.endsWith("/cities")) return json(geoCitiesFixture[url.pathname.split("/")[5]] ?? []);
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
  const lines = items.map((item, index) => {
    const requiresPhysicalFulfillment = item.requiresPhysicalFulfillment ?? (item.format !== "EBOOK" && item.format !== "AUDIOBOOK");
    return { ...cartItem(index), requiresPhysicalFulfillment, quantityEditable: requiresPhysicalFulfillment || (item.quantity ?? 1) !== 1, ...item };
  });
  return {
    cartId: lines.length ? "40" : null,
    requiresPhysicalFulfillment: lines.some(line => line.requiresPhysicalFulfillment),
    physicalItemCount: lines.filter(line => line.requiresPhysicalFulfillment).length,
    digitalItemCount: lines.filter(line => !line.requiresPhysicalFulfillment).length,
    state: lines.length ? "ACTIVE" : null,
    items: lines,
    totalCurrent: total ?? lines.reduce((sum, line) => sum + Number(line.currentSubtotal), 0).toFixed(2),
  };
}

type CartItemFixture = ReturnType<typeof cartItem> & { format?: string; requiresPhysicalFulfillment?: boolean; quantityEditable?: boolean;
  /** The server's offer projection for the line (optional, as in older responses). */
  originalPrice?: string; unitSavings?: string; originalSubtotal?: string; lineSavings?: string };

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

/** A small slice of the INEC catalog (ADR 0044) served by every `stubApi` unless a test routes it itself. */
export const geoProvincesFixture = [{ id: "9", code: "09", name: "Guayas" }, { id: "17", code: "17", name: "Pichincha" }];
export const geoCitiesFixture: Record<string, { id: string; code: string; name: string; kind: "CABECERA_CANTONAL" | "PARROQUIA_RURAL"; cantonName: string; aliases?: string[] }[]> = {
  "9": [
    { id: "495", code: "0927", name: "General Antonio Elizalde", kind: "CABECERA_CANTONAL", cantonName: "General Antonio Elizalde", aliases: ["General Elizalde (Bucay)", "Bucay"] },
    { id: "488", code: "0921", name: "General Villamil", kind: "CABECERA_CANTONAL", cantonName: "Playas", aliases: ["Playas"] },
    { id: "432", code: "0901", name: "Guayaquil", kind: "CABECERA_CANTONAL", cantonName: "Guayaquil", aliases: ["Chongón", "Roca", "Tarqui"] },
  ],
  "17": [
    { id: "903", code: "170160", name: "El Quinche", kind: "PARROQUIA_RURAL", cantonName: "Distrito Metropolitano de Quito" },
    { id: "893", code: "1701", name: "Quito", kind: "CABECERA_CANTONAL", cantonName: "Distrito Metropolitano de Quito" },
    { id: "952", code: "1705", name: "Sangolquí", kind: "CABECERA_CANTONAL", cantonName: "Rumiñahui" },
  ],
};

/**
 * Chooses a province, then one of its places, in the catalog pickers inside `container` (stubApi serves the slice).
 * The city is matched by the start of its row, which may add the canton ("El Quinche · Quito").
 */
export async function choosePlace(container: HTMLElement = document.body, province = "Pichincha", city = "Quito") {
  const scope = within(container);
  fireEvent.click(await scope.findByRole("combobox", { name: "Provincia" }));
  fireEvent.click(await screen.findByRole("option", { name: province }));
  const cityTrigger = scope.getByRole("combobox", { name: "Ciudad" });
  await waitFor(() => expect(cityTrigger).toBeEnabled());
  fireEvent.click(cityTrigger);
  fireEvent.click(await screen.findByRole("option", { name: new RegExp(`^${city}`) }));
  await waitFor(() => expect(cityTrigger).toHaveTextContent(city));
}

export const savedAddress = {
  addressId: "15",
  alias: "Casa",
  recipient: "Ana Pérez",
  line1: "Av. Principal 123",
  line2: null,
  city: "Quito",
  province: "Pichincha",
  cityId: "893" as string | null,
  provinceId: "17" as string | null,
  cityNeedsReview: false,
  countryCode: "EC",
  postalCode: null,
  reference: null,
  phone: "+59325550134",
  primary: true,
};
