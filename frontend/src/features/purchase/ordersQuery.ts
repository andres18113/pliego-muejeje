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
