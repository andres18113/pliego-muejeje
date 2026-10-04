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
  it("lets topic chips choose a real category set and dots move through its books", async () => {
    const requested: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(input instanceof Request ? input.url : String(input), "http://localhost");
      if (url.pathname.endsWith("/catalog/editions")) requested.push(`${url.searchParams.get("category")}:${url.searchParams.get("pageSize")}`);
      const category = url.searchParams.get("category");
      const items = category === "literatura" ? editions.slice(4, 8) : editions.slice(0, 4);
      const body = url.pathname.endsWith("/catalog/categories") ? { items: categories }
        : { items, page: 0, pageSize: 4, totalCount: "12" };
      return new Response(JSON.stringify(body), { headers: { "Content-Type": "application/json" } });
    }));
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const router = createMemoryRouter([{ path: "/", element: <CatalogHomePage /> }]);
    const { container } = render(<PliegoThemeProvider><QueryClientProvider client={client}>
      <SessionProvider restoreOnMount={false}><RouterProvider router={router} /></SessionProvider>
    </QueryClientProvider></PliegoThemeProvider>);
    await screen.findByRole("link", { name: "Edición 1" });
    expect(requested).toEqual(expect.arrayContaining(["filosofia:4", "literatura:4"]));
    const scene = screen.getByRole("heading", { name: "Tu próxima lectura." }).closest("section")!;
    const topics = within(scene).getByRole("group", { name: "Elige un tema" });
    expect(within(topics).getByRole("button", { name: "Filosofía" })).toHaveAttribute("aria-pressed", "true");
    expect(scene.querySelectorAll("[data-reading-scene]")).toHaveLength(4);
    expect(within(scene).getByRole("button", { name: "Agregar al carrito: Edición 3" })).toBeDisabled();
    const dots = within(scene).getByRole("group", { name: "Libros de Filosofía" });
    expect(within(dots).getAllByRole("button")).toHaveLength(4);
    expect(within(dots).getByRole("button", { name: "Libro 1 de 4: Edición 1" })).toHaveAttribute("aria-current", "true");
    expect(within(scene).getByRole("link", { name: "Ver los 12 libros de Filosofía" })).toHaveAttribute("href", "/catalog?category=filosofia");

    fireEvent.click(within(topics).getByRole("button", { name: "Literatura" }));
    expect(within(topics).getByRole("button", { name: "Literatura" })).toHaveAttribute("aria-pressed", "true");
    expect(await within(scene).findByRole("link", { name: "Edición 5" })).toBeInTheDocument();
    expect(within(scene).queryByRole("link", { name: "Edición 1" })).not.toBeInTheDocument();
    expect(within(scene).getByRole("group", { name: "Libros de Literatura" })).toBeInTheDocument();
    expect(container.querySelector("[data-reading-track]")).toHaveAttribute("data-active", "0");
  });
});
