import type { OrderAvailableActions, OrderDetail, OrderSummary } from "@/shared/api/orders";
import type { CheckoutFulfillmentMethod } from "./fulfillment";
import { currentOrderState, type CurrentOrderState } from "./orderState";
import { toOrderPricingViewModel, type OrderPricingViewModel } from "./orderPricingViewModel";

/** Data contract for Mis pedidos; presentation chooses grouping, layout, icons and styling. */
export interface MisPedidosOrder {
  orderId: string;
  date: string | null;
  state: CurrentOrderState;
  items: { orderItemId: string; title: string; format: string | null; quantity: number }[];
  units: number | null;
  pricing: { subtotal: string | null; tax: string | null; shipping: string | null; total: string };
  historicalPricing?: OrderPricingViewModel;
  fulfillmentType: CheckoutFulfillmentMethod | null;
  availableActions: OrderAvailableActions;
  canCancel: boolean;
  cancellationDeadline: string | null;
  lifecycleState: string | null;
  libraryAccessState: string | null;
}

export function toMisPedidosOrder(summary: OrderSummary, detail?: OrderDetail): MisPedidosOrder {
  const method = detail ? detail.fulfillment?.method ?? null : summary.fulfillmentMethod;
  const historicalSource = detail && hasHistoricalPricingData(detail) ? detail : summary;
  return {
    orderId: summary.orderId,
    date: detail?.createdAt ?? summary.createdAt ?? null,
    state: currentOrderState({
      orderState: detail?.orderState ?? summary.orderState,
      purchaseState: detail ? detail.purchaseState : summary.purchaseState,
      paymentState: detail ? detail.payment?.state : summary.paymentState,
      shipmentState: detail ? detail.shipment?.state ?? null : summary.shipmentState,
      fulfillmentMethod: method,
      pickupState: detail?.fulfillment?.state,
    }),
    items: (detail?.items ?? summary.itemSummary).map(({ orderItemId, title, format, quantity }) => ({ orderItemId, title, format, quantity })),
    // List summaries are truncated; only full detail quantities can replace server unitCount.
    units: detail ? detail.items.reduce((sum,item) => sum + item.quantity,0) : summary.unitCount,
    pricing: { subtotal: detail?.subtotal ?? summary.subtotal ?? null, tax: detail?.taxAmount ?? summary.taxAmount ?? null,
      shipping: detail?.shippingAmount ?? summary.shippingAmount ?? null, total: detail?.total ?? summary.total },
    ...(hasHistoricalPricingData(historicalSource) ? { historicalPricing: toOrderPricingViewModel(historicalSource) } : {}),
    fulfillmentType: method === "HOME_DELIVERY" || method === "STORE_PICKUP" || method === "DIGITAL_ONLY" ? method : null,
    availableActions: { ...(detail?.availableActions ?? summary.availableActions ?? { cancel: false, changeShippingAddress: false }) },
    canCancel: detail?.availableActions.canCancel ?? detail?.availableActions.cancel ?? false,
    cancellationDeadline: detail?.availableActions.cancellationDeadline ?? null,
    lifecycleState: detail?.availableActions.lifecycleState ?? null,
    libraryAccessState: detail?.availableActions.libraryAccessState ?? null,
  };
}

function hasHistoricalPricingData(order: OrderSummary | OrderDetail) {
  return order.pricingSnapshotAvailable !== undefined || order.originalSubtotal !== undefined
    || order.savingsTotal !== undefined || order.currentSubtotal !== undefined;
}
