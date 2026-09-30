import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createMemoryRouter, RouterProvider } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SessionProvider } from "@/app/session";
import { CatalogPage } from "./CatalogPage";

function renderCatalog(initialEntry = "/catalog") {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const router = createMemoryRouter([{ path: "/catalog", element: <CatalogPage /> }], { initialEntries: [initialEntry] });

  return render(
    <QueryClientProvider client={queryClient}>
      <SessionProvider restoreOnMount={false}>
        <RouterProvider router={router} />
      </SessionProvider>
    </QueryClientProvider>,
  );
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
  it("normalizes malformed URL criteria before making the catalog request", async () => {
    let requestedUrl: URL | undefined;
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(requestUrl(input), "http://localhost");
      if (url.pathname.endsWith("/catalog/categories")) return jsonResponse({ items: [] });
      if (url.pathname.endsWith("/catalog/filter-options")) return jsonResponse({ languages: ["es"], minimumPrice: "7.25", maximumPrice: "38.00" });
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
      if (url.pathname.endsWith("/catalog/filter-options")) return jsonResponse({ languages: ["es"], minimumPrice: "7.25", maximumPrice: "38.00" });
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
      if (url.pathname.endsWith("/catalog/filter-options")) return jsonResponse({ languages: ["es"], minimumPrice: "7.25", maximumPrice: "38.00" });
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
      if (url.pathname.endsWith("/catalog/filter-options")) return jsonResponse({ languages: ["es"], minimumPrice: "7.25", maximumPrice: "38.00" });
      if (url.pathname.endsWith("/catalog/editions")) {
        editionRequests.push(url);
        return jsonResponse({ items: [], page: 0, pageSize: 20, totalCount: "0" });
      }
      return jsonResponse({}, 404);
    }));

    const user = userEvent.setup();
    renderCatalog();
    expect(screen.queryByRole("combobox", { name: "Buscar por" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Buscar en el catálogo" })).toBeInTheDocument();

    for (const value of ["Cien años", "Cervantes", "978-0-306-40615-7"]) {
      await user.click(screen.getByRole("button", { name: "Buscar en el catálogo" }));
      const searchbox = screen.getByRole("searchbox", { name: "Buscar en el catálogo" });
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
        return jsonResponse({ languages: ["es"], minimumPrice: "18.50", maximumPrice: "18.50" });
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

    const image = await screen.findByRole("img", { name: "Portada de Don Quijote de la Mancha" });
    expect(image).toHaveAttribute("src", coverUrl);
    expect(image).toHaveAttribute("loading", "lazy");
  });

  it("preserves P2022 category recovery and keeps the search when removing the category", async () => {
    const requestedCategories: Array<string | null> = [];
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(requestUrl(input), "http://localhost");
      if (url.pathname.endsWith("/catalog/categories")) return jsonResponse({ items: [] });
      if (url.pathname.endsWith("/catalog/filter-options")) return jsonResponse({ languages: ["es"], minimumPrice: "7.25", maximumPrice: "38.00" });
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
    await user.click(screen.getByRole("button", { name: "Buscar en el catálogo" }));
    expect(screen.getByRole("searchbox", { name: "Buscar en el catálogo" })).toHaveValue("Julio");
    expect(requestedCategories).toEqual(["inactiva", null]);
  });
});
