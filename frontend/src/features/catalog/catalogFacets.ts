import type { PublicCatalogFilterOptions } from "@/shared/api/catalog";
import type { CatalogCriteria } from "./catalogUrl";
export function catalogFacets(options: PublicCatalogFilterOptions | undefined, criteria: CatalogCriteria) {
  const variedPrices = Boolean(options?.minimumPrice && options.maximumPrice && options.minimumPrice !== options.maximumPrice);
  return {
    format: (options?.formats.length ?? 0) > 1 || Boolean(criteria.format),
    language: (options?.languages.length ?? 0) > 1 || Boolean(criteria.language),
    price: variedPrices || Boolean(criteria.minPrice || criteria.maxPrice),
    priceSort: variedPrices || criteria.sort !== "TITLE_ASC",
  };
}
export function auxiliaryFilterCount(criteria: CatalogCriteria) {
  return Number(Boolean(criteria.format)) + Number(Boolean(criteria.language)) + Number(Boolean(criteria.minPrice || criteria.maxPrice));
}
export function clearAuxiliaryFilters(criteria: CatalogCriteria): CatalogCriteria {
  return { ...criteria, format: "", language: "", minPrice: "", maxPrice: "", page: 0 };
}
