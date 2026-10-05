import { z } from "zod";
import { apiClient } from "./client";
import { ApiRequestError, toApiRequestError } from "./errors";
import { editionFormatSchema } from "./editionFormats";

/** Internal destinations are supplied by the backend; clients never rebuild ranking or offer rules. */
export const storefrontHrefSchema = z.string().regex(/^\/(?!\/)[^\\]*$/).refine(href => !/[\u0000-\u001f]/.test(href));
const featuredSchema = z.object({
  editionId: z.string(), bookId: z.string(), title: z.string(), authors: z.string(), coverUrl: z.string().nullable(),
  format: editionFormatSchema, productType: z.enum(["PHYSICAL", "EBOOK", "AUDIOBOOK"]), price: z.string(),
  offer: z.object({ offerId: z.string(), originalPrice: z.string(), discountAmount: z.string(), effectivePrice: z.string(), savingsAmount: z.string(), savingsPercent: z.string().nullable(), startsAt: z.string(), endsAt: z.string(), daysRemaining: z.number().int().nonnegative(), endingSoon: z.boolean(), offerCopy: z.string().nullable().optional(), terms: z.string().nullable().optional() }).nullable(),
  href: storefrontHrefSchema,
});
const sectionSchema = z.object({
  key: z.enum(["PHYSICAL", "EBOOK", "AUDIOBOOK", "OFFERS", "HELP"]), label: z.string(), href: storefrontHrefSchema,
  featured: z.array(featuredSchema).max(3), categories: z.array(z.object({ slug: z.string(), name: z.string(), parentSlug: z.string().nullable(), href: storefrontHrefSchema })),
  allHref: storefrontHrefSchema.nullable(), bestSellingHref: storefrontHrefSchema.nullable(), offersHref: storefrontHrefSchema.nullable(), activeOfferCount: z.string().regex(/^\d+$/),
});
const navigationSchema = z.object({ sections: z.array(sectionSchema) });
export type StorefrontNavigation = z.infer<typeof navigationSchema>;
export type StorefrontSection = StorefrontNavigation["sections"][number];
export async function getStorefrontNavigation(signal?: AbortSignal): Promise<StorefrontNavigation> {
  const { data, error, response } = await apiClient.GET("/api/v1/storefront/navigation", { signal });
  if (!response.ok) throw toApiRequestError(response.status, error, "No pudimos consultar la navegación", "Inténtalo otra vez.");
  const parsed = navigationSchema.safeParse(data);
  if (!parsed.success) throw new ApiRequestError(502, "INVALID_STOREFRONT_RESPONSE", "Navegación no disponible", "Recibimos una respuesta incompleta.");
  return parsed.data;
}
