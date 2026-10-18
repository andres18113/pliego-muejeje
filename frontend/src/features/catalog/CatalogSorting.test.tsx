import { PliegoThemeProvider } from "@/theme/PliegoThemeProvider";
import { SessionProvider } from "@/app/session";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createMemoryRouter, RouterProvider } from "react-router-dom";
import { afterEach, expect, it, vi } from "vitest";
import { CatalogPage } from "./CatalogPage";

const summary = (editionId: string, title: string) => ({ editionId, title, bookId: editionId,
  authors: "Autora", publisher: "Editorial", isbn13: null, price: "10.00", coverUrl: null,
  coverLicense: null, coverAttribution: null, format: "EBOOK", language: "es", available: true,
  ebookFileFormat: "EPUB", audioDurationSeconds: null, narrators: [] });
afterEach(() => vi.unstubAllGlobals());

it("switches title direction through the API, resets pagination, and preserves filters/history", async () => {
  const requests: URL[] = [];
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
    const url = new URL(input instanceof Request ? input.url : input.toString());
    let payload: unknown = {};
    if (url.pathname.endsWith("/catalog/categories")) payload = { items: [{ slug: "matematicas", name: "Matemáticas", parentSlug: null }] };
    else if (url.pathname.endsWith("/catalog/filter-options")) payload = { languages: ["es"], formats: ["EBOOK"], minimumPrice: "10.00", maximumPrice: "10.00" };
    else if (url.pathname.endsWith("/catalog/editions")) {
      requests.push(url);
      // Render exactly the backend's order; the client must not reorder a page.
      const descending = url.searchParams.get("sort") === "TITLE_DESC";
      payload = { items: descending ? [summary("2", "Anestesiología"), summary("1", "Análisis matemático")]
        : [summary("1", "Análisis matemático"), summary("2", "Anestesiología")],
        page: Number(url.searchParams.get("page")), pageSize: 2, totalCount: "6" };
    }
    return new Response(JSON.stringify(payload), { status: 200, headers: { "Content-Type": "application/json" } });
  }));
  const initial = "/catalog?que=Autora&category=matematicas&productType=EBOOK&language=es&format=EBOOK&minPrice=10&maxPrice=20&page=1&pageSize=2";
  const router = createMemoryRouter([{ path: "/catalog", element: <CatalogPage /> }], { initialEntries: [initial] });
  render(<PliegoThemeProvider><QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    <SessionProvider restoreOnMount={false}><RouterProvider router={router} /></SessionProvider>
  </QueryClientProvider></PliegoThemeProvider>);
  await screen.findByRole("heading", { name: "Análisis matemático" });
  await userEvent.click(screen.getByRole("combobox", { name: "Ordenar por" }));
  await userEvent.click(screen.getByRole("option", { name: "Título: Z–A" }));
  await waitFor(() => expect(requests.at(-1)?.searchParams.get("sort")).toBe("TITLE_DESC"));
  expect(Object.fromEntries(requests.at(-1)!.searchParams)).toMatchObject({ que: "Autora", category: "matematicas", productType: "EBOOK", language: "es", format: "EBOOK", minPrice: "10.00", maxPrice: "20.00", page: "0", pageSize: "2", sort: "TITLE_DESC" });
  await waitFor(() => expect(screen.getAllByRole("heading").filter(h => h.closest("[data-bookcard]")).map(h => h.textContent)).toEqual(["Anestesiología", "Análisis matemático"]));
  await userEvent.click(screen.getByRole("link", { name: "Siguiente" }));
  await waitFor(() => expect(requests.at(-1)?.searchParams.get("page")).toBe("1"));
  expect(requests.at(-1)?.searchParams.get("sort")).toBe("TITLE_DESC");
  await act(() => router.navigate(-1));
  expect(new URLSearchParams(router.state.location.search).get("sort")).toBe("TITLE_DESC");
  await act(() => router.navigate(-1));
  expect(router.state.location.pathname + router.state.location.search).toBe(initial);
});
