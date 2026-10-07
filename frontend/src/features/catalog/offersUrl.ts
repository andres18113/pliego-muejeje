import type { OffersCriteria } from "@/shared/api/catalog";
import { readCatalogCriteria } from "./catalogUrl";

export function readOffersCriteria(search: string): OffersCriteria {
  const params = new URLSearchParams(search);
  const catalog = readCatalogCriteria(search);
  const sort = params.get("sort");
  const productType = params.get("productType");
  return {
    // Ofertas shows every offer at once: an old "?page=" in a shared link is ignored.
    page: 0, pageSize: 50, category: catalog.category,
    productType: productType === "PHYSICAL" || productType === "EBOOK" || productType === "AUDIOBOOK" ? productType : "",
    sort: sort === "ENDING_SOON" || sort === "PRICE_ASC" || sort === "PRICE_DESC" ? sort : "RELEVANCE",
  };
}

export function offersHref(criteria: OffersCriteria) {
  const params = new URLSearchParams();
  if (criteria.productType) params.set("productType", criteria.productType);
  if (criteria.category) params.set("category", criteria.category);
  if (criteria.sort !== "RELEVANCE") params.set("sort", criteria.sort);
  const query = params.toString();
  return query ? `/ofertas?${query}` : "/ofertas";
}
