import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SessionProvider } from "@/app/session";
import { PliegoThemeProvider } from "@/theme/PliegoThemeProvider";
import { OffersPage } from "./OffersPage";

const offerEdition = { editionId: "42", bookId: "1", title: "Libro en oferta", authors: "Autora", publisher: "Editorial", isbn13: null, price: "8.00", coverUrl: null, coverLicense: null, coverAttribution: null, format: "PAPERBACK", language: "es", available: true, offer: { offerId: "5", originalPrice: "10.00", discountAmount: "2.00", effectivePrice: "8.00", savingsAmount: "2.00", savingsPercent: "20.00", startsAt: "2026-10-01T00:00:00Z", endsAt: "2026-11-01T00:00:00Z", daysRemaining: 2, endingSoon: true, offerCopy: "Una lectura para ti", terms: "Hasta agotar la vigencia" } };
const facets = { productTypes: [{ code: "PHYSICAL", label: "Libros físicos", count: "1" }], categories: [{ slug: "literatura", name: "Literatura", count: "1" }], sorts: [{ code: "RELEVANCE", label: "Relevancia" }, { code: "ENDING_SOON", label: "Finalizan pronto" }, { code: "PRICE_ASC", label: "Precio de menor a mayor" }, { code: "PRICE_DESC", label: "Precio de mayor a menor" }], totalCount: "1", endingSoonDays: 3, timezone: "America/Guayaquil" };
function renderOffers(entry = "/ofertas") {
  return render(<PliegoThemeProvider><QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><SessionProvider restoreOnMount={false}><MemoryRouter initialEntries={[entry]}><OffersPage /></MemoryRouter></SessionProvider></QueryClientProvider></PliegoThemeProvider>);
}
function response(items: unknown[], totalCount = String(items.length)) { return new Response(JSON.stringify({ items, page: 0, pageSize: 20, totalCount }), { status: 200, headers: { "Content-Type": "application/json" } }); }
function mockOffers(handler: (request: Request) => Response | Promise<Response>) {
  vi.stubGlobal("fetch", vi.fn((request: Request) => request.url.includes("/offers/filter-options") ? new Response(JSON.stringify(facets), { headers: { "Content-Type": "application/json" } }) : handler(request)));
}
afterEach(() => vi.unstubAllGlobals());
describe("OffersPage", () => {
  it("renders authoritative effective and original prices with existing edition actions", async () => {
    mockOffers(async () => response([offerEdition]));
    renderOffers();
    expect(await screen.findByRole("heading", { name: "Libro en oferta" })).toBeInTheDocument();
    expect(screen.getByText(/\$\s*8,00/)).toBeInTheDocument();
    expect(screen.getByText(/\$\s*10,00/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Agregar al carrito: Libro en oferta/ })).toBeInTheDocument();
  });
  it("shows loading then the true backend empty state", async () => {
    let finish!: (value: Response) => void;
    mockOffers(() => new Promise<Response>((resolve) => { finish = resolve; }));
    renderOffers();
    expect(screen.getByText("Consultando ofertas…")).toBeInTheDocument();
    await waitFor(() => expect(finish).toBeTypeOf("function"));
    finish(response([]));
    expect(await screen.findByText("No hay ofertas disponibles por ahora.")).toBeInTheDocument();
  });
  it("allows retrying a failed offers read", async () => {
    let failed = true;
    mockOffers(async () => failed ? new Response("{}", { status: 503, headers: { "Content-Type": "application/json" } }) : response([]));
    renderOffers();
    const retry = await screen.findByRole("button", { name: "Volver a intentar" });
    failed = false;
    await userEvent.click(retry);
    expect(await screen.findByText("No hay ofertas disponibles por ahora.")).toBeInTheDocument();
  });
  it("keeps pagination in the offers route", async () => {
    mockOffers(async () => response([offerEdition], "21"));
    renderOffers();
    expect(await screen.findByRole("link", { name: "Siguiente" })).toHaveAttribute("href", "/ofertas?page=1");
  });
  it("renders backend filter/sort options and sends them to the API without sorting locally", async () => {
    const requested: URL[] = [];
    vi.stubGlobal("fetch", vi.fn(async (request: Request) => {
      const url = new URL(request.url);
      if (url.pathname.endsWith("/filter-options")) return new Response(JSON.stringify(facets), { headers: { "Content-Type": "application/json" } });
      requested.push(url);
      return response([offerEdition]);
    }));
    renderOffers();
    await userEvent.click(await screen.findByRole("button", { name: /Libros físicos/ }));
    await userEvent.selectOptions(screen.getByLabelText("Categoría de ofertas"), "literatura");
    await userEvent.selectOptions(screen.getByLabelText("Ordenar ofertas"), "ENDING_SOON");
    await waitFor(() => expect(requested.at(-1)?.searchParams.get("sort")).toBe("ENDING_SOON"));
    expect(requested.at(-1)?.searchParams.get("productType")).toBe("PHYSICAL");
    expect(requested.at(-1)?.searchParams.get("category")).toBe("literatura");
    expect(screen.getByText("Quedan 2 días")).toBeInTheDocument();
    expect(screen.getByText("Una lectura para ti")).toBeInTheDocument();
    expect(screen.getByText("1 oferta")).toBeInTheDocument();
  });
  it("preserves a product chip when sorting immediately before navigation renders", async () => {
    const requests: URL[] = [];
    mockOffers(async request => { requests.push(new URL(request.url)); return response([offerEdition]); });
    renderOffers();
    const chip = await screen.findByRole("button", { name: /Libros físicos/ });
    act(() => {
      fireEvent.click(chip);
      fireEvent.change(screen.getByLabelText("Ordenar ofertas"), { target: { value: "ENDING_SOON" } });
    });
    await waitFor(() => expect(requests.at(-1)?.searchParams.get("sort")).toBe("ENDING_SOON"));
    expect(requests.at(-1)?.searchParams.get("productType")).toBe("PHYSICAL");
  });
});
