import { SiteHeader } from "@/app/navigation/SiteHeader";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { PliegoThemeProvider } from "@/theme/PliegoThemeProvider";
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createMemoryRouter, RouterProvider } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SessionProvider } from "@/app/session";
import { CatalogPage } from "./CatalogPage";

function renderCatalog(initialEntry = "/catalog") {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const router = createMemoryRouter([{ path: "/catalog", element: <><SiteHeader /><CatalogPage /></> }], { initialEntries: [initialEntry] });

  const rendered = render(
    <PliegoThemeProvider><QueryClientProvider client={queryClient}>
      <SessionProvider restoreOnMount={false}>
        <RouterProvider router={router} />
      </SessionProvider>
    </QueryClientProvider></PliegoThemeProvider>,
  );
  return { ...rendered, router, queryClient };
}

function jsonResponse(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), { status, headers: { "Content-Type": "application/json" } });
}

function requestUrl(input: RequestInfo | URL) {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.toString();
  return input.url;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("CatalogPage", () => {
  it("isolates scope metadata through all four scopes and browser history", async () => {
    const requests: URL[] = [];
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(requestUrl(input));
      requests.push(url);
      const scope = url.searchParams.get("scope") || "GLOBAL";
      if (url.pathname.endsWith("/catalog/categories")) return jsonResponse({ items: [{ slug: scope.toLowerCase(), name: `Tema ${scope}`, parentSlug: null }] });
      if (url.pathname.endsWith("/catalog/filter-options")) return jsonResponse({ languages: ["es"], formats: scope === "PHYSICAL" ? ["HARDCOVER", "PAPERBACK"] : scope === "GLOBAL" ? ["PAPERBACK", "EBOOK", "AUDIOBOOK"] : [scope], minimumPrice: "10.00", maximumPrice: "40.00" });
      if (url.pathname.endsWith("/catalog/editions")) return jsonResponse({ items: [], page: 0, pageSize: 20, totalCount: "0" });
      return jsonResponse({}, 404);
    }));
    const { router, queryClient } = renderCatalog();
    for (const scope of ["GLOBAL", "PHYSICAL", "EBOOK", "AUDIOBOOK"] as const) {
      if (scope !== "GLOBAL") await act(() => router.navigate(`/catalog?productType=${scope}&sort=BEST_SELLING`));
      await waitFor(() => {
        for (const endpoint of ["categories", "filter-options"]) {
          expect(requests.some(url => url.pathname.endsWith(`/catalog/${endpoint}`) && url.searchParams.get("scope") === scope)).toBe(true);
          expect(queryClient.getQueryData(["public-catalog", endpoint, scope])).toBeDefined();
        }
      });
      expect(queryClient.getQueryData<{ items: { slug: string }[] }>(["public-catalog", "categories", scope])?.items[0].slug).toBe(scope.toLowerCase());
    }
    await act(() => router.navigate(-1));
    await waitFor(() => expect(router.state.location.search).toBe("?productType=EBOOK&sort=BEST_SELLING"));
    expect(queryClient.getQueryData<{ formats: string[] }>(["public-catalog", "filter-options", "EBOOK"])?.formats).toEqual(["EBOOK"]);
  });
  it("preserves selected absent criteria when switching scope to an empty collection", async () => {
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(requestUrl(input));
      if (url.pathname.endsWith("/catalog/categories")) return jsonResponse({ items: [] });
      if (url.pathname.endsWith("/catalog/filter-options")) return jsonResponse({ languages: [], formats: [], minimumPrice: null, maximumPrice: null });
      if (url.pathname.endsWith("/catalog/editions")) return jsonResponse({ items: [], page: 0, pageSize: 20, totalCount: "0" });
      return jsonResponse({}, 404);
    }));
    const destination = "/catalog?productType=PHYSICAL&category=tema-antiguo&language=en&format=HARDCOVER&minPrice=10&maxPrice=40&sort=BEST_SELLING";
    const { router } = renderCatalog(destination);
    await screen.findByRole("link", { name: "Limpiar filtros" });
    await act(() => router.navigate(destination.replace("PHYSICAL", "EBOOK")));
    await userEvent.click(await screen.findByRole("button", { name: /^Filtros,/ }));
    const panel = await screen.findByRole("dialog", { name: "Filtros" });
    expect(within(panel).getByRole("radio", { name: "tema-antiguo" })).toBeChecked();
    expect(within(panel).getByRole("radio", { name: "Tapa dura" })).toBeChecked();
    expect(within(panel).getByRole("radio", { name: "Inglés" })).toBeChecked();
    expect(Object.fromEntries(new URLSearchParams(router.state.location.search))).toMatchObject({ productType: "EBOOK", category: "tema-antiguo", language: "en", format: "HARDCOVER", minPrice: "10", maxPrice: "40", sort: "BEST_SELLING" });
  });
  it("normalizes malformed URL criteria before making the catalog request", async () => {
    let requestedUrl: URL | undefined;
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(requestUrl(input), "http://localhost");
      if (url.pathname.endsWith("/catalog/categories")) return jsonResponse({ items: [] });
      if (url.pathname.endsWith("/catalog/filter-options")) return jsonResponse({ languages: ["es"], formats: [], minimumPrice: "7.25", maximumPrice: "38.00" });
      if (url.pathname.endsWith("/catalog/editions")) {
        requestedUrl = url;
        return jsonResponse({ items: [], page: 0, pageSize: 20, totalCount: "0" });
      }
      return jsonResponse({}, 404);
    }));

    renderCatalog("/catalog?category=bad%2Fslug&minPrice=abc&maxPrice=-8&language=english&format=OTHER&page=1e3&pageSize=51");

    await waitFor(() => expect(requestedUrl).toBeDefined());
    expect(requestedUrl?.searchParams.has("category")).toBe(false);
    expect(requestedUrl?.searchParams.has("minPrice")).toBe(false);
    expect(requestedUrl?.searchParams.has("maxPrice")).toBe(false);
    expect(requestedUrl?.searchParams.has("language")).toBe(false);
    expect(requestedUrl?.searchParams.has("format")).toBe(false);
    expect(requestedUrl?.searchParams.get("page")).toBe("0");
    expect(requestedUrl?.searchParams.get("pageSize")).toBe("20");
  });

  it("shows a recoverable error for an invalid totalCount and retries the read", async () => {
    let editionReads = 0;
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(requestUrl(input), "http://localhost");
      if (url.pathname.endsWith("/catalog/categories")) return jsonResponse({ items: [] });
      if (url.pathname.endsWith("/catalog/filter-options")) return jsonResponse({ languages: ["es"], formats: [], minimumPrice: "7.25", maximumPrice: "38.00" });
      if (url.pathname.endsWith("/catalog/editions")) {
        editionReads += 1;
        return jsonResponse({
          items: [],
          page: 0,
          pageSize: 20,
          totalCount: editionReads === 1 ? "no-es-un-numero" : "0",
        });
      }
      return jsonResponse({}, 404);
    });
    vi.stubGlobal("fetch", fetchMock);

    renderCatalog();

    const results = await screen.findByRole("region", { name: "Resultados" });
    await within(results).findByRole("alert");
    const retry = within(results).getByRole("button", { name: "Volver a intentar" });
    expect(within(results).getByRole("alert")).toHaveTextContent("Recibimos una respuesta incompleta");
    await userEvent.setup().click(retry);

    await waitFor(() => expect(screen.getByRole("heading", { name: "Aún no hay ediciones publicadas." })).toBeInTheDocument());
    expect(editionReads).toBe(2);
  });

  it("gives the result section its own accessible heading relationship", async () => {
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(requestUrl(input), "http://localhost");
      if (url.pathname.endsWith("/catalog/categories")) return jsonResponse({ items: [] });
      if (url.pathname.endsWith("/catalog/filter-options")) return jsonResponse({ languages: ["es"], formats: [], minimumPrice: "7.25", maximumPrice: "38.00" });
      if (url.pathname.endsWith("/catalog/editions")) return jsonResponse({ items: [], page: 0, pageSize: 20, totalCount: "0" });
      return jsonResponse({}, 404);
    }));

    renderCatalog();
    const results = await screen.findByRole("region", { name: "Resultados" });
    expect(results).toHaveAttribute("aria-labelledby", "catalog-results-heading");
    expect(document.querySelectorAll('[aria-labelledby="catalog-results-heading"]')).toHaveLength(1);
  });

  it("submits title, author, and ISBN as one global query without a scope selector", async () => {
    const editionRequests: URL[] = [];
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(requestUrl(input), "http://localhost");
      if (url.pathname.endsWith("/catalog/categories")) return jsonResponse({ items: [] });
      if (url.pathname.endsWith("/catalog/filter-options")) return jsonResponse({ languages: ["es"], formats: [], minimumPrice: "7.25", maximumPrice: "38.00" });
      if (url.pathname.endsWith("/catalog/editions")) {
        editionRequests.push(url);
        return jsonResponse({ items: [], page: 0, pageSize: 20, totalCount: "0" });
      }
      return jsonResponse({}, 404);
    }));

    const user = userEvent.setup();
    renderCatalog();
    expect(screen.queryByRole("combobox", { name: "Buscar por" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Buscar libros en el catálogo" })).toBeInTheDocument();

    for (const value of ["Cien años", "Cervantes", "978-0-306-40615-7"]) {
      await user.click(screen.getByRole("button", { name: "Buscar libros en el catálogo" }));
      const searchbox = await screen.findByRole("searchbox", { name: "Buscar en el catálogo" });
      await user.clear(searchbox);
      await user.type(searchbox, value);
      await user.keyboard("{Enter}");
      await waitFor(() => expect(editionRequests.some((url) => url.searchParams.get("que") === value)).toBe(true));
    }

    for (const url of editionRequests) {
      expect(url.searchParams.has("title")).toBe(false);
      expect(url.searchParams.has("author")).toBe(false);
      expect(url.searchParams.has("isbn13")).toBe(false);
      expect(url.searchParams.has("q")).toBe(false);
    }
  });

  it("renders the CDN URL returned by catalog search when cover provenance is unresolved", async () => {
    const coverUrl = "https://covers.pliegolibros.com/covers/editions/v2/PLG-BK-000001-52ead14866be.webp";
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(requestUrl(input), "http://localhost");
      if (url.pathname.endsWith("/catalog/categories")) return jsonResponse({ items: [] });
      if (url.pathname.endsWith("/catalog/filter-options")) {
        return jsonResponse({ languages: ["es"], formats: [], minimumPrice: "18.50", maximumPrice: "18.50" });
      }
      if (url.pathname.endsWith("/catalog/editions")) {
        return jsonResponse({
          items: [{
            editionId: "250",
            bookId: "80",
            title: "Don Quijote de la Mancha",
            authors: "Miguel de Cervantes",
            publisher: "Editorial Ejemplo",
            isbn13: "9780306406157",
            price: "18.50",
            coverUrl,
            coverLicense: null,
            coverAttribution: null,
            format: "PAPERBACK",
            language: "es",
            available: true,
          }],
          page: 0,
          pageSize: 20,
          totalCount: "1",
        });
      }
      return jsonResponse({}, 404);
    }));

    renderCatalog();

    const link = await screen.findByRole("link", { name: "Ver edición: Don Quijote de la Mancha. Editorial Ejemplo, Rústica · Español" });
    const image = link.querySelector("img")!;
    expect(image).toHaveAttribute("alt", "");
    expect(image).toHaveAttribute("src", coverUrl);
    expect(image).toHaveAttribute("loading", "lazy");
  });

  it("preserves P2022 category recovery and keeps the search when removing the category", async () => {
    const requestedCategories: Array<string | null> = [];
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(requestUrl(input), "http://localhost");
      if (url.pathname.endsWith("/catalog/categories")) return jsonResponse({ items: [] });
      if (url.pathname.endsWith("/catalog/filter-options")) return jsonResponse({ languages: ["es"], formats: [], minimumPrice: "7.25", maximumPrice: "38.00" });
      if (url.pathname.endsWith("/catalog/editions")) {
        const category = url.searchParams.get("category");
        requestedCategories.push(category);
        if (category) {
          return new Response(JSON.stringify({
            title: "Categoría no disponible",
            detail: "La categoría ya no está activa.",
            status: 409,
            code: "P2022",
          }), { status: 409, headers: { "Content-Type": "application/problem+json" } });
        }
        return jsonResponse({ items: [], page: 0, pageSize: 20, totalCount: "0" });
      }
      return jsonResponse({}, 404);
    }));

    const user = userEvent.setup();
    renderCatalog("/catalog?que=Julio&category=inactiva");

    const results = await screen.findByRole("region", { name: "Resultados" });
    expect(await within(results).findByRole("alert")).toHaveTextContent("La categoría ya no está activa.");
    await user.click(within(results).getByRole("button", { name: "Quitar categoría" }));

    await waitFor(() => expect(screen.getByRole("heading", { name: "No encontramos ediciones con estos criterios." })).toBeInTheDocument());
    await user.click(screen.getByRole("button", { name: "Buscar libros en el catálogo" }));
    expect(await screen.findByRole("searchbox", { name: "Buscar en el catálogo" })).toHaveValue("Julio");
    expect(requestedCategories).toEqual(["inactiva", null]);
  });
});

it("keeps the collection and bestseller order when clearing filters in an empty scoped catalog", async () => {
  const requested: string[] = [];
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
    const url = new URL(requestUrl(input));
    if (url.pathname.endsWith("/categories")) return jsonResponse({ items: [] });
    if (url.pathname.endsWith("/filter-options")) return jsonResponse({ languages: [], formats: [], minimumPrice: null, maximumPrice: null });
    requested.push(url.search);
    return jsonResponse({ items: [], page: 0, pageSize: 20, totalCount: "0" });
  }));
  const user = userEvent.setup();
  renderCatalog("/catalog?productType=EBOOK&category=tema-antiguo&language=en&sort=BEST_SELLING");
  await user.click(await screen.findByRole("link", { name: "Limpiar filtros" }));
  await waitFor(() => expect(requested).toContain("?productType=EBOOK&sort=BEST_SELLING&page=0&pageSize=20"));
});
