import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { createMemoryRouter, RouterProvider } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SessionProvider } from "@/app/session";
import { PliegoThemeProvider } from "@/theme/PliegoThemeProvider";
import { CatalogHomePage } from "./CatalogHomePage";

const editions = Array.from({ length: 10 }, (_, index) => ({
  editionId: String(index + 1), bookId: String(index + 100), isbn13: null, title: `Edición ${index + 1}`, authors: "Autor de prueba", publisher: "Editorial de prueba",
  format: "PAPERBACK", language: "es", price: "20.00", available: index !== 2,
  coverUrl: null, coverLicense: null, coverAttribution: null,
}));

afterEach(() => vi.unstubAllGlobals());

describe("Home storefront shelf", () => {
  it("requests eight real editions in a horizontal rail without presenting a results counter", async () => {
    let requested: URL | undefined;
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(input instanceof Request ? input.url : String(input), "http://localhost");
      if (url.pathname.endsWith("/catalog/editions")) requested = url;
      const body = url.pathname.endsWith("/catalog/categories") ? { items: [] }
        : { items: editions, page: 0, pageSize: 8, totalCount: "12" };
      return new Response(JSON.stringify(body), { headers: { "Content-Type": "application/json" } });
    }));
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const router = createMemoryRouter([{ path: "/", element: <CatalogHomePage /> }]);
    const { container } = render(<PliegoThemeProvider><QueryClientProvider client={client}>
      <SessionProvider restoreOnMount={false}><RouterProvider router={router} /></SessionProvider>
    </QueryClientProvider></PliegoThemeProvider>);
    await screen.findByRole("link", { name: /Ver edición: Edición 1/ });
    expect(requested?.searchParams.get("pageSize")).toBe("8");
    expect(container.querySelectorAll("[data-bookcard]")).toHaveLength(8);
    expect(container.querySelector('[data-presentation="rail"]')).toBeInTheDocument();
    expect(screen.queryByText("Edición 9")).not.toBeInTheDocument();
    expect(container.querySelector(".discovery-count")).toBeNull();
    expect(screen.queryByRole("link", { name: "Explorar catálogo" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Agregar al carrito: Edición 3" })).toBeDisabled();
  });
});
