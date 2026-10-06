import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { createMemoryRouter, RouterProvider } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SessionProvider } from "@/app/session";
import { PliegoThemeProvider } from "@/theme/PliegoThemeProvider";
import { storefrontNavigationFixture } from "@/test/storefrontFixture";
import { CatalogHomePage } from "./CatalogHomePage";

const editions = Array.from({ length: 8 }, (_, index) => ({
  editionId: String(index + 1), bookId: String(index + 100), isbn13: null, title: `Edición ${index + 1}`, authors: "Autor de prueba", publisher: "Editorial de prueba",
  format: "PAPERBACK", language: "es", price: "20.00", available: index !== 2,
  coverUrl: null, coverLicense: null, coverAttribution: null,
}));

afterEach(() => vi.unstubAllGlobals());

describe("Home", () => {
  it("opens on the brand with one entry point per way of reading and the projection's featured titles", async () => {
    const featured = (productType: "PHYSICAL" | "EBOOK" | "AUDIOBOOK", id: string, title: string) => ({ editionId: id, bookId: id, title, authors: "Autora de prueba", coverUrl: null, format: productType === "PHYSICAL" ? "PAPERBACK" as const : productType, productType, price: "12.00", offer: null, href: `/catalog/editions/${id}` });
    const navigation = { sections: storefrontNavigationFixture.sections.map((section) => section.key === "PHYSICAL" ? { ...section, featured: [featured("PHYSICAL", "71", "Libro destacado")], bestSellingHref: "/catalog?productType=PHYSICAL&sort=BEST_SELLING" }
      : section.key === "AUDIOBOOK" ? { ...section, featured: [featured("AUDIOBOOK", "72", "Audiolibro destacado")] } : section) };
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(input instanceof Request ? input.url : String(input), "http://localhost");
      const body = url.pathname.endsWith("/storefront/navigation") ? navigation : url.pathname.endsWith("/catalog/categories") ? { items: [] } : { items: [], page: 0, pageSize: 4, totalCount: "0" };
      return new Response(JSON.stringify(body), { headers: { "Content-Type": "application/json" } });
    }));
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(<PliegoThemeProvider><QueryClientProvider client={client}><SessionProvider restoreOnMount={false}><RouterProvider router={createMemoryRouter([{ path: "/", element: <CatalogHomePage /> }])} /></SessionProvider></QueryClientProvider></PliegoThemeProvider>);
    const hero = screen.getByRole("heading", { level: 1, name: "Descubre el mundo de PLIEGO." }).closest("section")!;
    expect(await within(hero).findByRole("link", { name: "Explorar libros" })).toHaveAttribute("href", "/catalog?productType=PHYSICAL");
    expect(within(hero).getAllByRole("heading", { level: 2 }).map((heading) => heading.textContent)).toEqual(["Libros", "eBooks", "Audiolibros"]);
    expect(within(hero).getByRole("link", { name: "Explorar eBooks" })).toHaveAttribute("href", "/catalog?productType=EBOOK");
    // Each format shows its own photograph, in order, not a catalog jacket.
    const photos = [...hero.querySelectorAll<HTMLImageElement>("li img")];
    expect(photos.map((photo) => photo.getAttribute("src"))).toEqual([expect.stringContaining("discovery-libros"), expect.stringContaining("discovery-ebooks"), expect.stringContaining("discovery-audiolibros")]);
    expect(hero.querySelectorAll(".book-cover")).toHaveLength(0);
    fireEvent.error(photos[0]);
    expect(hero.querySelectorAll("li")[0].querySelector(".book-cover")).not.toBeNull();
    expect(hero.querySelectorAll("li")[1].querySelector(".book-cover")).toBeNull();
    expect(within(hero).getByRole("link", { name: "Explorar audiolibros" })).toHaveAttribute("href", "/catalog?productType=AUDIOBOOK");
    const popular = screen.getByRole("heading", { name: "Popular en PLIEGO" }).closest("section")!;
    // The Home is the opening and the popular row; the legacy reading, feature and topic sections are gone.
    expect(within(screen.getByRole("main")).getAllByRole("heading", { level: 2 }).map((heading) => heading.textContent)).toEqual(["Libros", "eBooks", "Audiolibros", "Popular en PLIEGO", "Buenas lecturas, mejor precio.", "¿Necesitas ayuda?", "¿Por qué comprar en PLIEGO?", "Ya está. Ahora solo falta encontrar tu próxima historia."]);
    expect(screen.queryByRole("navigation", { name: "Explora por tema" })).not.toBeInTheDocument();
    expect(screen.getByRole("main").querySelectorAll(":scope section")).toHaveLength(5);
    // The footer: the storefront's sections, the customer's places, Help; how to pay; one legal line.
    const footer = screen.getByRole("contentinfo"), footerNav = within(footer).getByRole("navigation", { name: "Navegación del pie de página" });
    expect(within(footerNav).getAllByRole("heading").map((heading) => heading.textContent)).toEqual(["Explorar", "Tu PLIEGO", "Ayuda"]);
    expect(within(footerNav).getAllByRole("link").map((link) => `${link.textContent}→${link.getAttribute("href")}`)).toEqual([
      "Libros→/catalog?productType=PHYSICAL", "eBooks→/catalog?productType=EBOOK", "Audiolibros→/catalog?productType=AUDIOBOOK", "Ofertas→/ofertas",
      "Mi biblioteca→/biblioteca", "Favoritos→/favorites", "Carrito→/cart", "Mi cuenta→/account", "Ayuda→/ayuda",
    ]);
    expect(within(within(footer).getByRole("list", { name: "Métodos de pago" })).getAllByRole("img").map((mark) => mark.getAttribute("aria-label"))).toEqual(["Visa", "Mastercard", "American Express", "Diners Club"]);
    expect(within(footer).getByText("Transferencia bancaria")).toBeInTheDocument();
    expect(within(footer).getByText("© 2026-2026 PLIEGO")).toBeInTheDocument();
    // The closing card speaks about reading, with a small thank-you; nothing about subscriptions.
    const closing = screen.getByRole("heading", { name: "Ya está. Ahora solo falta encontrar tu próxima historia." }).closest("section")!;
    expect(within(closing).getByText("¡Muchas gracias!")).toBeInTheDocument();
    expect(closing).not.toHaveTextContent(/suscri|bolet[ií]n|newsletter|correo|Google/i);
    // Why PLIEGO: exactly four benefits, each with one link to a real destination.
    const benefits = screen.getByRole("heading", { name: "¿Por qué comprar en PLIEGO?" }).closest("section")!;
    expect(within(benefits).getAllByRole("heading", { level: 3 }).map((heading) => heading.textContent)).toEqual(["Todo en un solo lugar.", "Envío gratis.", "Ofertas que sí valen la pena.", "Ayuda cuando la necesites."]);
    expect(within(benefits).getAllByRole("link").map((link) => link.getAttribute("href"))).toEqual(["/catalog", "/catalog?productType=PHYSICAL", "/ofertas", "/ayuda"]);
    expect(benefits.querySelectorAll("img, svg")).toHaveLength(0);
    // Two ways onward, each to the destination the projection gives; Ayuda is where the character lives now.
    const onward = screen.getByRole("region", { name: "Ofertas y ayuda" });
    expect(within(onward).getByRole("link", { name: "Ver ofertas" })).toHaveAttribute("href", "/ofertas");
    expect(within(onward).getByRole("link", { name: "Ir a Ayuda" })).toHaveAttribute("href", "/ayuda");
    expect(onward.querySelectorAll("img")).toHaveLength(0);
    expect(onward.querySelectorAll('[data-destination="HELP"] svg[aria-hidden="true"]')).toHaveLength(1);
    expect(hero.querySelectorAll("svg")).toHaveLength(0);
    // One row of featured titles in the projection's order: books first, then the other formats. No category panels.
    const items = [...popular.querySelectorAll<HTMLElement>("[data-media]")];
    expect(items.map((item) => item.getAttribute("data-media"))).toEqual(["PHYSICAL", "AUDIOBOOK"]);
    expect(within(items[0]).getByRole("link", { name: "Libro destacado" })).toHaveAttribute("href", "/catalog/editions/71");
    expect(items[0]).toHaveTextContent("Autora de prueba");
    expect(items[0]).toHaveTextContent(/12,00/);
    expect(within(items[1]).getByRole("link", { name: "Audiolibro destacado" })).toHaveAttribute("href", "/catalog/editions/72");
    // Every title says its medium once, in the same quiet line.
    expect(within(items[0]).getByText("Libro")).toBeInTheDocument();
    expect(within(items[1]).getByText("Audiolibro")).toBeInTheDocument();
    expect(within(popular).queryAllByRole("heading", { level: 3 })).toHaveLength(0);
    expect(within(popular).queryByRole("link", { name: /Explorar/ })).not.toBeInTheDocument();
    // With a single page there is nowhere to move, so the carousel offers no controls.
    expect(within(popular).queryByRole("button", { name: "Más títulos" })).not.toBeInTheDocument();
    // The bestseller destination appears once per section that the server gives it for.
    expect(within(popular).getByRole("link", { name: "Más vendidos: Libros" })).toHaveAttribute("href", "/catalog?productType=PHYSICAL&sort=BEST_SELLING");
    expect(within(popular).queryByRole("link", { name: "Más vendidos: Audiolibros" })).not.toBeInTheDocument();
  });
  it("continues the popular row with more books from the catalog's bestseller order, without repeating a title", async () => {
    const featured = (id: string, title: string) => ({ editionId: id, bookId: id, title, authors: "Autora de prueba", coverUrl: null, format: "PAPERBACK" as const, productType: "PHYSICAL" as const, price: "12.00", offer: null, href: `/catalog/editions/${id}` });
    const navigation = { sections: storefrontNavigationFixture.sections.map((section) => section.key === "PHYSICAL" ? { ...section, featured: [featured("1", "Edición 1"), featured("2", "Edición 2")], bestSellingHref: "/catalog?productType=PHYSICAL&sort=BEST_SELLING" } : section) };
    const requested: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(input instanceof Request ? input.url : String(input), "http://localhost");
      const bestSelling = url.pathname.endsWith("/catalog/editions") && url.searchParams.get("sort") === "BEST_SELLING";
      if (bestSelling) requested.push(`${url.searchParams.get("productType")}:${url.searchParams.get("pageSize")}`);
      const body = url.pathname.endsWith("/storefront/navigation") ? navigation : url.pathname.endsWith("/catalog/categories") ? { items: [] } : { items: bestSelling ? editions : [], page: 0, pageSize: 13, totalCount: "8" };
      return new Response(JSON.stringify(body), { headers: { "Content-Type": "application/json" } });
    }));
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(<PliegoThemeProvider><QueryClientProvider client={client}><SessionProvider restoreOnMount={false}><RouterProvider router={createMemoryRouter([{ path: "/", element: <CatalogHomePage /> }])} /></SessionProvider></QueryClientProvider></PliegoThemeProvider>);
    const popular = (await screen.findByRole("heading", { name: "Popular en PLIEGO" })).closest("section")!;
    expect(await within(popular).findByRole("link", { name: "Edición 8", hidden: true })).toHaveAttribute("href", "/catalog/editions/8");
    expect(requested).toEqual(["PHYSICAL:13"]);
    // The server's order is kept; the two titles already shown are not repeated.
    expect([...popular.querySelectorAll("[data-media] a")].map((link) => link.textContent)).toEqual(["Edición 1", "Edición 2", "Edición 3", "Edición 4", "Edición 5", "Edición 6", "Edición 7", "Edición 8"]);
    const previous = within(popular).getByRole("button", { name: "Títulos anteriores" }), next = within(popular).getByRole("button", { name: "Más títulos" });
    expect(previous).toHaveAttribute("aria-disabled", "true");
    expect(next).toHaveAttribute("aria-disabled", "false");
    expect(popular.querySelectorAll("[data-media]:not([inert])")).toHaveLength(5);
    fireEvent.click(next);
    expect(within(popular).getByRole("button", { name: "Página 2 de 2" })).toHaveAttribute("aria-current", "true");
    expect(next).toHaveAttribute("aria-disabled", "true");
    expect(previous).toHaveAttribute("aria-disabled", "false");
    fireEvent.click(next);
    expect(within(popular).getByRole("button", { name: "Página 2 de 2" })).toHaveAttribute("aria-current", "true");
    fireEvent.click(previous);
    expect(within(popular).getByRole("button", { name: "Página 1 de 2" })).toHaveAttribute("aria-current", "true");
  });
});
