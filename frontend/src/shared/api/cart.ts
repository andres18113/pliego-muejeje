import { z } from "zod";
import { apiClient } from "./client";
import { toApiRequestError } from "./errors";

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

const cartDetailSchema = z.object({
  cartId: z.string().min(1).nullable(),
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
    available: z.boolean(),
    unavailabilityReason: z.enum(["P2043", "P2042", "P3002"]).nullable().catch(null),
  })),
  totalCurrent: moneySchema,
});

export type CartDetail = z.infer<typeof cartDetailSchema>;
export type CartLine = CartDetail["items"][number];

export async function addEditionToCart(editionId: string) {
  const { data, error, response } = await apiClient.POST("/api/v1/cart/items", {
    body: { editionId, quantity: 1 },
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
