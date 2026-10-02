import { useEffect, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { ApiRequestError } from "@/shared/api/errors";
import { getCustomerFavoriteStatus, favoriteStatusQueryKey } from "@/shared/api/favorites";

export function useFavoriteStatuses(editionIds: string[], userId: string | null) {
  const idsKey = [...new Set(editionIds)].sort().join(",");
  const stableIds = useMemo(() => idsKey ? idsKey.split(",") : [], [idsKey]);
  const query = useQuery({
    queryKey: favoriteStatusQueryKey(userId ?? "guest", stableIds),
    queryFn: ({ signal }) => getCustomerFavoriteStatus(stableIds, signal),
    enabled: Boolean(userId && stableIds.length),
    meta: { authRequired: true },
    staleTime: 15_000,
    refetchOnMount: "always",
    retry: false,
  });
  const statusByEdition = useMemo(
    () => new Map((query.data ?? []).map((item) => [item.editionId, item.favorite])),
    [query.data],
  );

  return { ...query, statusByEdition, stableIds };
}

export function useFavoriteSessionFailure(error: unknown, clearSession: (reason?: "expired") => void) {
  useEffect(() => {
    if (error instanceof ApiRequestError && error.status === 401) clearSession("expired");
  }, [clearSession, error]);
}
