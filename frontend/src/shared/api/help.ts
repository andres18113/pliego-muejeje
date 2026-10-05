import { z } from "zod";
import { apiClient } from "./client";
import { ApiRequestError, toApiRequestError } from "./errors";

const applicabilitySchema = z.enum(["GENERAL", "PHYSICAL", "EBOOK", "AUDIOBOOK"]);
const categorySchema = z.object({ slug: z.string(), title: z.string(), position: z.number().int(), applicability: applicabilitySchema });
const articleSchema = z.object({ slug: z.string(), categorySlug: z.string(), title: z.string(), summary: z.string(), position: z.number().int(), applicability: applicabilitySchema });
const detailSchema = articleSchema.extend({ body: z.string() });
const pageSchema = z.object({ items: z.array(articleSchema), page: z.number().int().nonnegative(), pageSize: z.number().int().positive(), totalCount: z.string().regex(/^\d+$/) });
export type HelpCategory = z.infer<typeof categorySchema>;
export type HelpArticle = z.infer<typeof articleSchema>;
export type HelpArticleDetail = z.infer<typeof detailSchema>;
export type HelpPage = z.infer<typeof pageSchema>;
export interface HelpCriteria { query: string; category: string; applicability: "" | z.infer<typeof applicabilitySchema>; page: number; pageSize: number }
function parseHelp<T>(schema: z.ZodType<T>, data: unknown): T {
  const parsed = schema.safeParse(data);
  if (!parsed.success) throw new ApiRequestError(502, "INVALID_HELP_RESPONSE", "Ayuda no disponible", "Recibimos una respuesta incompleta.");
  return parsed.data;
}
export async function getHelpCategories(signal?: AbortSignal): Promise<HelpCategory[]> {
  const { data, error, response } = await apiClient.GET("/api/v1/help/categories", { signal });
  if (!response.ok) throw toApiRequestError(response.status, error, "No pudimos consultar Ayuda", "Inténtalo otra vez.");
  return parseHelp(z.object({ items: z.array(categorySchema) }), data).items;
}
export async function searchHelpArticles(criteria: HelpCriteria, signal?: AbortSignal): Promise<HelpPage> {
  const { data, error, response } = await apiClient.GET("/api/v1/help/articles", { signal, params: { query: {
    ...(criteria.query ? { que: criteria.query } : {}), ...(criteria.category ? { category: criteria.category } : {}),
    ...(criteria.applicability ? { applicability: criteria.applicability } : {}), page: criteria.page, pageSize: criteria.pageSize,
  } } });
  if (!response.ok) throw toApiRequestError(response.status, error, "No pudimos buscar en Ayuda", "Inténtalo otra vez.");
  return parseHelp(pageSchema, data);
}
export async function getHelpArticle(slug: string, signal?: AbortSignal): Promise<HelpArticleDetail> {
  const { data, error, response } = await apiClient.GET("/api/v1/help/articles/{slug}", { signal, params: { path: { slug } } });
  if (!response.ok) throw toApiRequestError(response.status, error, "No pudimos consultar el artículo", "Inténtalo otra vez.");
  return parseHelp(detailSchema, data);
}
