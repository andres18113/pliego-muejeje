import { render, screen, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { afterEach, expect, it, vi } from "vitest";
import { SessionProvider } from "@/app/session";
import { PliegoThemeProvider } from "@/theme/PliegoThemeProvider";
import { SiteHeader } from "./SiteHeader";

afterEach(() => vi.unstubAllGlobals());

it("keeps four destinations separate from thematic categories", () => {
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ items: [
    { slug: "literatura", name: "Literatura", parentSlug: null },
  ] }), { status: 200, headers: { "Content-Type": "application/json" } })));
  render(<PliegoThemeProvider><QueryClientProvider client={new QueryClient()}><SessionProvider restoreOnMount={false}>
    <MemoryRouter><SiteHeader /></MemoryRouter>
  </SessionProvider></QueryClientProvider></PliegoThemeProvider>);
  const navigation = within(screen.getByRole("navigation", { name: "Navegación principal" }));
  expect(navigation.getAllByRole("link").map((link) => link.textContent)).toEqual(["Libros", "eBooks", "Audiolibros", "Ofertas"]);
  expect(navigation.getByRole("link", { name: "Libros" })).toHaveAttribute("href", "/catalog");
  expect(navigation.getByRole("link", { name: "eBooks" })).toHaveAttribute("href", "/catalog?format=EBOOK");
  expect(navigation.getByRole("link", { name: "Ofertas" })).toHaveAttribute("href", "/ofertas");
  expect(navigation.queryByText("Literatura")).not.toBeInTheDocument();
});
