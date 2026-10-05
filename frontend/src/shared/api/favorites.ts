import { z } from "zod";
import { apiClient } from "./client";
import { parseTotalCount } from "./catalog";
import { toApiRequestError } from "./errors";
import { editionFormatSchema } from "./editionFormats";

const favoriteEditionSchema = z.object({
  editionId: z.string().regex(/^[1-9][0-9]*$/),
  bookId: z.string().regex(/^[1-9][0-9]*$/),
  title: z.string(),
  authors: z.string(),
  publisher: z.string(),
  price: z.string().regex(/^\d+\.\d{2}$/),
  coverUrl: z.string().nullable(),
  coverLicense: z.string().nullable(),
  coverAttribution: z.string().nullable(),
  format: editionFormatSchema,
  language: z.string(),
  available: z.boolean(),
  favoritedAt: z.string(),
});

const favoriteStatusSchema = z.object({
  editionId: z.string().regex(/^[1-9][0-9]*$/),
  favorite: z.boolean(),
});

const favoritePageSchema = z.object({
  items: z.array(favoriteEditionSchema),
  page: z.number().int().nonnegative(),
  pageSize: z.number().int().positive(),
  totalCount: z.string(),
});

export type FavoriteEdition = z.infer<typeof favoriteEditionSchema>;
export type FavoriteStatus = z.infer<typeof favoriteStatusSchema>;
export type FavoritePage = z.infer<typeof favoritePageSchema> & { totalCountValue: bigint };

export const favoriteListQueryKey = (userId: string, page: number, pageSize: number) =>
  ["customer-favorites", userId, page, pageSize] as const;

export const favoriteStatusQueryKey = (userId: string, editionIds: string[]) =>
  ["customer-favorite-status", userId, [...editionIds].sort().join(",")] as const;

export async function listCustomerFavorites(page: number, pageSize = 20, signal?: AbortSignal): Promise<FavoritePage> {
  const { data, error, response } = await apiClient.GET("/api/v1/me/favorites", {
    params: { query: { page, pageSize } },
    signal,
  });
  if (error) {
    throw toApiRequestError(response.status, error, "No pudimos consultar tus favoritos", "Comprueba tu conexión e inténtalo otra vez.");
  }

  const parsed = favoritePageSchema.safeParse(data);
  const totalCountValue = parsed.success ? parseTotalCount(parsed.data.totalCount) : null;
  if (!parsed.success || totalCountValue === null) throw invalidFavoriteResponse();
  return { ...parsed.data, totalCountValue };
}

export async function getCustomerFavoriteStatus(editionIds: string[], signal?: AbortSignal): Promise<FavoriteStatus[]> {
  const { data, error, response } = await apiClient.GET("/api/v1/me/favorites/status", {
    params: { query: { editionIds: editionIds.map((id) => id as unknown as number) } },
    signal,
  });
  if (error) {
    throw toApiRequestError(response.status, error, "No pudimos consultar tus favoritos", "Comprueba tu conexión e inténtalo otra vez.");
  }

  const parsed = z.array(favoriteStatusSchema).safeParse(data);
  if (!parsed.success || (parsed.data.length !== new Set(editionIds).size || new Set(parsed.data.map(status => status.editionId)).size !== parsed.data.length || parsed.data.some(status => !editionIds.includes(status.editionId)))) throw invalidFavoriteResponse();
  return parsed.data;
}

export async function addCustomerFavorite(editionId: string): Promise<void> {
  const { error, response } = await apiClient.PUT("/api/v1/me/favorites/{editionId}", {
    params: { path: { editionId: editionId as unknown as number } },
  });
  if (error || !response.ok) {
    throw toApiRequestError(response.status, error, "No pudimos agregar este libro a tus favoritos", "Comprueba tu conexión e inténtalo otra vez.");
  }
}

export async function removeCustomerFavorite(editionId: string): Promise<void> {
  const { error, response } = await apiClient.DELETE("/api/v1/me/favorites/{editionId}", {
    params: { path: { editionId: editionId as unknown as number } },
  });
  if (error || !response.ok) {
    throw toApiRequestError(response.status, error, "No pudimos quitar este libro de tus favoritos", "Comprueba tu conexión e inténtalo otra vez.");
  }
}

function invalidFavoriteResponse() {
  return toApiRequestError(502, {}, "No pudimos actualizar tus favoritos", "Recibimos una respuesta incompleta. Vuelve a intentarlo.");
}
