import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
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
  it("renders the quiet offer card from the server's prices, saving and days left", async () => {
    mockOffers(async () => response([offerEdition]));
    renderOffers();
    expect(await screen.findByRole("heading", { name: "Libro en oferta" })).toBeInTheDocument();
    expect(screen.getByText(/\$\s*8,00/)).toBeInTheDocument();
    expect(screen.getByText(/\$\s*10,00/).closest("s")).not.toBeNull();
    const saving = screen.getByText(/Ahorras \$\s*2,00/).parentElement!;
    expect(saving.querySelector(".material-symbol")?.textContent).toBe("sell");
    expect(saving.textContent).not.toMatch(/%/);
    expect(screen.getByText("Quedan 2 días")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /^Ver edición: Libro en oferta/ })).toHaveAttribute("href", expect.stringMatching(/^\/catalog\/editions\/42\?from=/));
    expect(screen.getByRole("button", { name: "Agregar a favoritos: Libro en oferta" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Agregar al carrito/ })).toBeNull();
    expect(screen.queryByText(/Disponible/)).toBeNull();
    expect(screen.queryByText(/Termina el/)).toBeNull();
    expect(screen.queryByText("Una lectura para ti")).toBeNull();
    expect(screen.queryByText("Autora")).toBeNull();
    expect(screen.getByText("Ver oferta").closest("[aria-hidden='true']")).not.toBeNull();
    expect(screen.getAllByRole("link", { name: /Libro en oferta/ })).toHaveLength(1);
  });
  it.each([[1, "Queda 1 día"], [5, "Quedan 5 días"], [6, null], [12, null]])("shows the urgency chip only for five days or fewer (%i)", async (daysRemaining, label) => {
    mockOffers(async () => response([{ ...offerEdition, offer: { ...offerEdition.offer, daysRemaining, endingSoon: daysRemaining <= 3 } }]));
    const { container } = renderOffers();
    await screen.findByRole("heading", { name: "Libro en oferta" });
    expect(container.querySelector("[data-offer-urgency]")?.textContent ?? null).toBe(label);
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
  it("reads every page of the server's set and shows it on one shelf, without pages or a catalog link", async () => {
    const requests: URL[] = [];
    const edition = (id: number) => ({ ...offerEdition, editionId: String(id), title: `Oferta ${id}` });
    mockOffers(async (request) => {
      const url = new URL(request.url);
      requests.push(url);
      const page = Number(url.searchParams.get("page"));
      // Page 1 repeats the last item of page 0, as if the set shifted between reads.
      const items = page === 0 ? Array.from({ length: 50 }, (_, index) => edition(index + 1)) : [edition(50), edition(51), edition(52)];
      return new Response(JSON.stringify({ items, page, pageSize: 50, totalCount: "52" }), { status: 200, headers: { "Content-Type": "application/json" } });
    });
    const { container } = renderOffers("/ofertas?page=3&sort=PRICE_ASC");
    expect(await screen.findByRole("heading", { name: "Oferta 52" })).toBeInTheDocument();
    expect(requests.map((url) => [url.searchParams.get("page"), url.searchParams.get("pageSize"), url.searchParams.get("sort")])).toEqual([["0", "50", "PRICE_ASC"], ["1", "50", "PRICE_ASC"]]);
    expect(container.querySelectorAll("[data-offer-card]")).toHaveLength(52);
    expect(screen.getByText("52 ofertas")).toBeInTheDocument();
    expect(screen.queryByRole("navigation", { name: /Paginación/ })).toBeNull();
    expect(screen.queryByText(/Página|Siguiente|Anterior/)).toBeNull();
    expect(screen.queryByRole("link", { name: "Explorar libros" })).toBeNull();
    const facts = screen.getByRole("region", { name: "Cómo funcionan las ofertas" });
    expect(within(facts).getAllByRole("heading", { level: 3 }).map((heading) => heading.textContent)).toEqual(["Ofertas por tiempo limitado.", "Ahorra en cualquier formato.", "Precio siempre actualizado."]);
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
    await userEvent.click(screen.getByRole("combobox", { name: "Tema" }));
    await userEvent.click(await screen.findByRole("option", { name: "Literatura (1)" }));
    await userEvent.click(screen.getByRole("combobox", { name: "Ordenar por" }));
    await userEvent.click(await screen.findByRole("option", { name: "Finalizan pronto" }));
    await waitFor(() => expect(requested.at(-1)?.searchParams.get("sort")).toBe("ENDING_SOON"));
    expect(requested.at(-1)?.searchParams.get("productType")).toBe("PHYSICAL");
    expect(requested.at(-1)?.searchParams.get("category")).toBe("literatura");
    expect(screen.getByText("Quedan 2 días")).toBeInTheDocument();
    expect(screen.getByText("1 oferta")).toBeInTheDocument();
  });
  it("preserves a product chip when sorting immediately before navigation renders", async () => {
    const requests: URL[] = [];
    mockOffers(async request => { requests.push(new URL(request.url)); return response([offerEdition]); });
    renderOffers();
    const chip = await screen.findByRole("button", { name: /Libros físicos/ });
    await userEvent.click(screen.getByRole("combobox", { name: "Ordenar por" }));
    const endingSoon = await screen.findByRole("option", { name: "Finalizan pronto" });
    act(() => {
      fireEvent.click(chip);
      fireEvent.click(endingSoon);
    });
    await waitFor(() => expect(requests.at(-1)?.searchParams.get("sort")).toBe("ENDING_SOON"));
    expect(requests.at(-1)?.searchParams.get("productType")).toBe("PHYSICAL");
  });
});
