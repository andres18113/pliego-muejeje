import { formatUsd } from "@/features/catalog/formatters";
import type { CheckoutResult, OrderDetail, OrderSummary } from "@/shared/api/orders";
import { ivaLabel } from "./purchaseText";

export interface OrderPricingAmount {
  label: string;
  rawValue: string;
  formattedValue: string;
}

export interface OrderLinePricingViewModel {
  orderItemId: string;
  pricingSnapshotAvailable: boolean;
  unitPrice: OrderPricingAmount;
  subtotal: OrderPricingAmount;
  originalPrice: OrderPricingAmount | null;
  unitSavings: OrderPricingAmount | null;
  originalSubtotal: OrderPricingAmount | null;
  lineSavings: OrderPricingAmount | null;
}

export interface OrderPricingViewModel {
  orderId: string;
  pricingSnapshotAvailable: boolean;
  /** Only full order detail supplies historical line prices; list item summaries are deliberately unpriced. */
  lines: OrderLinePricingViewModel[];
  summary: {
    pricingSnapshotAvailable: boolean;
    originalSubtotal: OrderPricingAmount | null;
    savingsTotal: OrderPricingAmount | null;
    currentSubtotal: OrderPricingAmount | null;
    tax: OrderPricingAmount | null;
    shipping: OrderPricingAmount | null;
    total: OrderPricingAmount;
  };
}

/** Maps immutable order/confirmation amounts, independent of today's catalog prices or active offers. */
export function toOrderPricingViewModel(order: OrderDetail | OrderSummary | CheckoutResult): OrderPricingViewModel {
  const lines = "items" in order ? order.items.map(toLinePricing) : [];
  const known = order.pricingSnapshotAvailable === true && order.originalSubtotal != null
    && order.savingsTotal != null && order.currentSubtotal != null;
  return {
    orderId: order.orderId,
    pricingSnapshotAvailable: known && lines.every(line => line.pricingSnapshotAvailable),
    lines,
    summary: {
      pricingSnapshotAvailable: known,
      originalSubtotal: known ? optionalAmount("Subtotal", order.originalSubtotal) : null,
      savingsTotal: known ? optionalAmount("Ahorro total", order.savingsTotal) : null,
      currentSubtotal: optionalAmount(known ? "Subtotal con descuentos" : "Subtotal pagado", order.currentSubtotal ?? order.subtotal),
      tax: optionalAmount(ivaLabel("taxRate" in order ? order.taxRate : undefined), order.taxAmount),
      shipping: optionalAmount("Envío", order.shippingAmount),
      total: amount("Total pagado", order.total),
    },
  };
}

function toLinePricing(line: OrderDetail["items"][number]): OrderLinePricingViewModel {
  const known = line.pricingSnapshotAvailable === true && line.originalPrice != null && line.unitSavings != null
    && line.originalSubtotal != null && line.lineSavings != null;
  return {
    orderItemId: line.orderItemId,
    pricingSnapshotAvailable: known,
    unitPrice: amount("Precio pagado por unidad", line.unitPrice),
    subtotal: amount("Subtotal pagado", line.subtotal),
    originalPrice: known ? optionalAmount("Precio original", line.originalPrice) : null,
    unitSavings: known ? optionalAmount("Ahorro por unidad", line.unitSavings) : null,
    originalSubtotal: known ? optionalAmount("Subtotal original", line.originalSubtotal) : null,
    lineSavings: known ? optionalAmount("Ahorro", line.lineSavings) : null,
  };
}

function amount(label: string, rawValue: string): OrderPricingAmount {
  return { label, rawValue, formattedValue: formatUsd(rawValue) };
}

function optionalAmount(label: string, rawValue: string | null | undefined): OrderPricingAmount | null {
  return rawValue == null ? null : amount(label, rawValue);
}
