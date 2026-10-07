import { useQuery } from "@tanstack/react-query";
import { getAllPublicOffers, getOffersFilterOptions, type OffersCriteria } from "@/shared/api/catalog";
import { stockReadOptions } from "./stockStatusModel";

/** The complete set of active offers for the chosen type, theme and order (Ofertas has no pages). */
export function useOffers(criteria: OffersCriteria) {
  const { productType, category, sort } = criteria;
  return useQuery({
    queryKey: ["public-catalog", "offers", "all", { productType, category, sort }],
    ...stockReadOptions,
    queryFn: ({ signal }) => getAllPublicOffers(criteria, signal),
    staleTime: 0,
    refetchInterval: 30_000,
  });
}

export function useOffersFilterOptions() {
  return useQuery({ queryKey: ["public-catalog", "offers", "filter-options"], queryFn: ({ signal }) => getOffersFilterOptions(signal), staleTime: 0, refetchInterval: 30_000, refetchOnWindowFocus: true });
}
