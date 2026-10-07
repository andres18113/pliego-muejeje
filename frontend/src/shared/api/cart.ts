import { z } from "zod";
import { stockUnavailabilityReasons } from "./availability";
import { apiClient } from "./client";
import { toApiRequestError } from "./errors";
import { editionFormatSchema } from "./editionFormats";

const itemMutationSchema = z.object({
  cartItemId: z.string().min(1),
  quantity: z.number().int().positive(),
});

const activeCartSchema = z.object({
  items: z.array(z.object({
    editionId: z.string().min(1),
    quantity: z.number().int().positive(),
  })),
});

const moneySchema = z.string().regex(/^\d+\.\d{2}$/);
const calendarDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

const cartDetailSchema = z.object({
  cartId: z.string().min(1).nullable(),
  requiresPhysicalFulfillment: z.boolean(),
  physicalItemCount: z.number().int().nonnegative(),
  digitalItemCount: z.number().int().nonnegative(),
  state: z.string().nullable(),
  items: z.array(z.object({
    cartItemId: z.string().min(1),
    editionId: z.string().min(1),
    title: z.string(),
    authors: z.string().nullable().catch(""),
    sku: z.string().nullable().catch(""),
    coverUrl: z.string().nullable().catch(null),
    quantity: z.number().int().positive(),
    currentPrice: moneySchema,
    currentSubtotal: moneySchema,
    /** Authoritative offer projection; older responses may omit it, but present amounts must be valid. */
    originalPrice: moneySchema.optional(),
    unitSavings: moneySchema.optional(),
    originalSubtotal: moneySchema.optional(),
    lineSavings: moneySchema.optional(),
    available: z.boolean(),
    requiresPhysicalFulfillment: z.boolean(),
    quantityEditable: z.boolean(),
    format: editionFormatSchema.optional(),
    unavailabilityReason: z.enum(stockUnavailabilityReasons).nullable().catch(null),
  })),
  totalCurrent: moneySchema,
  /** Subtotal before offers, total savings and discounted subtotal, all supplied by the Database API. */
  originalSubtotal: moneySchema.optional(),
  savingsTotal: moneySchema.optional(),
  currentSubtotal: moneySchema.optional(),
  quoteFingerprint: z.string().regex(/^[0-9a-f]{64}$/).optional(),
  /**
   * Commercial breakdown computed by the Database API (V041): subtotal before tax, the IVA rate as a percentage
   * ("15.00" is 15 %), the IVA amount, delivery when it applies, and the total. The cart never derives these:
   * each row is shown only when the API sends it.
   */
  subtotal: moneySchema.nullish().catch(undefined),
  taxRate: z.string().regex(/^\d+(\.\d+)?$/).nullish().catch(undefined),
  taxAmount: moneySchema.nullish().catch(undefined),
  shippingAmount: moneySchema.nullish().catch(undefined),
  total: moneySchema.nullish().catch(undefined),
  /**
   * Home-delivery window computed by the Database API (V042) as calendar dates in Ecuador's time zone; absent
   * when the cart has nothing to ship. The client only formats it.
   */
  estimatedDeliveryFrom: calendarDateSchema.nullish().catch(undefined),
  estimatedDeliveryTo: calendarDateSchema.nullish().catch(undefined),
});

export type CartDetail = z.infer<typeof cartDetailSchema>;
export type CartLine = CartDetail["items"][number];

export async function addEditionToCart(editionId: string, quantity = 1) {
  const { data, error, response } = await apiClient.POST("/api/v1/cart/items", {
    body: { editionId, quantity },
  });

  if (error) {
    throw toApiRequestError(
      response.status,
      error,
      "No pudimos agregar esta edición al carrito",
      "Comprueba tu conexión e inténtalo otra vez.",
    );
  }

  const parsed = itemMutationSchema.safeParse(data);
  if (!parsed.success) throw invalidCartResponse();
  return parsed.data;
}

export async function getActiveCart() {
  const { data, error, response } = await apiClient.GET("/api/v1/cart");

  // The checked-in OpenAPI contract lists the successful Cart response only;
  // still surface runtime 401/403/5xx responses through the same Spanish error boundary.
  if (!response.ok) {
    throw toApiRequestError(
      response.status,
      error,
      "No pudimos consultar el carrito",
      "Vuelve a intentarlo antes de agregar esta edición otra vez.",
    );
  }

  const parsed = activeCartSchema.safeParse(data);
  if (!parsed.success) throw invalidCartResponse();
  return parsed.data;
}

export async function getCartDetail(signal?: AbortSignal): Promise<CartDetail> {
  const { data, error, response } = await apiClient.GET("/api/v1/cart", { signal });

  if (!response.ok) {
    throw toApiRequestError(
      response.status,
      error,
      "No pudimos consultar el carrito",
      "Comprueba tu conexión e inténtalo otra vez.",
    );
  }

  const parsed = cartDetailSchema.safeParse(data);
  if (!parsed.success) throw invalidCartResponse();
  return parsed.data;
}

/** PUT sets an absolute quantity, so the contract treats it as idempotent. */
export async function updateCartItemQuantity(cartItemId: string, quantity: number) {
  const { data, error, response } = await apiClient.PUT("/api/v1/cart/items/{cartItemId}", {
    params: { path: { cartItemId: cartItemId as unknown as number } },
    body: { quantity },
  });

  if (error || !response.ok) {
    throw toApiRequestError(
      response.status,
      error,
      "No pudimos cambiar la cantidad",
      "Comprueba tu conexión e inténtalo otra vez.",
    );
  }

  const parsed = itemMutationSchema.safeParse(data);
  if (!parsed.success) throw invalidCartResponse();
  return parsed.data;
}

export async function removeCartItem(cartItemId: string) {
  const { error, response } = await apiClient.DELETE("/api/v1/cart/items/{cartItemId}", {
    params: { path: { cartItemId: cartItemId as unknown as number } },
  });

  if (error || !response.ok) {
    throw toApiRequestError(
      response.status,
      error,
      "No pudimos quitar este artículo",
      "Comprueba tu conexión e inténtalo otra vez.",
    );
  }
}

function invalidCartResponse() {
  return toApiRequestError(
    502,
    {},
    "No pudimos confirmar el estado del carrito",
    "Vuelve a consultar el carrito antes de hacer otro cambio.",
  );
}
