/** Checkout methods accepted by API amendment v1.0.13. Eligibility stays with the backend. */
export const checkoutFulfillmentMethods = ["HOME_DELIVERY", "STORE_PICKUP", "DIGITAL_ONLY"] as const;
export type CheckoutFulfillmentMethod = (typeof checkoutFulfillmentMethods)[number];

/** Names the method an order reports; unknown values are not guessed. */
export function fulfillmentMethodLabel(method: string | null | undefined) {
  return method === "HOME_DELIVERY" ? "Entrega a domicilio" : method === "STORE_PICKUP" ? "Retiro en tienda" : null;
}
