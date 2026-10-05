import { z } from "zod";
import { apiClient } from "./client";
import { ApiRequestError, toApiRequestError } from "./errors";

const idSchema = z.string().regex(/^[1-9]\d*$/);
const ownedItemSchema = z.object({
  ownedItemId: idSchema, editionId: idSchema, coverUrl: z.string().nullable(), title: z.string(), authors: z.string(),
  productType: z.enum(["EBOOK", "AUDIOBOOK"]), acquiredAt: z.string().datetime({ offset: true }),
  ownershipState: z.enum(["OWNED", "REVOKED"]), accessState: z.enum(["OWNERSHIP_ONLY", "REVOKED"]), contentAccessSupported: z.literal(false),
  metadata: z.object({ isbn: z.string().nullable(), publisher: z.string(), language: z.string(), pageCount: z.number().int().nonnegative().nullable(), publicationDate: z.string().nullable(), ebookFileFormat: z.enum(["EPUB", "PDF"]).nullable(), audioDurationSeconds: z.number().int().positive().nullable(), narrators: z.array(z.string()) }),
  sourcePurchases: z.array(z.object({ orderId: idSchema, orderItemId: idSchema, acquiredAt: z.string().datetime({ offset: true }), paymentState: z.string(), orderState: z.string(), grantState: z.enum(["ACTIVE", "REVOKED"]) })),
  availableActions: z.array(z.discriminatedUnion("type", [
    z.object({ type: z.literal("VIEW_ORDER"), label: z.string(), href: z.string().regex(/^\/orders\/[1-9]\d*$/) }),
    z.object({ type: z.literal("HELP"), label: z.string(), href: z.string().regex(/^\/ayuda\/[a-z0-9-]+$/) }),
  ])),
}).superRefine((item, context) => {
  if ((item.ownershipState === "REVOKED") !== (item.accessState === "REVOKED")) context.addIssue({ code: "custom", message: "La titularidad y su estado no coinciden." });
});
const ownedPageSchema = z.object({ items: z.array(ownedItemSchema), page: z.number().int().nonnegative(), pageSize: z.number().int().positive(), totalCount: z.string().regex(/^\d+$/) });
export type OwnedItem = z.infer<typeof ownedItemSchema>;
export type OwnedItemsPage = z.infer<typeof ownedPageSchema>;
export interface LibraryCriteria { productType: "" | "EBOOK" | "AUDIOBOOK"; page: number; pageSize: number }
function parseLibrary<T>(schema: z.ZodType<T>, data: unknown): T {
  const parsed = schema.safeParse(data);
  if (!parsed.success) throw new ApiRequestError(502, "INVALID_LIBRARY_RESPONSE", "Biblioteca no disponible", "Recibimos una respuesta incompleta.");
  return parsed.data;
}
export async function listOwnedItems(criteria: LibraryCriteria, signal?: AbortSignal): Promise<OwnedItemsPage> {
  const { data, error, response } = await apiClient.GET("/api/v1/me/library", { signal, params: { query: { ...(criteria.productType ? { productType: criteria.productType } : {}), page: criteria.page, pageSize: criteria.pageSize } } });
  if (!response.ok) throw toApiRequestError(response.status, error, "No pudimos consultar Mi biblioteca", "Inténtalo otra vez.");
  return parseLibrary(ownedPageSchema, data);
}
export async function getOwnedItem(ownedItemId: string, signal?: AbortSignal): Promise<OwnedItem> {
  const { data, error, response } = await apiClient.GET("/api/v1/me/library/{ownedItemId}", { signal, params: { path: { ownedItemId: ownedItemId as unknown as number } } });
  if (!response.ok) throw toApiRequestError(response.status, error, "No pudimos consultar esta adquisición", "Inténtalo otra vez.");
  return parseLibrary(ownedItemSchema, data);
}
