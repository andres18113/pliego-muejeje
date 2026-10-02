import { PliegoThemeProvider } from "@/theme/PliegoThemeProvider";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { CatalogFilters } from "./CatalogFilters";
import { readCatalogCriteria } from "./catalogUrl";
import { catalogFacets, clearAuxiliaryFilters } from "./catalogFacets";
const options = { formats: ["PAPERBACK", "HARDCOVER"] as ("PAPERBACK" | "HARDCOVER")[], languages: ["es"], minimumPrice: "20.00", maximumPrice: "20.00" };
function show(search = "", metadata = options) {
  const apply = vi.fn();
  render(<PliegoThemeProvider><CatalogFilters criteria={readCatalogCriteria(search)} options={metadata} error="" opened onClose={() => {}} onApply={apply} onRetry={() => {}} /></PliegoThemeProvider>);
  return apply;
}
describe("catalog facets", () => {
  it("omits single-valued facets and recovers active historical URL values", () => {
    expect(catalogFacets(options, readCatalogCriteria(""))).toEqual({ format: true, language: false, price: false, priceSort: false });
    expect(catalogFacets(undefined, readCatalogCriteria("?language=en&minPrice=10&sort=PRICE_DESC"))).toEqual({ format: false, language: true, price: true, priceSort: true });
  });
  it("reset preserves search, theme and ordering while returning to page one", () => {
    const result = clearAuxiliaryFilters(readCatalogCriteria("?que=Cien&category=literatura&format=HARDCOVER&sort=PRICE_DESC&page=2"));
    expect(result).toMatchObject({ query: "Cien", category: "literatura", sort: "PRICE_DESC", page: 0, format: "" });
  });
});
describe("CatalogFilters", () => {
  it("offers only real format choices and applies a draft explicitly", async () => {
    const apply = show("?category=literatura&que=Libro&page=2");
    expect(screen.queryByRole("button", { name: "Idioma" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Precio (USD)" })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("radio", { name: "Tapa dura" }));
    expect(apply).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole("button", { name: "Aplicar filtros" }));
    expect(apply).toHaveBeenCalledWith(expect.objectContaining({ format: "HARDCOVER", category: "literatura", query: "Libro", page: 0 }));
  });
  it("validates typed monetary ranges without submitting invalid criteria", async () => {
    const apply = show("?minPrice=10&maxPrice=40", { ...options, minimumPrice: "1.00", maximumPrice: "90.00" });
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Precio (USD)" }));
    await user.clear(screen.getByLabelText("Precio mínimo"));
    await user.type(screen.getByLabelText("Precio mínimo"), "80");
    await user.click(screen.getByRole("button", { name: "Aplicar filtros" }));
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("El precio mínimo no puede ser mayor"));
    expect(apply).not.toHaveBeenCalled();
  });
  it("can clear a current filter even when metadata is no longer available", async () => {
    const apply = show("?format=HARDCOVER&category=literatura");
    await userEvent.click(screen.getByRole("button", { name: "Restablecer filtros" }));
    expect(apply).toHaveBeenCalledWith(expect.objectContaining({ format: "", category: "" }));
  });
});
