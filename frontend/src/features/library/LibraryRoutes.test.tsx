import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { json, problem, renderPurchaseRoute, stubApi } from "@/test/purchase";
import { LibraryPage, OwnedItemPage } from "./LibraryRoutes";

const item = { ownedItemId: "8", editionId: "42", coverUrl: null, title: "Libro propio", authors: "Autora", productType: "EBOOK", acquiredAt: "2026-10-05T10:00:00Z", ownershipState: "OWNED", accessState: "OWNERSHIP_ONLY", contentAccessSupported: false,
  metadata: { isbn: "9780306406157", publisher: "Editorial", language: "es", pageCount: 120, publicationDate: "2020-01-01", ebookFileFormat: "EPUB", audioDurationSeconds: null, narrators: [] },
  sourcePurchases: [{ orderId: "700", orderItemId: "1", acquiredAt: "2026-10-05T10:00:00Z", paymentState: "APPROVED", orderState: "CONFIRMED", grantState: "ACTIVE" }],
  availableActions: [{ type: "VIEW_ORDER", label: "Ver pedido", href: "/orders/700" }, { type: "HELP", label: "Ayuda", href: "/ayuda/ebooks" }] };
const routes = [{ path: "/biblioteca", element: <LibraryPage /> }, { path: "/biblioteca/:ownedItemId", element: <OwnedItemPage /> }];
afterEach(() => vi.unstubAllGlobals());
describe("Mi biblioteca functional routes", () => {
  it("filters server ownership and opens an acquired title's detail with real purchase actions", async () => {
    const api = stubApi({ "GET /api/v1/me/library": request => json({ items: new URL(request.url).searchParams.get("productType") === "AUDIOBOOK" ? [] : [item], page: 0, pageSize: 20, totalCount: "1" }), "GET /api/v1/me/library/8": () => json(item) });
    const user = userEvent.setup();
    renderPurchaseRoute(routes, "/biblioteca");
    const filters = within(await screen.findByRole("group", { name: "Mostrar" }));
    await user.click(filters.getByRole("button", { name: "Audiolibros" }));
    await screen.findByRole("heading", { name: "Aún no tienes audiolibros." });
    expect(filters.getByRole("button", { name: "Audiolibros" })).toHaveAttribute("aria-pressed", "true");
    expect(api.calls.some(call => call.path.includes("productType=AUDIOBOOK"))).toBe(true);
    await user.click(filters.getByRole("button", { name: "eBooks" }));
    expect(await screen.findByText("1 título")).toBeInTheDocument();
    await user.click(await screen.findByRole("link", { name: "Libro propio" }));
    await screen.findByRole("heading", { name: "Libro propio" });
    expect(screen.getByText("Pertenece a tu cuenta")).toBeInTheDocument();
    expect(screen.getByText("EPUB")).toBeInTheDocument();
    const purchases = screen.getByRole("region", { name: "Información de compra" });
    for (const label of ["Pedido N.° 700", "Confirmado", "Aprobado", "Vigente"]) expect(within(purchases).getByText(label)).toBeInTheDocument();
    expect(purchases).not.toHaveTextContent(/CONFIRMED|APPROVED|ACTIVE/);
    expect(screen.getAllByText("5 de octubre de 2026").length).toBeGreaterThan(0);
    expect(screen.getByText("1 de enero de 2020")).toBeInTheDocument();
    expect(screen.getByText("Español")).toBeInTheDocument();
    expect(document.body).not.toHaveTextContent(/2026-10-05T|segundos/);
    expect(screen.getByRole("link", { name: "Ver pedido" })).toHaveAttribute("href", "/orders/700");
    expect(screen.getByRole("link", { name: "Ayuda" })).toHaveAttribute("href", "/ayuda/ebooks");
    expect(screen.queryByRole("link", { name: /Leer|Escuchar|Continuar leyendo|Continuar escuchando/i })).not.toBeInTheDocument();
  });
  it("retains the isolated 404 state without a catalog fallback", async () => {
    const api = stubApi({ "GET /api/v1/me/library/8": () => problem(404, "RESOURCE_NOT_FOUND", "No disponible", "Esta adquisición no está disponible.") });
    renderPurchaseRoute(routes, "/biblioteca/8");
    await screen.findByRole("heading", { name: "Adquisición no disponible" });
    expect(api.count("GET", "/api/v1/catalog/editions/42")).toBe(0);
  });
  it("presents a revoked audiobook with a readable duration and only the server's actions", async () => {
    const revoked = { ...item, productType: "AUDIOBOOK", ownershipState: "REVOKED", accessState: "REVOKED",
      metadata: { ...item.metadata, pageCount: null, ebookFileFormat: null, audioDurationSeconds: 31320, narrators: ["Voz Uno", "Voz Dos"] },
      sourcePurchases: [{ ...item.sourcePurchases[0], paymentState: "REFUNDED", orderState: "CANCELLED", grantState: "REVOKED" }],
      availableActions: [{ type: "VIEW_ORDER", label: "Ver pedido", href: "/orders/700" }] };
    stubApi({ "GET /api/v1/me/library/8": () => json(revoked) });
    renderPurchaseRoute(routes, "/biblioteca/8");
    await screen.findByRole("heading", { name: "Libro propio" });
    expect(screen.getByText("Audiolibro")).toBeInTheDocument();
    expect(screen.getAllByText("Titularidad revocada")).toHaveLength(1);
    expect(screen.getByText("8 h 42 min")).toBeInTheDocument();
    expect(screen.getByText("Voz Uno, Voz Dos")).toBeInTheDocument();
    expect(screen.getByText("Revocada")).toBeInTheDocument();
    expect(within(screen.getByRole("navigation", { name: "Acciones de la adquisición" })).getAllByRole("link")).toHaveLength(1);
  });
  it("marks ownership cache private and scopes it to the authenticated account", async () => {
    stubApi({ "GET /api/v1/me/library": () => json({ items: [item], page: 0, pageSize: 20, totalCount: "1" }) });
    const { queryClient } = renderPurchaseRoute(routes, "/biblioteca");
    await screen.findByRole("link", { name: "Libro propio" });
    expect(queryClient.getQueryCache().getAll().find(query => query.queryKey[0] === "customer-library")?.meta?.authRequired).toBe(true);
    await waitFor(() => expect(queryClient.getQueryCache().getAll().some(query => query.queryKey.includes("2"))).toBe(true));
  });
});
