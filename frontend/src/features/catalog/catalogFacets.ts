import type { PublicCatalogFilterOptions } from "@/shared/api/catalog";
import type { CatalogCriteria } from "./catalogUrl";

/** Sort orders the editions search accepts (`EditionSearch.sort`); the catalog never invents others. */
const sortChoices: { value: CatalogCriteria["sort"]; label: string; price?: true }[] = [
  { value: "BEST_SELLING", label: "Más vendidos" },
  { value: "TITLE_ASC", label: "Título: A–Z" },
  { value: "PRICE_ASC", label: "Precio: menor a mayor", price: true },
  { value: "PRICE_DESC", label: "Precio: mayor a menor", price: true },
];

export function catalogFacets(options: PublicCatalogFilterOptions | undefined, criteria: CatalogCriteria) {
  const variedPrices = Boolean(options?.minimumPrice && options.maximumPrice && options.minimumPrice !== options.maximumPrice);
  const formats = options?.formats ?? [];
  const priceSort = variedPrices || criteria.sort === "PRICE_ASC" || criteria.sort === "PRICE_DESC";
  return {
    /** Discovery owns which formats belong to the collection being browsed. */
    formats,
    format: formats.length > 1 || Boolean(criteria.format),
    language: (options?.languages.length ?? 0) > 1 || Boolean(criteria.language),
    /** Price is browsed through sorting; ordering by price only means something when prices differ. */
    sorts: sortChoices.filter((choice) => !choice.price || priceSort),
  };
}
export function auxiliaryFilterCount(criteria: CatalogCriteria) {
  return Number(Boolean(criteria.format)) + Number(Boolean(criteria.language)) + Number(Boolean(criteria.minPrice || criteria.maxPrice));
}
export function clearAuxiliaryFilters(criteria: CatalogCriteria): CatalogCriteria {
  return { ...criteria, format: "", language: "", minPrice: "", maxPrice: "", page: 0 };
}
