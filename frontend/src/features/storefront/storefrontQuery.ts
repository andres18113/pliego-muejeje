import { useQuery } from "@tanstack/react-query";
import { getStorefrontNavigation } from "@/shared/api/storefront";
import { toReadViewState } from "@/shared/api/readViewState";

export const storefrontNavigationQueryKey = ["storefront-navigation"] as const;
export function useStorefrontNavigation() {
  const query = useQuery({ queryKey: storefrontNavigationQueryKey, queryFn: ({ signal }) => getStorefrontNavigation(signal), staleTime: 30_000, retry: 1 });
  return { ...query, viewState: toReadViewState(query, data => data.sections.length === 0) };
}
