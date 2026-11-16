import { queryOptions } from "@tanstack/react-query";
import { getPublicCategories, getPublicCatalogFilterOptions, getPublicEdition, searchPublicEditions, type CatalogScope } from "@/shared/api/catalog";
import { ApiRequestError } from "@/shared/api/errors";
import type { CatalogCriteria } from "./catalogUrl";
import { stockReadOptions } from "./stockStatusModel";

/**
 * The public catalog reads, defined once so the pages and the first-load prefetch (app/initialPublicReads) share the
 * same keys and options. They are the same for every visitor: the catalog API never reads the session.
 */
export const publicCategoriesQuery = (scope: CatalogScope) => queryOptions({
  queryKey: ["public-catalog", "categories", scope],
  queryFn: ({ signal }) => getPublicCategories(signal, scope),
  staleTime: 60_000,
});

export const publicFilterOptionsQuery = (scope: CatalogScope) => queryOptions({
  queryKey: ["public-catalog", "filter-options", scope],
  queryFn: ({ signal }) => getPublicCatalogFilterOptions(signal, scope),
  staleTime: 60_000,
});

export const publicEditionsQuery = (criteria: CatalogCriteria) => queryOptions({
  queryKey: ["public-catalog", "editions", criteria],
  ...stockReadOptions,
  queryFn: ({ signal }) => searchPublicEditions(criteria, signal),
  staleTime: 20_000,
});

export const publicEditionQuery = (editionId: string) => queryOptions({
  queryKey: ["public-catalog", "edition", editionId],
  ...stockReadOptions,
  queryFn: ({ signal }) => getPublicEdition(editionId, signal),
  staleTime: 30_000,
  retry: (failureCount, error) => !(error instanceof ApiRequestError && error.status === 404) && failureCount < 1,
});

/** A positive PostgreSQL bigint, as the edition route accepts. */
export function isEditionId(value: string) {
  if (!/^[1-9][0-9]{0,18}$/.test(value)) return false;
  try {
    return BigInt(value) <= 9_223_372_036_854_775_807n;
  } catch {
    return false;
  }
}
