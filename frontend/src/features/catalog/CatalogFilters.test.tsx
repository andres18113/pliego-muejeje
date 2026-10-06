import { PliegoThemeProvider } from "@/theme/PliegoThemeProvider";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { CatalogFilterPanel, CatalogFilters } from "./CatalogFilters";
import { readCatalogCriteria } from "./catalogUrl";
import { catalogFacets, clearAuxiliaryFilters } from "./catalogFacets";
const options = { formats: ["PAPERBACK", "HARDCOVER"] as ("PAPERBACK" | "HARDCOVER")[], languages: ["es"], minimumPrice: "20.00", maximumPrice: "20.00" };
function show(search = "", metadata = options) {
  const apply = vi.fn();
  render(<PliegoThemeProvider><CatalogFilters criteria={readCatalogCriteria(search)} options={metadata} error="" opened onClose={() => {}} onApply={apply} onRetry={() => {}} /></PliegoThemeProvider>);
  return apply;
}
describe("catalog facets", () => {
  it("uses backend-authoritative formats without guessing eligibility from productType", () => {
    const response = { ...options, formats: ["EBOOK"] as const };
    expect(catalogFacets({ ...response, formats: [...response.formats] }, readCatalogCriteria("?productType=PHYSICAL")).formats).toEqual(["EBOOK"]);
  });
  it("omits single-valued facets and recovers active historical URL values", () => {
    const available = catalogFacets(options, readCatalogCriteria(""));
    expect(available).toMatchObject({ format: true, language: false });
    expect(available.sorts.map(sort => sort.value)).toEqual(["BEST_SELLING", "TITLE_ASC"]);
    const historical = catalogFacets(undefined, readCatalogCriteria("?language=en&minPrice=10&sort=PRICE_DESC"));
    expect(historical).toMatchObject({ format: false, language: true });
    expect(historical.sorts.map(sort => sort.value)).toContain("PRICE_DESC");
  });
  it("reset preserves search, theme and ordering while returning to page one", () => {
    const result = clearAuxiliaryFilters(readCatalogCriteria("?que=Cien&category=literatura&format=HARDCOVER&sort=PRICE_DESC&page=2"));
    expect(result).toMatchObject({ query: "Cien", category: "literatura", sort: "PRICE_DESC", page: 0, format: "" });
  });
});
describe("CatalogFilters", () => {
  it("retains selected absent category, format and language controls with empty metadata", async () => {
    const apply = vi.fn();
    render(<PliegoThemeProvider><CatalogFilterPanel criteria={readCatalogCriteria("?productType=EBOOK&category=tema-antiguo&format=HARDCOVER&language=en&minPrice=10&maxPrice=40&page=2")} options={{ languages: [], formats: [], minimumPrice: null, maximumPrice: null }} categories={[]} error="" onApply={apply} onRetry={() => {}} /></PliegoThemeProvider>);
    expect(screen.getByRole("radio", { name: "tema-antiguo" })).toBeChecked();
    expect(screen.getByRole("radio", { name: "Tapa dura" })).toBeChecked();
    expect(screen.getByRole("radio", { name: "Inglés" })).toBeChecked();
    await userEvent.click(screen.getByRole("radio", { name: "Todos los temas" }));
    expect(apply).toHaveBeenCalledWith(expect.objectContaining({ productType: "EBOOK", category: "", format: "HARDCOVER", language: "en", minPrice: "10.00", maxPrice: "40.00", page: 0 }));
  });
  it("offers only real format choices and applies a choice immediately", async () => {
    const apply = show("?category=literatura&que=Libro&page=2");
    expect(screen.queryByRole("group", { name: "Idioma" })).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Precio (USD)" })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Formato" }));
    expect(screen.getByRole("group", { name: "Formato" })).toBeInTheDocument();
    await userEvent.click(screen.getByRole("radio", { name: "Tapa dura" }));
    expect(apply).toHaveBeenCalledWith(expect.objectContaining({ format: "HARDCOVER", category: "literatura", query: "Libro", page: 0 }));
  });
  it("clears historical monetary criteria while preserving collection, search and ordering", async () => {
    const apply = show("?productType=EBOOK&que=Libro&minPrice=10&maxPrice=40&sort=PRICE_DESC&page=2", { ...options, minimumPrice: "1.00", maximumPrice: "90.00" });
    await userEvent.click(screen.getByRole("button", { name: "Restablecer filtros" }));
    expect(apply).toHaveBeenCalledWith(expect.objectContaining({ productType: "EBOOK", query: "Libro", sort: "PRICE_DESC", minPrice: "", maxPrice: "", page: 0 }));
  });
  it("can clear a current filter even when metadata is no longer available", async () => {
    const apply = show("?format=HARDCOVER&category=literatura");
    await userEvent.click(screen.getByRole("button", { name: "Restablecer filtros" }));
    expect(apply).toHaveBeenCalledWith(expect.objectContaining({ format: "", category: "" }));
  });
});
