import { useQuery } from "@tanstack/react-query";
import { useSession } from "@/app/session";
import { getOwnedItem, listOwnedItems, type LibraryCriteria } from "@/shared/api/library";
import { ApiRequestError } from "@/shared/api/errors";
import { toReadViewState } from "@/shared/api/readViewState";
import { toOwnedItemViewModel } from "./libraryViewModel";

/** Actor identity plus session cache eviction prevents cross-account reuse. */
export const libraryQueryKeys = { all: ["customer-library"] as const, list: (actor: string, criteria: LibraryCriteria) => ["customer-library", actor, "list", criteria] as const, detail: (actor: string, ownedItemId: string) => ["customer-library", actor, "detail", ownedItemId] as const };
const readOptions = { meta: { authRequired: true }, staleTime: 0, refetchOnMount: "always" as const, refetchOnWindowFocus: "always" as const, retry: (count: number, error: unknown) => !(error instanceof ApiRequestError && error.status < 500) && count < 1 };
export function useOwnedItems(criteria: LibraryCriteria) {
  const { session } = useSession();
  const query = useQuery({ ...readOptions, queryKey: libraryQueryKeys.list(session?.user.userId ?? "", criteria), queryFn: ({ signal }) => listOwnedItems(criteria, signal), enabled: session?.user.role === "CUSTOMER", select: page => ({ ...page, items: page.items.map(toOwnedItemViewModel) }) });
  return { ...query, viewState: toReadViewState(query, data => data.items.length === 0) };
}
export function useOwnedItem(ownedItemId: string) {
  const { session } = useSession();
  const query = useQuery({ ...readOptions, queryKey: libraryQueryKeys.detail(session?.user.userId ?? "", ownedItemId), queryFn: ({ signal }) => getOwnedItem(ownedItemId, signal), enabled: session?.user.role === "CUSTOMER" && Boolean(ownedItemId), select: toOwnedItemViewModel });
  return { ...query, viewState: toReadViewState(query, () => false) };
}
