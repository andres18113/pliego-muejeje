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

function invalidCartResponse() {
  return toApiRequestError(
    502,
    {},
    "No pudimos confirmar el estado del carrito",
    "Consulta el carrito antes de volver a intentar agregar esta edición.",
  );
}
