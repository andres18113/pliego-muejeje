import { fireEvent, render, screen, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { afterEach, expect, it, vi } from "vitest";
import { SessionProvider } from "@/app/session";
import { PliegoThemeProvider } from "@/theme/PliegoThemeProvider";
import { storefrontNavigationFixture } from "@/test/storefrontFixture";
import { SiteHeader } from "./SiteHeader";

afterEach(() => vi.unstubAllGlobals());

function renderHeader(path = "/", projection = storefrontNavigationFixture) {
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify(projection), { status: 200, headers: { "Content-Type": "application/json" } })));
  mountHeader(path);
}

function mountHeader(path = "/catalog") {
  render(<PliegoThemeProvider><QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false, retryDelay: 0 } } })}><SessionProvider restoreOnMount={false}>
    <MemoryRouter initialEntries={[path]}><SiteHeader /></MemoryRouter>
  </SessionProvider></QueryClientProvider></PliegoThemeProvider>);
}

it("uses the server's ordered destinations and product type links, including Help", async () => {
  renderHeader("/", { sections: [...storefrontNavigationFixture.sections.slice(4), ...storefrontNavigationFixture.sections.slice(0, 4)].map(section => section.key === "PHYSICAL" ? { ...section, label: "Libros impresos", categories: [{ slug: "literatura", name: "Literatura", parentSlug: null, href: "/catalog?productType=PHYSICAL&category=literatura" }] } : section) });
  await screen.findByRole("button", { name: "Libros impresos" });
  const navigation = within(screen.getByRole("navigation", { name: "Navegación principal" }));
  expect(within(navigation.getByRole("list")).getAllByRole("listitem").map((item) => item.textContent?.replace("expand_more", ""))).toEqual(["Ayuda", "Libros impresos", "eBooks", "Audiolibros", "Ofertas"]);
  // A section with subjects opens a menu; its own destination is the menu's "Explorar todos".
  expect(navigation.getByRole("button", { name: "Libros impresos" })).toHaveAttribute("aria-expanded", "false");
  expect(navigation.getByRole("link", { name: "eBooks" })).toHaveAttribute("href", "/catalog?productType=EBOOK");
  expect(navigation.getByRole("link", { name: "Ofertas" })).toHaveAttribute("href", "/ofertas");
  expect(navigation.getByRole("link", { name: "Ayuda" })).toHaveAttribute("href", "/ayuda");
  expect(navigation.queryByText("Literatura")).not.toBeInTheDocument();
});

it("marks the selected server product type even with additional catalog filters", async () => {
  renderHeader("/catalog?productType=EBOOK&category=literatura");
  expect(await screen.findByRole("link", { name: "eBooks" })).toHaveAttribute("aria-current", "page");
  expect(screen.getByRole("link", { name: /^Libros$/ })).not.toHaveAttribute("aria-current");
});

it("uses the same Help destination and selected state in mobile navigation", async () => {
  renderHeader("/ayuda/articulos/comprar");
  expect(await screen.findByRole("link", { name: "Ayuda" })).toHaveAttribute("aria-current", "page");
  fireEvent.click(screen.getByRole("button", { name: "Abrir navegación" }));
  const mobile = within(screen.getByRole("dialog", { name: "Navegación" }));
  expect(mobile.getByRole("link", { name: "Ayuda" })).toHaveAttribute("href", "/ayuda");
  expect(mobile.getByRole("link", { name: "Ayuda" })).toHaveAttribute("aria-current", "page");
});


it.each([false, true])("recovers server navigation on a nonhome route (mobile: %s)", async (mobile) => {
  let failed = true;
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify(failed
    ? { status: 503, title: "Navegación no disponible", detail: "Inténtalo otra vez." }
    : storefrontNavigationFixture), { status: failed ? 503 : 200, headers: { "Content-Type": "application/json" } })));
  mountHeader("/catalog");
  if (mobile) fireEvent.click(screen.getByRole("button", { name: "Abrir navegación" }));
  const navigation = within(mobile ? screen.getByRole("dialog", { name: "Navegación" }) : screen.getByRole("navigation", { name: "Navegación principal" }));
  expect(await navigation.findByRole("alert")).toHaveTextContent("No pudimos cargar la navegación.");
  expect(navigation.queryByRole("link", { name: "Ayuda" })).not.toBeInTheDocument();
  failed = false;
  fireEvent.click(navigation.getByRole("button", { name: "Reintentar navegación" }));
  expect(await navigation.findByRole("link", { name: "Ayuda" })).toHaveAttribute("href", "/ayuda");
  expect(navigation.queryByRole("alert")).not.toBeInTheDocument();
});

it("announces loading on nonhome routes without fabricating destinations", () => {
  vi.stubGlobal("fetch", vi.fn(() => new Promise<Response>(() => {})));
  mountHeader("/catalog");
  const navigation = within(screen.getByRole("navigation", { name: "Navegación principal" }));
  expect(navigation.getByRole("status")).toHaveTextContent("Cargando navegación…");
  expect(navigation.queryByRole("link", { name: "Ayuda" })).not.toBeInTheDocument();
});

const richNavigation = { sections: storefrontNavigationFixture.sections.map(section => section.key === "PHYSICAL" || section.key === "EBOOK" ? { ...section,
  bestSellingHref: `${section.href}&sort=BEST_SELLING`, offersHref: section.key === "PHYSICAL" ? "/ofertas?productType=PHYSICAL" : null, activeOfferCount: section.key === "PHYSICAL" ? "3" : "0",
  featured: section.key === "PHYSICAL" ? [{ editionId: "42", bookId: "7", title: "Rayuela", authors: "Julio Cortázar", coverUrl: null, format: "PAPERBACK" as const, productType: "PHYSICAL" as const, price: "16.00", href: "/catalog/editions/42",
    offer: { offerId: "5", originalPrice: "20.00", discountAmount: "4.00", effectivePrice: "16.00", savingsAmount: "4.00", savingsPercent: "20.00", startsAt: "2026-10-01T00:00:00-05:00", endsAt: "2026-10-31T23:59:00-05:00", daysRemaining: 26, endingSoon: false } }] : [],
  categories: [{ slug: "literatura", name: "Literatura", parentSlug: null, href: `${section.href}&category=literatura` }, { slug: "novela", name: "Novela", parentSlug: "literatura", href: `${section.href}&category=novela` }],
} : section) };

it("opens one section menu at a time with only the destinations the server supplies", async () => {
  renderHeader("/", richNavigation);
  const books = await screen.findByRole("button", { name: "Libros" });
  fireEvent.click(books);
  const menu = within(screen.getByRole("region", { name: "Menú de Libros" }));
  expect(books).toHaveAttribute("aria-expanded", "true");
  expect(menu.getByRole("link", { name: "Explorar todos los libros" })).toHaveAttribute("href", "/catalog?productType=PHYSICAL");
  expect(menu.getByRole("link", { name: "Más vendidos: Libros" })).toHaveAttribute("href", "/catalog?productType=PHYSICAL&sort=BEST_SELLING");
  expect(menu.getByRole("link", { name: "Ofertas: Libros" })).toHaveTextContent("3");
  expect(menu.getByRole("link", { name: /Rayuela/ })).toHaveAttribute("href", "/catalog/editions/42");
  // Fast discovery, not a directory: no subject list in the panel.
  expect(menu.queryByRole("link", { name: "Literatura" })).not.toBeInTheDocument();
  expect(menu.queryByText("Temas")).not.toBeInTheDocument();

  fireEvent.click(screen.getByRole("button", { name: "eBooks" }));
  expect(screen.queryByRole("region", { name: "Menú de Libros" })).not.toBeInTheDocument();
  const ebooks = within(screen.getByRole("region", { name: "Menú de eBooks" }));
  expect(ebooks.queryByRole("link", { name: "Ofertas: eBooks" })).not.toBeInTheDocument();
  expect(ebooks.queryByRole("list", { name: "Destacados de eBooks" })).not.toBeInTheDocument();
  // Sections without secondary destinations stay direct links.
  expect(screen.getByRole("link", { name: "Ofertas" })).toHaveAttribute("href", "/ofertas");
  expect(screen.getByRole("link", { name: "Ayuda" })).toHaveAttribute("href", "/ayuda");
});

it("closes a section menu with Escape, restoring focus, and on a press outside", async () => {
  renderHeader("/", richNavigation);
  const books = await screen.findByRole("button", { name: "Libros" });
  fireEvent.click(books);
  const first = within(screen.getByRole("region", { name: "Menú de Libros" })).getByRole("link", { name: "Explorar todos los libros" });
  first.focus();
  fireEvent.keyDown(first, { key: "Escape" });
  expect(screen.queryByRole("region", { name: "Menú de Libros" })).not.toBeInTheDocument();
  expect(books).toHaveFocus();
  expect(books).toHaveAttribute("aria-expanded", "false");

  fireEvent.click(books);
  expect(screen.getByRole("region", { name: "Menú de Libros" })).toBeInTheDocument();
  fireEvent.pointerDown(document.body);
  expect(screen.queryByRole("region", { name: "Menú de Libros" })).not.toBeInTheDocument();
});

it("unfolds a section in place in the mobile sheet", async () => {
  renderHeader("/", richNavigation);
  await screen.findByRole("button", { name: "Libros" });
  fireEvent.click(screen.getByRole("button", { name: "Abrir navegación" }));
  const sheet = within(screen.getByRole("dialog", { name: "Navegación" }));
  expect(sheet.queryByRole("link", { name: "Literatura" })).not.toBeInTheDocument();
  fireEvent.click(sheet.getByRole("button", { name: "Libros" }));
  expect(sheet.getByRole("link", { name: "Explorar todos los libros" })).toHaveAttribute("href", "/catalog?productType=PHYSICAL");
  expect(sheet.getByRole("link", { name: /Rayuela/ })).toHaveAttribute("href", "/catalog/editions/42");
  expect(sheet.queryByRole("link", { name: "Literatura" })).not.toBeInTheDocument();
  expect(sheet.getByRole("link", { name: "Ayuda" })).toHaveAttribute("href", "/ayuda");
});
