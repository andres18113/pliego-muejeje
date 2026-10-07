import { formatUsd } from "@/features/catalog/formatters";
import type { CartDetail, CartLine } from "@/shared/api/cart";
import { ivaLabel } from "./purchaseText";

export interface CartPricingAmount {
  label: string;
  rawValue: string;
  formattedValue: string;
}

export interface CartLinePricingViewModel {
  cartItemId: string;
  /** Reports field availability, including an explicit zero saving; it does not decide offer eligibility. */
  hasOfferProjection: boolean;
  currentPrice: CartPricingAmount;
  currentSubtotal: CartPricingAmount;
  originalPrice: CartPricingAmount | null;
  unitSavings: CartPricingAmount | null;
  originalSubtotal: CartPricingAmount | null;
  lineSavings: CartPricingAmount | null;
}

export interface CartPricingViewModel {
  hasOfferProjection: boolean;
  lines: CartLinePricingViewModel[];
  summary: {
    hasOfferProjection: boolean;
    originalSubtotal: CartPricingAmount | null;
    savingsTotal: CartPricingAmount | null;
    currentSubtotal: CartPricingAmount | null;
    tax: CartPricingAmount | null;
    shipping: CartPricingAmount | null;
    total: CartPricingAmount;
  };
}

/**
 * Maps the server's pricing into presentation values. Never sums quantities, infers discounts or applies tax.
 * Legacy responses keep their current prices and optional breakdown; unavailable offer amounts remain absent.
 */
export function toCartPricingViewModel(cart: CartDetail): CartPricingViewModel {
  const lines = cart.items.map(toLinePricing);
  const hasSummaryProjection = cart.originalSubtotal !== undefined
    && cart.savingsTotal !== undefined && cart.currentSubtotal !== undefined;
  return {
    hasOfferProjection: hasSummaryProjection && lines.every(line => line.hasOfferProjection),
    lines,
    summary: {
      hasOfferProjection: hasSummaryProjection,
      originalSubtotal: optionalAmount("Subtotal", cart.originalSubtotal),
      savingsTotal: optionalAmount("Ahorro total hoy", cart.savingsTotal),
      currentSubtotal: optionalAmount(cart.currentSubtotal === undefined ? "Subtotal" : "Subtotal con descuentos", cart.currentSubtotal ?? cart.subtotal),
      tax: optionalAmount(ivaLabel(cart.taxRate), cart.taxAmount),
      shipping: optionalAmount("Envío", cart.shippingAmount),
      total: amount("Total", cart.total ?? cart.totalCurrent),
    },
  };
}

function toLinePricing(line: CartLine): CartLinePricingViewModel {
  return {
    cartItemId: line.cartItemId,
    hasOfferProjection: line.originalPrice !== undefined && line.unitSavings !== undefined
      && line.originalSubtotal !== undefined && line.lineSavings !== undefined,
    currentPrice: amount("Precio unitario", line.currentPrice),
    currentSubtotal: amount("Subtotal", line.currentSubtotal),
    originalPrice: optionalAmount("Precio original", line.originalPrice),
    unitSavings: optionalAmount("Ahorro por unidad", line.unitSavings),
    originalSubtotal: optionalAmount("Subtotal original", line.originalSubtotal),
    lineSavings: optionalAmount("Ahorro", line.lineSavings),
  };
}

/** Whether a server-supplied saving is worth showing (a positive amount); it never computes one. */
export function hasSaving(rawValue: string | null | undefined) {
  return rawValue != null && Number(rawValue) > 0;
}

function amount(label: string, rawValue: string): CartPricingAmount {
  return { label, rawValue, formattedValue: formatUsd(rawValue) };
}

function optionalAmount(label: string, rawValue: string | null | undefined): CartPricingAmount | null {
  return rawValue == null ? null : amount(label, rawValue);
}
