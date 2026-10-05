import { z } from "zod";
import type { components, operations } from "./generated";
import { apiClient } from "./client";
import { isRecord, toApiRequestError } from "./errors";
import { digitalMetadataFields, editionFormatSchema, validateDigitalMetadata, type EditionFormat } from "./editionFormats";

const offerSchema = z.object({
  offerId: z.string().regex(/^[1-9]\d*$/),
  originalPrice: z.string().regex(/^\d{1,9}\.\d{2}$/),
  discountAmount: z.string().regex(/^\d{1,9}\.\d{2}$/),
  effectivePrice: z.string().regex(/^\d{1,9}\.\d{2}$/),
  savingsAmount: z.string().regex(/^\d{1,9}\.\d{2}$/),
  savingsPercent: z.string().regex(/^\d{1,3}\.\d{2}$/).nullable(),
  startsAt: z.string().datetime({ offset: true }),
  endsAt: z.string().datetime({ offset: true }),
  daysRemaining: z.number().int().nonnegative(),
  endingSoon: z.boolean(),
  offerCopy: z.string().nullable().optional(),
  terms: z.string().nullable().optional(),
});

const offerSortSchema = z.enum(["RELEVANCE", "ENDING_SOON", "PRICE_ASC", "PRICE_DESC"]);
const offerProductTypeSchema = z.enum(["PHYSICAL", "EBOOK", "AUDIOBOOK"]);
const offersFilterOptionsSchema = z.object({
  productTypes: z.array(z.object({ code: offerProductTypeSchema, label: z.string(), count: z.string() })),
  categories: z.array(z.object({ slug: z.string(), name: z.string(), count: z.string() })),
  sorts: z.array(z.object({ code: offerSortSchema, label: z.string() })),
  totalCount: z.string(),
  endingSoonDays: z.number().int().nonnegative(),
  timezone: z.string(),
});
export type OfferSummary = z.infer<typeof offerSchema>;
export type OffersFilterOptions = z.infer<typeof offersFilterOptionsSchema>;
export interface OffersCriteria {
  productType: "" | z.infer<typeof offerProductTypeSchema>;
  category: string;
  sort: z.infer<typeof offerSortSchema>;
  page: number;
  pageSize: number;
}

const editionSummarySchema = z.object({
  editionId: z.string(),
  bookId: z.string(),
  title: z.string(),
  authors: z.string(),
  publisher: z.string(),
  isbn13: z.string().nullable(),
  price: z.string(),
  coverUrl: z.string().nullable(),
  coverLicense: z.string().nullable(),
  coverAttribution: z.string().nullable(),
  format: editionFormatSchema,
  language: z.string(),
  available: z.boolean(),
  offer: offerSchema.nullable().optional(),
  ...digitalMetadataFields,
}).superRefine(validateDigitalMetadata);

const editionDetailCompatibilitySchema = z.object({
  // Detail historically rendered unknown future formats with an explicit fallback label.
  format: z.string().optional(),
  offer: offerSchema.nullable().optional(),
  ...digitalMetadataFields,
}).superRefine((detail, context) => {
  const format = editionFormatSchema.safeParse(detail.format);
  if (format.success) validateDigitalMetadata({ ...detail, format: format.data }, context);
});

const publicCategorySchema = z.object({
  slug: z.string(),
  name: z.string(),
  parentSlug: z.string().nullable(),
});

const publicCatalogFilterOptionsSchema = z.object({
  languages: z.array(z.string().regex(/^[a-z]{2,3}$/)),
  formats: z.array(editionFormatSchema).default([]),
  minimumPrice: z.string().regex(/^\d{1,9}\.\d{2}$/).nullable(),
  maximumPrice: z.string().regex(/^\d{1,9}\.\d{2}$/).nullable(),
}).superRefine((options, context) => {
  if ((options.minimumPrice === null) !== (options.maximumPrice === null)) {
    context.addIssue({ code: "custom", message: "Catalog filter price bounds are incomplete." });
    return;
  }
  if (options.minimumPrice !== null && options.maximumPrice !== null
      && Number(options.minimumPrice) > Number(options.maximumPrice)) {
    context.addIssue({ code: "custom", message: "Catalog filter price bounds are invalid." });
  }
});

const pageEnvelopeSchema = z.object({
  items: z.array(z.unknown()),
  page: z.number().int().nonnegative(),
  pageSize: z.number().int().positive(),
  totalCount: z.string(),
});

export type EditionSummary = z.infer<typeof editionSummarySchema>;
export type PublicCategory = z.infer<typeof publicCategorySchema> & Pick<components["schemas"]["Category"], "slug" | "name">;
export type EditionDetail = components["schemas"]["CatalogEditionDetailResponse"] & { available: boolean };
export type PublicCatalogFilterOptions = z.infer<typeof publicCatalogFilterOptionsSchema>;

export type EditionSearch = {
  query: string;
  category: string;
  minPrice: string;
  maxPrice: string;
  language: string;
  format: "" | EditionFormat;
  sort: "TITLE_ASC" | "PRICE_ASC" | "PRICE_DESC";
  page: number;
  pageSize: number;
};

export interface CatalogPage extends Omit<components["schemas"]["CatalogEditionSearchResponse"], "items" | "page" | "pageSize" | "totalCount"> {
  items: EditionSummary[];
  page: number;
  pageSize: number;
  totalCount: string;
  totalCountValue: bigint;
}

const maximumDatabaseCount = 9_223_372_036_854_775_807n;

export function parseTotalCount(value: unknown): bigint | null {
  if (typeof value !== "string" || !/^\d{1,19}$/.test(value)) return null;
  try {
    const count = BigInt(value);
    return count <= maximumDatabaseCount ? count : null;
  } catch {
    return null;
  }
}

export async function getPublicCategories(signal?: AbortSignal) {
  const { data, error, response } = await apiClient.GET("/api/v1/catalog/categories", { signal });
  if (error) {
    throw toApiRequestError((response as Response).status, error, "No pudimos actualizar las categorías", "Revisa tu conexión e inténtalo otra vez.");
  }

  const items = isRecord(data) && Array.isArray(data.items) ? data.items : null;
  if (!items) throw invalidCatalogResponse();

  const parsedItems = z.array(publicCategorySchema).safeParse(items);
  if (!parsedItems.success) throw invalidCatalogResponse();
  return { items: parsedItems.data };
}

export async function getPublicCatalogFilterOptions(signal?: AbortSignal): Promise<PublicCatalogFilterOptions> {
  const { data, error, response } = await apiClient.GET("/api/v1/catalog/filter-options", { signal });
  if (error) {
    throw toApiRequestError((response as Response).status, error,
      "No pudimos actualizar los filtros del catálogo", "Revisa tu conexión e inténtalo otra vez.");
  }

  const parsed = publicCatalogFilterOptionsSchema.safeParse(data);
  if (!parsed.success) throw invalidCatalogResponse();
  return parsed.data;
}

export async function searchPublicEditions(search: EditionSearch, signal?: AbortSignal) {
  const query: NonNullable<operations["search"]["parameters"]["query"]> = {
    ...(search.query ? { que: search.query } : {}),
    ...(search.category ? { category: search.category } : {}),
    ...(search.minPrice ? { minPrice: search.minPrice as unknown as number } : {}),
    ...(search.maxPrice ? { maxPrice: search.maxPrice as unknown as number } : {}),
    ...(search.language ? { language: search.language } : {}),
    ...(search.format ? { format: search.format } : {}),
    sort: search.sort,
    page: search.page,
    pageSize: search.pageSize,
  };

  const { data, error, response } = await apiClient.GET("/api/v1/catalog/editions", {
    params: { query },
    signal,
  });
  if (error) {
    throw toApiRequestError(response.status, error, "No pudimos actualizar el catálogo", "Revisa tu conexión e inténtalo otra vez.");
  }

  return parseCatalogPage(data);
}

export async function getPublicOffers(page: number, pageSize = 20, signal?: AbortSignal, criteria?: OffersCriteria): Promise<CatalogPage> {
  const { data, error, response } = await apiClient.GET("/api/v1/catalog/offers", {
    params: { query: { page, pageSize, ...(criteria?.productType ? { productType: criteria.productType } : {}), ...(criteria?.category ? { category: criteria.category } : {}), ...(criteria ? { sort: criteria.sort } : {}) } }, signal,
  });
  if (error) throw toApiRequestError(response.status, error, "No pudimos consultar las ofertas", "Revisa tu conexión e inténtalo otra vez.");
  return parseCatalogPage(data);
}

export async function getOffersFilterOptions(signal?: AbortSignal): Promise<OffersFilterOptions> {
  const { data, error, response } = await apiClient.GET("/api/v1/catalog/offers/filter-options", { signal });
  if (!response.ok) throw toApiRequestError(response.status, error, "No pudimos consultar los filtros de ofertas", "Revisa tu conexión e inténtalo otra vez.");
  const parsed = offersFilterOptionsSchema.safeParse(data);
  if (!parsed.success || parseTotalCount(parsed.data.totalCount) === null
      || parsed.data.productTypes.some(item => parseTotalCount(item.count) === null)
      || parsed.data.categories.some(item => parseTotalCount(item.count) === null)) throw invalidCatalogResponse();
  return parsed.data;
}

function parseCatalogPage(data: unknown): CatalogPage {
  const envelope = pageEnvelopeSchema.safeParse(data);
  if (!envelope.success) throw invalidCatalogResponse();
  const totalCountValue = parseTotalCount(envelope.data.totalCount);
  const items = z.array(editionSummarySchema).safeParse(envelope.data.items);
  if (totalCountValue === null || !items.success) throw invalidCatalogResponse();

  return {
    ...envelope.data,
    items: items.data,
    totalCountValue,
  } satisfies CatalogPage;
}

export async function getPublicEdition(editionId: string, signal?: AbortSignal): Promise<EditionDetail> {
  const { data, error, response } = await apiClient.GET("/api/v1/catalog/editions/{editionId}", {
    params: { path: { editionId: editionId as unknown as number } },
    signal,
  });
  if (error) {
    throw toApiRequestError(response.status, error, "No pudimos consultar la edición", "Revisa tu conexión e inténtalo otra vez.");
  }
  if (!data || typeof data.available !== "boolean") throw invalidCatalogResponse();
  if (!editionDetailCompatibilitySchema.safeParse(data).success) throw invalidCatalogResponse();
  return { ...data, available: data.available };
}

function invalidCatalogResponse() {
  return toApiRequestError(
    502,
    { code: "INVALID_CATALOG_RESPONSE", title: "No pudimos actualizar el catálogo", detail: "Recibimos una respuesta incompleta. Vuelve a intentarlo." },
    "No pudimos actualizar el catálogo",
    "Recibimos una respuesta incompleta. Vuelve a intentarlo.",
  );
}
