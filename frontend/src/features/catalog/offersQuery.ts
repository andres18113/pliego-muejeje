import { useQuery } from "@tanstack/react-query";
import { getOffersFilterOptions, getPublicOffers, type OffersCriteria } from "@/shared/api/catalog";
import { stockReadOptions } from "./stockStatusModel";

export function useOffers(criteria: OffersCriteria) {
  return useQuery({
    queryKey: ["public-catalog", "offers", criteria],
    ...stockReadOptions,
    queryFn: ({ signal }) => getPublicOffers(criteria.page, criteria.pageSize, signal, criteria),
    staleTime: 0,
    refetchInterval: 30_000,
  });
}

export function useOffersFilterOptions() {
  return useQuery({ queryKey: ["public-catalog", "offers", "filter-options"], queryFn: ({ signal }) => getOffersFilterOptions(signal), staleTime: 0, refetchInterval: 30_000, refetchOnWindowFocus: true });
}
