import { SiteHeader } from "@/app/navigation/SiteHeader";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { PliegoThemeProvider } from "@/theme/PliegoThemeProvider";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createMemoryRouter, RouterProvider } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SessionProvider } from "@/app/session";
import { EditionDetailPage } from "./EditionDetailPage";

function renderDetail(initialEntry = "/catalog/editions/42?from=%2Fcatalog%3Fq%3DCien", state: unknown = null) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const initialUrl = new URL(initialEntry, "http://localhost");
  const router = createMemoryRouter(
    [{ path: "/catalog/editions/:editionId", element: <><SiteHeader /><EditionDetailPage /></> }],
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
  expect(screen.getByText("Catálogo público")).toBeInTheDocument();
}

afterEach(() => vi.unstubAllGlobals());

describe("EditionDetailPage", () => {
  it("keeps the shared header and footer while loading and after success", async () => {
    let releaseRequest: ((response: Response) => void) | undefined;
    const pendingResponse = new Promise<Response>((resolve) => { releaseRequest = resolve; });
    vi.stubGlobal("fetch", vi.fn(() => pendingResponse));

    renderDetail();

    expectSharedChrome();
    expect(screen.getByRole("status")).toHaveTextContent("Consultando la edición");
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
    vi.stubGlobal("fetch", vi.fn(() => pendingResponse));

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
    expect(screen.getByRole("status")).toHaveTextContent("Consultando la edición");
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
    vi.stubGlobal("fetch", vi.fn(async () => {
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
    expect(screen.getByRole("status")).toHaveTextContent("no está disponible para agregar al carrito");
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
