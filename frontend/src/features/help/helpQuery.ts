import { useQuery } from "@tanstack/react-query";
import { getHelpArticle, getHelpCategories, searchHelpArticles, type HelpCriteria } from "@/shared/api/help";
import { ApiRequestError } from "@/shared/api/errors";
import { toReadViewState } from "@/shared/api/readViewState";

export const helpQueryKeys = { categories: ["help", "categories"] as const, articles: (criteria: HelpCriteria) => ["help", "articles", criteria] as const, article: (slug: string) => ["help", "article", slug] as const };
const retry = (count: number, error: unknown) => !(error instanceof ApiRequestError && error.status < 500) && count < 1;
export function useHelpCategories() {
  const query = useQuery({ queryKey: helpQueryKeys.categories, queryFn: ({ signal }) => getHelpCategories(signal), retry });
  return { ...query, viewState: toReadViewState(query, data => data.length === 0) };
}
export function useHelpArticles(criteria: HelpCriteria) {
  const query = useQuery({ queryKey: helpQueryKeys.articles(criteria), queryFn: ({ signal }) => searchHelpArticles(criteria, signal), retry });
  return { ...query, viewState: toReadViewState(query, data => data.items.length === 0) };
}
export function useHelpArticle(slug: string) {
  const query = useQuery({ queryKey: helpQueryKeys.article(slug), queryFn: ({ signal }) => getHelpArticle(slug, signal), retry, enabled: Boolean(slug) });
  return { ...query, viewState: toReadViewState(query, () => false) };
}
