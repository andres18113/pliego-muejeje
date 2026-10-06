import { stockReadOptions } from "@/features/catalog/stockStatusModel";
import { useQuery } from "@tanstack/react-query";
import { getCartDetail } from "@/shared/api/cart";
import { ApiRequestError } from "@/shared/api/errors";
import type { CartLine } from "@/shared/api/cart";
import { resolveStockStatus } from "@/features/catalog/stockStatusModel";

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

/** The compact selector offers 1–10; the server still decides whether the stock covers the choice. */
const QUANTITY_CHOICES = 10;

/** Quantities a line may offer: digital lines stay at one; when the server reports the quantity cannot grow, the list stops at the current one. */
export function cartQuantityChoices(line: CartLine) {
  const stock = resolveStockStatus(line);
  const highest = !line.requiresPhysicalFulfillment ? 1 : stock.canIncreaseQuantity ? QUANTITY_CHOICES : Math.min(line.quantity, QUANTITY_CHOICES);
  const choices = Array.from({ length: highest }, (_, index) => index + 1);
  if (!choices.includes(line.quantity)) choices.push(line.quantity);
  return choices;
}
