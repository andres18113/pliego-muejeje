import { useEffect, useRef } from "react";
import { queryOptions, useQueries, useQuery } from "@tanstack/react-query";
import { ApiRequestError } from "@/shared/api/errors";
import { getOrder, listOrders } from "@/shared/api/orders";
import { toMisPedidosOrder } from "./orderViewModel";

export const customerOrdersQueryKey = ["customer-orders"] as const;
export const customerOrderQueryKey = (orderId: string) => ["customer-order",orderId] as const;

export function customerOrderQueryOptions(orderId: string) {
  return queryOptions({
    queryKey: customerOrderQueryKey(orderId),
    queryFn: ({ signal }) => getOrder(orderId,signal),
    meta: { authRequired: true },
    staleTime: 0,
    refetchOnMount: "always",
    refetchOnWindowFocus: "always",
    retry: (count,error) => !(error instanceof ApiRequestError && error.status < 500) && count < 1,
  });
}

export function useCustomerOrder(orderId: string, enabled = true) {
  return useQuery({ ...customerOrderQueryOptions(orderId),enabled });
}

/** Read-through enrichment is bounded to the visible page and shares order-detail cache entries. */
export function useCustomerOrders(page: number, pageSize = 10) {
  const pageQuery = useQuery({
    queryKey: [...customerOrdersQueryKey,page,pageSize],
    queryFn: ({ signal }) => listOrders(page,pageSize,signal),
    meta: { authRequired: true },staleTime: 0,refetchOnMount: "always",retry: false,
  });
  const details = useQueries({ queries: (pageQuery.data?.items ?? []).map(order => ({
    ...customerOrderQueryOptions(order.orderId),retry: false,
  })) });
  const detailError = details.find(query => query.isError)?.error;
  const authenticationError = [pageQuery.error,...details.map(query => query.error)]
    .find(error => error instanceof ApiRequestError && error.status === 401);
  return {
    ...pageQuery,
    error: authenticationError ?? pageQuery.error ?? detailError ?? null,
    isError: pageQuery.isError || Boolean(detailError),
    isFetching: pageQuery.isFetching || details.some(query => query.isFetching),
    // Existing presentation can still read payment/invoice/window projections without bloating the view model.
    details: details.map(query => query.data),
    viewModels: (pageQuery.data?.items ?? []).map((summary,index) => {
      const query = details[index];
      const detail = query?.data;
      const model = toMisPedidosOrder(summary,detail);
      if (!detail || query.isFetching || query.isError || pageQuery.isError) {
        model.availableActions = { cancel: false, changeShippingAddress: false };
      }
      return model;
    }),
    refetch: async () => {
      const [result] = await Promise.all([pageQuery.refetch(),...details.map(query => query.refetch())]);
      return result;
    },
  };
}

/** A little after the reported deadline, so a client clock slightly ahead of the server's does not read too early. */
const DEADLINE_GRACE_MS = 1_000;
/** setTimeout's ceiling (~24.8 days); a later deadline is simply re-armed when the data next changes. */
const MAX_TIMER_MS = 2_147_483_647;

/**
 * Re-reads the server when a cancellation deadline it reported is reached (ADR 0029). The client clock only
 * schedules the read: whether an order can still be cancelled, and its lifecycle, are whatever the refetched
 * response says. Pass only the deadlines of orders the server currently marks cancelable. A deadline already in
 * the past triggers an immediate read; the same deadline is never re-armed, so a server that still reports the
 * window cannot cause a refetch loop (focus and reconnect refetches still apply as usual).
 */
export function useRefetchAtCancellationDeadline(deadlines: readonly (string | null | undefined)[], refetch: () => unknown) {
  const refetchRef = useRef(refetch);
  useEffect(() => { refetchRef.current = refetch; }, [refetch]);
  const key = deadlines.filter((deadline): deadline is string => Boolean(deadline)).sort().join("|");
  useEffect(() => {
    const times = key ? key.split("|").map((deadline) => Date.parse(deadline)).filter(Number.isFinite) : [];
    if (times.length === 0) return;
    const next = Math.min(...times);
    const now = Date.now();
    const delay = next > now ? Math.min(next - now + DEADLINE_GRACE_MS, MAX_TIMER_MS) : 0;
    const timer = window.setTimeout(() => { void refetchRef.current(); }, delay);
    return () => window.clearTimeout(timer);
  }, [key]);
}
