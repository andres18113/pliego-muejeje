import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useSession } from "@/app/session";
import { getDigitalEligibility } from "@/shared/api/digitalEligibility";
import type { CartLine } from "@/shared/api/cart";

/** Eligibility depends on cart state: every existing customer-cart invalidation refreshes both reads. */
export function useDigitalEligibility(editionIds: string[]) {
  const { session } = useSession();
  const actor = session?.user.role === "CUSTOMER" ? session.user.userId : null;
  const idsKey = [...new Set(editionIds)].sort().join(",");
  const ids = useMemo(() => idsKey ? idsKey.split(",") : [], [idsKey]);
  const query = useQuery({
    queryKey: ["customer-cart", "digital-eligibility", actor, idsKey],
    queryFn: async ({ signal }) => {
      const batches = Array.from({ length: Math.ceil(ids.length / 50) }, (_, index) => ids.slice(index * 50, (index + 1) * 50));
      return (await Promise.all(batches.map(batch => getDigitalEligibility(batch, signal)))).flat();
    },
    enabled: Boolean(actor && ids.length),
    meta: { authRequired: true },
    staleTime: 0,
    refetchOnMount: "always",
    refetchOnWindowFocus: true,
    retry: false,
  });
  const byEdition = useMemo(() => new Map((query.data ?? []).map(item => [item.editionId, item])), [query.data]);
  return { ...query, byEdition };
}

export function useBlockedDigitalEligibility(lines: CartLine[] = []) {
  return useDigitalEligibility(lines.filter(line => !line.available && (line.unavailabilityReason === "P6002" || line.unavailabilityReason === "P6003")).map(line => line.editionId));
}
