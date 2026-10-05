import { stockReadOptions } from "@/features/catalog/stockStatusModel";
import { useQuery } from "@tanstack/react-query";
import { getCartDetail } from "@/shared/api/cart";
import { ApiRequestError } from "@/shared/api/errors";

export const cartQueryKey = ["customer-cart"] as const;

/**
 * Purchase surfaces re-read the server cart whenever they open; the header badge only needs
 * a recent count and is refreshed by cart invalidations after mutations.
 */
export function useCustomerCart(enabled: boolean, { fresh = true }: { fresh?: boolean } = {}) {
  return useQuery({
    queryKey: cartQueryKey,
    ...stockReadOptions,
    queryFn: ({ signal }) => getCartDetail(signal),
    enabled,
    meta: { authRequired: true },
    staleTime: fresh ? 0 : 30_000,
    refetchOnMount: fresh ? "always" : true,
    retry: (failureCount, error) => !(error instanceof ApiRequestError && error.status < 500) && failureCount < 1,
  });
}

export function cartUnitCount(items: { quantity: number }[]) {
  return items.reduce((total, item) => total + item.quantity, 0);
}
