/**
 * Presentation-only: chooses which server-reported state leads an order's story. It reads the
 * independent projections the API already computed (purchaseState, payment state, shipment state
 * and pickup state) and never decides what is allowed — available actions come only
 * from the server's `availableActions`.
 */
export type OrderStoryKind = "awaiting-payment" | "payment-rejected" | "cancelled" | "preparing" | "in-transit" | "delivered" | "confirmed";
/** The scene each story is told on: in progress (ultramar), arrived (yellow), needs the customer (lavender), closed (paper). */
export type OrderStoryTone = "progress" | "arrived" | "attention" | "closed";

import { currentOrderState, type CurrentOrderState, type OrderStateInput } from "./orderState";
export type OrderStoryInput = OrderStateInput;

export interface OrderStory {
  kind: OrderStoryKind;
  tone: OrderStoryTone;
  headline: string;
}

export function orderStory(input: OrderStoryInput): OrderStory {
  return storyFromState(currentOrderState(input),input.paymentState);
}

/** Compatibility adapter for the current presentation; the view model contains no visual choices. */
export function storyFromState(state: CurrentOrderState, paymentState?: string | null): OrderStory {
  const headline = state.label;
  if (state.code === "CANCELLED") return paymentState === "REJECTED"
    ? { kind: "payment-rejected",tone: "attention",headline }
    : { kind: "cancelled",tone: "closed",headline };
  if (state.code === "PENDING_PAYMENT") return { kind: "awaiting-payment",tone: "attention",headline };
  if (state.code === "DELIVERED" || state.code === "COLLECTED") return { kind: "delivered",tone: "arrived",headline };
  if (state.code === "IN_TRANSIT" || state.code === "SHIPPED" || state.code === "OUT_FOR_DELIVERY") return { kind: "in-transit",tone: "progress",headline };
  if (state.source === "SHIPMENT" && (state.code === "PREPARING" || state.code === "PENDING")) return { kind: "preparing",tone: "progress",headline };
  return { kind: "confirmed",tone: "progress",headline };
}

/** Physical shipment lifecycle in the order the API documents (amendment v1.0.8). */
export const shipmentSteps = [
  { state: "PENDING", label: "Confirmado", at: "createdAt" },
  { state: "PREPARING", label: "En preparación", at: "preparingAt" },
  { state: "IN_TRANSIT", label: "En camino", at: "shippedAt" },
  { state: "OUT_FOR_DELIVERY", label: "En reparto", at: "outForDeliveryAt" },
  { state: "DELIVERED", label: "Entregado", at: "deliveredAt" },
] as const;

/**
 * Presentation of the server's six-minute purchase window (ADR 0029) for digital and pickup orders. It reads only the
 * authoritative `availableActions.lifecycleState`; whether cancelling is allowed stays `availableActions.canCancel`.
 * - "digital-window": a digital purchase still inside its window.
 * - "digital-complete": a digital purchase the server finalized.
 * - "pickup-window": a pickup order still inside its window (the pickup flow continues afterwards as before).
 */
export type PurchaseWindowView = "digital-window" | "digital-complete" | "pickup-window" | null;

export function purchaseWindowView(lifecycleState: string | null | undefined, kind: { digitalOnly: boolean; pickup: boolean }): PurchaseWindowView {
  if (lifecycleState === "CANCELLATION_WINDOW") return kind.digitalOnly ? "digital-window" : kind.pickup ? "pickup-window" : null;
  if (lifecycleState === "COMPLETED" && kind.digitalOnly) return "digital-complete";
  return null;
}
