import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { createMemoryRouter, RouterProvider } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SessionProvider } from "@/app/session";
import { PliegoThemeProvider } from "@/theme/PliegoThemeProvider";
import { CatalogHomePage } from "./CatalogHomePage";

const editions = Array.from({ length: 8 }, (_, index) => ({
  editionId: String(index + 1), bookId: String(index + 100), isbn13: null, title: `Edición ${index + 1}`, authors: "Autor de prueba", publisher: "Editorial de prueba",
  format: "PAPERBACK", language: "es", price: "20.00", available: index !== 2,
  coverUrl: null, coverLicense: null, coverAttribution: null,
}));

afterEach(() => vi.unstubAllGlobals());

const categories = [
  { slug: "filosofia", name: "Filosofía", parentSlug: null },
  { slug: "literatura", name: "Literatura", parentSlug: null },
];

describe("Home next-reading scene", () => {
  it("lets four destination chips choose real format sets and dots move through their books", async () => {
    const requested: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(input instanceof Request ? input.url : String(input), "http://localhost");
      if (url.pathname.endsWith("/catalog/editions")) requested.push(`${url.searchParams.get("format")}:${url.searchParams.get("pageSize")}`);
      const format = url.searchParams.get("format");
      const items = format === "EBOOK" ? editions.slice(4, 8).map((book) => ({ ...book, format: "EBOOK", ebookFileFormat: null, audioDurationSeconds: null, narrators: [] })) : editions.slice(0, 4);
      const body = url.pathname.endsWith("/catalog/offers") ? { items: [], page: 0, pageSize: 4, totalCount: "0" } : url.pathname.endsWith("/catalog/categories") ? { items: categories }
        : { items, page: 0, pageSize: 4, totalCount: "12" };
      return new Response(JSON.stringify(body), { headers: { "Content-Type": "application/json" } });
    }));
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const router = createMemoryRouter([{ path: "/", element: <CatalogHomePage /> }]);
    const { container } = render(<PliegoThemeProvider><QueryClientProvider client={client}>
      <SessionProvider restoreOnMount={false}><RouterProvider router={router} /></SessionProvider>
    </QueryClientProvider></PliegoThemeProvider>);
    await screen.findByRole("link", { name: "Edición 1" });
    expect(requested).toEqual(expect.arrayContaining(["null:4", "EBOOK:4", "AUDIOBOOK:4"]));
    const scene = screen.getByRole("heading", { name: "Tu próxima lectura." }).closest("section")!;
    const topics = within(scene).getByRole("group", { name: "Elige qué leer" });
    expect(within(topics).getAllByRole("button").map((button) => button.textContent)).toEqual(["Libros", "eBooks", "Audiolibros", "Ofertas"]);
    expect(within(topics).getByRole("button", { name: /^Libros$/ })).toHaveAttribute("aria-pressed", "true");
    expect(scene.querySelectorAll("[data-reading-scene]")).toHaveLength(4);
    expect(within(scene).getByRole("button", { name: "Agregar al carrito: Edición 3" })).toBeDisabled();
    const dots = within(scene).getByRole("group", { name: "Lecturas disponibles: Libros" });
    expect(within(dots).getAllByRole("button")).toHaveLength(4);
    expect(within(dots).getByRole("button", { name: "Libro 1 de 4: Edición 1" })).toHaveAttribute("aria-current", "true");
    expect(within(scene).getByRole("link", { name: "Ver Libros en el catálogo" })).toHaveAttribute("href", "/catalog");

    fireEvent.click(within(topics).getByRole("button", { name: "eBooks" }));
    expect(within(topics).getByRole("button", { name: "eBooks" })).toHaveAttribute("aria-pressed", "true");
    expect(await within(scene).findByRole("link", { name: "Edición 5" })).toBeInTheDocument();
    expect(within(scene).queryByRole("link", { name: "Edición 1" })).not.toBeInTheDocument();
    expect(within(scene).getByRole("group", { name: "Lecturas disponibles: eBooks" })).toBeInTheDocument();
    expect(container.querySelector("[data-reading-track]")).toHaveAttribute("data-active", "0");
    fireEvent.click(within(topics).getByRole("button", { name: "Ofertas" }));
    expect(await within(scene).findByText("No hay ofertas disponibles por ahora.")).toBeInTheDocument();
    expect(within(scene).queryByRole("link", { name: "Edición 5" })).not.toBeInTheDocument();
  });
  it("loads real offers in the home destination instead of a permanent empty placeholder", async () => {
    const offer = { ...editions[0], title: "Oferta vigente", price: "8.00", offer: { offerId: "1", originalPrice: "20.00", discountAmount: "12.00", effectivePrice: "8.00", savingsAmount: "12.00", savingsPercent: "60.00", daysRemaining: 2, endingSoon: true, startsAt: "2026-10-01T00:00:00Z", endsAt: "2026-11-01T00:00:00Z" } };
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(input instanceof Request ? input.url : String(input), "http://localhost");
      const body = url.pathname.endsWith("/catalog/categories") ? { items: [] } : { items: url.pathname.endsWith("/catalog/offers") ? [offer] : [], page: 0, pageSize: 4, totalCount: "1" };
      return new Response(JSON.stringify(body), { headers: { "Content-Type": "application/json" } });
    }));
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(<PliegoThemeProvider><QueryClientProvider client={client}><SessionProvider restoreOnMount={false}><RouterProvider router={createMemoryRouter([{ path: "/", element: <CatalogHomePage /> }])} /></SessionProvider></QueryClientProvider></PliegoThemeProvider>);
    fireEvent.click(screen.getByRole("button", { name: "Ofertas" }));
    expect(await screen.findByRole("link", { name: "Oferta vigente" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Ver Ofertas en el catálogo" })).toHaveAttribute("href", "/ofertas");
    expect(screen.queryByText("No hay ofertas disponibles por ahora.")).not.toBeInTheDocument();
  });
});
