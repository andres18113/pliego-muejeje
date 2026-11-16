import { useQuery, type QueryClient } from "@tanstack/react-query";
import { getStorefrontNavigation } from "@/shared/api/storefront";
import { toReadViewState } from "@/shared/api/readViewState";

export const storefrontNavigationQueryKey = ["storefront-navigation"] as const;
const storefrontNavigationQuery = { queryKey: storefrontNavigationQueryKey, queryFn: ({ signal }: { signal: AbortSignal }) => getStorefrontNavigation(signal), staleTime: 30_000, retry: 1 } as const;

/**
 * The projection is public and the same for every visitor, so it can be read while the session is still being
 * restored: the header and the Home hero then render with it instead of waiting one more round trip.
 */
export function prefetchStorefrontNavigation(queryClient: QueryClient) {
  return queryClient.prefetchQuery(storefrontNavigationQuery);
}

export function useStorefrontNavigation() {
  const query = useQuery(storefrontNavigationQuery);
  return { ...query, viewState: toReadViewState(query, data => data.sections.length === 0) };
}
