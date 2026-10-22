import { storefrontNavigationFixture } from "@/test/storefrontFixture";
import { SiteHeader } from "@/app/navigation/SiteHeader";
import { BackNavigationProvider } from "@/app/navigation/BackNavigationProvider";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { PliegoThemeProvider } from "@/theme/PliegoThemeProvider";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createMemoryRouter, RouterProvider } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SessionProvider } from "@/app/session";
import { EditionDetailPage } from "./EditionDetailPage";

function renderDetail(initialEntry = "/catalog/editions/42?from=%2Fcatalog%3Fq%3DCien", state: unknown = null) {
  const fetchEdition = window.fetch;
  vi.stubGlobal("fetch", (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(input instanceof Request ? input.url : String(input), "http://localhost");
    return url.pathname.endsWith("/storefront/navigation")
      ? Promise.resolve(new Response(JSON.stringify(storefrontNavigationFixture), { headers: { "Content-Type": "application/json" } }))
      : fetchEdition(input, init);
  });
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const initialUrl = new URL(initialEntry, "http://localhost");
  const router = createMemoryRouter(
    [{ path: "/catalog/editions/:editionId", element: <BackNavigationProvider><SiteHeader /><EditionDetailPage /></BackNavigationProvider> },
      { path: "/catalog", element: <BackNavigationProvider><SiteHeader /><h1>Catálogo de prueba</h1></BackNavigationProvider> }],
    { initialEntries: [{ pathname: initialUrl.pathname, search: initialUrl.search, state }] },
  );

  return render(
    <PliegoThemeProvider><QueryClientProvider client={queryClient}>
      <SessionProvider restoreOnMount={false}>
        <RouterProvider router={router} />
      </SessionProvider>
    </QueryClientProvider></PliegoThemeProvider>,
  );
}

function problemResponse() {
  return new Response(JSON.stringify({
    type: "urn:pliego:problem:API_UNAVAILABLE",
    title: "No pudimos consultar la edición",
    status: 503,
    detail: "Prueba otra vez.",
    code: "API_UNAVAILABLE",
  }), { status: 503, headers: { "Content-Type": "application/problem+json" } });
}

function editionResponse(available = true, overrides: Record<string, unknown> = {}) {
  return new Response(JSON.stringify({
    editionId: "42",
    bookId: "17",
    title: "Cien años de soledad",
    authors: [{ authorId: "9", name: "Gabriel García Márquez", order: 1 }],
    categories: [{ slug: "narrativa", name: "Narrativa", parentSlug: null }],
    publisher: { publisherId: "5", name: "Editorial Sur" },
    isbn13: "9780306406157",
    sku: "PLG-LIT-042",
    language: "es",
    format: "PAPERBACK",
    price: "18.50",
    coverUrl: null,
    coverLicense: null,
    coverSourceUrl: null,
    coverAttribution: null,
    available,
    ...overrides,
  }), { status: 200, headers: { "Content-Type": "application/json" } });
}

function expectSharedChrome() {
  expect(screen.getByRole("link", { name: "PLIEGO, ir al inicio" })).toBeInTheDocument();
  expect(screen.getByRole("navigation", { name: "Navegación del pie de página" })).toBeInTheDocument();
}

afterEach(() => vi.unstubAllGlobals());

describe("EditionDetailPage", () => {
  it.each([["PAPERBACK", "Libro"], ["EBOOK", "eBook"], ["AUDIOBOOK", "Audiolibro"]])("names the %s medium on the edition page", async (format, label) => {
    vi.stubGlobal("fetch", vi.fn(async () => editionResponse(true, { format,
      ...(format === "AUDIOBOOK" ? { audioDurationSeconds: 3600, narrators: ["Ana Voz"] } : {}),
    })));
    renderDetail();
    await screen.findByRole("heading", { name: "Cien años de soledad" });
    const identity = screen.getByRole("heading", { name: "Cien años de soledad" }).closest("header")!;
    expect(within(identity).getByText(label, { exact: true })).toBeVisible();
  });

  it.each(["/ofertas", "/catalog?que=Cien&productType=EBOOK&page=2"])("keeps generic catalog navigation separate from contextual return to %s", async (origin) => {
    vi.stubGlobal("fetch", vi.fn(async () => editionResponse()));
    renderDetail(`/catalog/editions/42?from=${encodeURIComponent(origin)}`);
    await screen.findByRole("heading", { name: "Cien años de soledad" });
    const trail = within(screen.getByRole("navigation", { name: "Ruta de navegación" }));
    expect(trail.getByRole("link", { name: "Catálogo" })).toHaveAttribute("href", "/catalog");
    const footer = within(screen.getByRole("navigation", { name: "Navegación del pie de página" }));
    expect(footer.getByRole("link", { name: origin === "/ofertas" ? "Volver a Ofertas" : "Volver al catálogo" })).toHaveAttribute("href", origin);
  });

  const serverOffer = { offerId: "4", originalPrice: "18.50", discountAmount: "5.00", effectivePrice: "13.50", savingsAmount: "5.00", savingsPercent: "27.03", daysRemaining: 2, endingSoon: true, startsAt: "2026-01-01T00:00:00-05:00", endsAt: "2026-10-09T23:59:59-05:00", offerCopy: "Una lectura para ti", terms: "Válida hasta agotar existencias." };
  function stubOffer(overrides: Record<string, unknown>) {
    vi.stubGlobal("fetch", vi.fn((input: RequestInfo | URL) => {
      const url = new URL(input instanceof Request ? input.url : String(input), "http://localhost");
      return Promise.resolve(url.pathname.endsWith("/categories")
        ? new Response(JSON.stringify({ items: [] }), { headers: { "Content-Type": "application/json" } })
        : editionResponse(true, { price: "13.50", ...overrides }));
    }));
  }
  it.each([
    { format: "PAPERBACK" },
    { format: "EBOOK", ebookFileFormat: "EPUB" },
    { format: "AUDIOBOOK", ebookFileFormat: null, audioDurationSeconds: 3661, narrators: ["Ana Voz"] },
  ])("shows the server offer on the price line for $format without recalculating it", async (media) => {
    stubOffer({ ...media, offer: serverOffer });
    renderDetail();
    await screen.findByRole("heading", { name: "Cien años de soledad" });
    expect(screen.getByText(/13,50/)).toBeInTheDocument();
    expect(screen.getByText(/Precio anterior/).closest("p")?.querySelector("s")).toHaveTextContent("18,50");
    const saving = screen.getByText(/Ahorras/);
    expect(saving).toHaveTextContent("5,00");
    expect(saving.parentElement?.querySelector(".material-symbol")?.textContent).toBe("sell");
    expect(screen.getByText("Quedan 2 días")).toBeInTheDocument();
    expect(screen.queryByText("Una lectura para ti")).toBeNull();
    expect(screen.queryByText(/Términos/)).toBeNull();
    expect(screen.queryByText(/Termina el|UTC/)).toBeNull();
    expect(screen.queryByRole("region", { name: /Oferta/ })).toBeNull();
  });
  it("keeps the days left for the last five days only, and shows no offer without one", async () => {
    stubOffer({ format: "PAPERBACK", offer: { ...serverOffer, daysRemaining: 9 } });
    const first = renderDetail();
    await screen.findByRole("heading", { name: "Cien años de soledad" });
    expect(screen.getByText(/Ahorras/)).toBeInTheDocument();
    expect(screen.queryByText(/Quedan|Queda/)).toBeNull();
    first.unmount();
    stubOffer({ format: "PAPERBACK", offer: null });
    renderDetail();
    await screen.findByRole("heading", { name: "Cien años de soledad" });
    expect(screen.queryByText(/Ahorras|Precio anterior/)).toBeNull();
  });

  it.each([
    { format: "EBOOK", ebookFileFormat: "EPUB", audioDurationSeconds: null, narrators: [], expected: ["eBook · EPUB"] },
    { format: "AUDIOBOOK", ebookFileFormat: null, audioDurationSeconds: 3661, narrators: ["Ana Voz", "Luis Voz"], expected: ["Audiolibro · 1 h 1 min 1 s", "Ana Voz, Luis Voz"] },
    { format: "AUDIOBOOK", ebookFileFormat: null, audioDurationSeconds: 3661, narrators: ["Narrador DEMO PLIEGO (sin identidad bibliográfica)"], expected: ["Voz de demostración"] },
  ])("shows only supplied $format technical metadata without unsupported access actions", async ({ expected, ...metadata }) => {
    vi.stubGlobal("fetch", vi.fn((input: RequestInfo | URL) => {
      const url = new URL(input instanceof Request ? input.url : String(input), "http://localhost");
      return Promise.resolve(url.pathname.endsWith("/categories")
        ? new Response(JSON.stringify({ items: [] }), { headers: { "Content-Type": "application/json" } })
        : editionResponse(true, { ...metadata, isbn13: null, pageCount: null }));
    }));
    renderDetail();
    await screen.findByRole("heading", { name: "Cien años de soledad" });
    expected.forEach(value => expect(screen.getByText(value)).toBeInTheDocument());
    expect(screen.queryByText(/DEMO|sin identidad/)).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /descargar|reproducir|escuchar/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /descargar|reproducir|escuchar/i })).not.toBeInTheDocument();
  });

  it("draws the one back arrow under the header, on the content edge, and leaves the wordmark alone", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => editionResponse()));
    renderDetail("/catalog/editions/42");
    const main = await screen.findByRole("main");
    await screen.findByRole("heading", { level: 1 });
    const header = screen.getByTestId("site-header");
    expect(within(header).queryByRole("button", { name: "Volver atrás" })).not.toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "Volver atrás" })).toHaveLength(1);
    const back = within(main).getByRole("button", { name: "Volver atrás" });
    const trail = within(main).getByRole("navigation", { name: "Ruta de navegación" });
    expect(back.compareDocumentPosition(trail) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(within(header).getByRole("link", { name: "PLIEGO, ir al inicio" }).previousElementSibling?.getAttribute("aria-label")).not.toBe("Volver atrás");
    await userEvent.click(back);
    expect(await screen.findByRole("heading", { name: "Catálogo de prueba" })).toBeInTheDocument();
    // Leaving the edition releases the claim: other pages keep the arrow in the header, unchanged.
    expect(within(screen.getByTestId("site-header")).queryByRole("button", { name: "Volver atrás" })).toBeInTheDocument();
  });

  it("keeps the shared header and footer while loading and after success", async () => {
    let releaseRequest: ((response: Response) => void) | undefined;
    const pendingResponse = new Promise<Response>((resolve) => { releaseRequest = resolve; });
    vi.stubGlobal("fetch", vi.fn((input: RequestInfo | URL) => {
      const url = new URL(input instanceof Request ? input.url : String(input), "http://localhost");
      return url.pathname.endsWith("/categories") ? Promise.resolve(new Response(JSON.stringify({ items: [] }), { headers: { "Content-Type": "application/json" } })) : pendingResponse;
    }));

    renderDetail();

    expectSharedChrome();
    expect(within(screen.getByRole("main")).getByRole("status")).toHaveTextContent("Consultando la edición");
    releaseRequest?.(editionResponse());
    await screen.findByRole("heading", { name: "Cien años de soledad" });

    expectSharedChrome();
    expect(screen.getByRole("navigation", { name: "Ruta de navegación" })).toHaveTextContent("Cien años de soledad");
    expect(screen.getByRole("link", { name: "Iniciar sesión para agregar" })).toBeInTheDocument();
  });

  it("keeps the catalog cover visible while detail data loads", async () => {
    let releaseRequest: ((response: Response) => void) | undefined;
    const pendingResponse = new Promise<Response>((resolve) => { releaseRequest = resolve; });
    const coverUrl = "https://covers.pliegolibros.com/covers/editions/v2/PLG-BK-000001-52ead14866be.webp";
    vi.stubGlobal("fetch", vi.fn((input: RequestInfo | URL) => {
      const url = new URL(input instanceof Request ? input.url : String(input), "http://localhost");
      return url.pathname.endsWith("/categories") ? Promise.resolve(new Response(JSON.stringify({ items: [] }), { headers: { "Content-Type": "application/json" } })) : pendingResponse;
    }));

    renderDetail("/catalog/editions/42?from=%2F", {
      coverPreview: {
        editionId: "42",
        url: coverUrl,
        license: null,
        attribution: null,
        title: "Cien años de soledad",
      },
    });

    expect(await screen.findByRole("img", { name: "Portada de Cien años de soledad" }))
      .toHaveAttribute("src", coverUrl);
    expect(screen.getByRole("heading", { name: "Cien años de soledad" })).toBeInTheDocument();
    expect(within(screen.getByRole("main")).getByRole("status")).toHaveTextContent("Consultando la edición");
    releaseRequest?.(editionResponse(true, { coverUrl }));
    await screen.findByRole("heading", { name: "Cien años de soledad" });
    expect(screen.getByRole("img", { name: "Portada de Cien años de soledad" }))
      .toHaveAttribute("src", coverUrl);
  });

  it("renders the same CDN cover URL from edition detail when provenance is unresolved", async () => {
    const coverUrl = "https://covers.pliegolibros.com/covers/editions/v2/PLG-BK-000001-52ead14866be.webp";
    vi.stubGlobal("fetch", vi.fn(async () => editionResponse(true, {
      coverUrl,
      coverLicense: null,
      coverSourceUrl: null,
      coverAttribution: null,
    })));

    renderDetail();

    const image = await screen.findByRole("img", { name: "Portada de Cien años de soledad" });
    expect(image).toHaveAttribute("src", coverUrl);
    expect(image).toHaveAttribute("loading", "eager");
  });

  it("keeps the shared header and footer through a retryable error", async () => {
    let attempts = 0;
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(input instanceof Request ? input.url : String(input), "http://localhost");
      if (url.pathname.endsWith("/categories")) return new Response(JSON.stringify({ items: [] }), { headers: { "Content-Type": "application/json" } });
      attempts += 1;
      return attempts < 3 ? problemResponse() : editionResponse();
    }));

    renderDetail();

    await waitFor(() => expect(attempts).toBeGreaterThan(0));
    const retry = await screen.findByRole("button", { name: "Volver a intentar" });
    expect(attempts).toBe(2);
    expect(screen.getByRole("heading", { name: "No pudimos actualizar la edición." })).toBeInTheDocument();
    expectSharedChrome();

    await userEvent.setup().click(retry);
    await screen.findByRole("heading", { name: "Cien años de soledad" });
    expect(attempts).toBe(3);
    expectSharedChrome();
  });

  it("does not offer purchase for an unavailable edition", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => editionResponse(false)));

    renderDetail();

    await screen.findByRole("heading", { name: "Cien años de soledad" });
    expect(within(screen.getByRole("main")).getByRole("status")).toHaveTextContent("no está disponible para agregar al carrito");
    expect(screen.queryByRole("button", { name: "Agregar al carrito" })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Iniciar sesión para agregar" })).not.toBeInTheDocument();
  });

  it("rejects unsafe cover-source schemes and formats edition facts for es-EC", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => editionResponse(true, {
      coverSourceUrl: "javascript:alert(1)",
      format: "EDITION_FORMAT_ADDED_LATER",
      pageCount: 1245,
      publicationDate: "1967-05-30",
    })));

    renderDetail("/catalog/editions/42?from=%2Fcatalog%3Fque%3DCien%26sort%3DPRICE_DESC%26page%3D2%26minPrice%3D10.00");

    await screen.findByRole("heading", { name: "Cien años de soledad" });
    expect(screen.queryByRole("link", { name: /fuente de la portada/i })).not.toBeInTheDocument();
    expect(screen.getByText("Formato no reconocido")).toBeInTheDocument();
    expect(screen.getByText("1.245")).toBeInTheDocument();
    expect(screen.getByText("30 de mayo de 1967")).toBeInTheDocument();

    const category = screen.getByRole("link", { name: "Narrativa" });
    expect(category).toHaveAttribute(
      "href",
      "/catalog?que=Cien&category=narrativa&minPrice=10.00&sort=PRICE_DESC",
    );
  });

  it("renders an absolute HTTPS cover-source link", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => editionResponse(true, {
      coverSourceUrl: "https://books.example/source/42",
    })));

    renderDetail();

    const link = await screen.findByRole("link", { name: /consultar fuente de la portada/i });
    expect(link).toHaveAttribute("href", "https://books.example/source/42");
    expect(link).toHaveAttribute("rel", "noopener noreferrer");
  });
});
