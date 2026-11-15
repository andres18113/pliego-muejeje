import { queryOptions, useQuery } from "@tanstack/react-query";
import { getHelpArticle, getHelpCategories, searchHelpArticles, type HelpCriteria } from "@/shared/api/help";
import { ApiRequestError } from "@/shared/api/errors";
import { toReadViewState } from "@/shared/api/readViewState";

export const helpQueryKeys = { categories: ["help", "categories"] as const, articles: (criteria: HelpCriteria) => ["help", "articles", criteria] as const, article: (slug: string) => ["help", "article", slug] as const };
const retry = (count: number, error: unknown) => !(error instanceof ApiRequestError && error.status < 500) && count < 1;
/** Published Help changes rarely: a read is reused for a minute, so a first-load prefetch is not read twice. */
const staleTime = 60_000;
export const helpCategoriesQuery = () => queryOptions({ queryKey: helpQueryKeys.categories, queryFn: ({ signal }) => getHelpCategories(signal), retry, staleTime });
export const helpArticleQuery = (slug: string) => queryOptions({ queryKey: helpQueryKeys.article(slug), queryFn: ({ signal }) => getHelpArticle(slug, signal), retry, staleTime, enabled: Boolean(slug) });
export function useHelpCategories() {
  const query = useQuery(helpCategoriesQuery());
  return { ...query, viewState: toReadViewState(query, data => data.length === 0) };
}
export function useHelpArticles(criteria: HelpCriteria, enabled = true) {
  const query = useQuery({ queryKey: helpQueryKeys.articles(criteria), queryFn: ({ signal }) => searchHelpArticles(criteria, signal), retry, enabled });
  return { ...query, viewState: toReadViewState(query, data => data.items.length === 0) };
}
export function useHelpArticle(slug: string) {
  const query = useQuery(helpArticleQuery(slug));
  return { ...query, viewState: toReadViewState(query, () => false) };
}
