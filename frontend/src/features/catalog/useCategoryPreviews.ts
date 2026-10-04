import { useQueries } from "@tanstack/react-query";
import type { PublicCategory } from "@/shared/api/catalog";
import { searchPublicEditions } from "@/shared/api/catalog";
import { readCatalogCriteria } from "./catalogUrl";

/** Product imagery always comes from the public catalog, including navigation. */
export function useCategoryPreviews(categories: PublicCategory[], enabled = true) {
  return useQueries({ queries: categories.map((category) => ({
    queryKey: ["public-catalog", "category-preview", category.slug],
    queryFn: ({ signal }: { signal: AbortSignal }) => searchPublicEditions({ ...readCatalogCriteria(""), category: category.slug, pageSize: 4 }, signal),
    enabled,
    staleTime: 60_000,
  })) });
}
