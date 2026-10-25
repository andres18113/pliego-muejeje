import { z } from "zod";
import { apiClient } from "./client";
import { toApiRequestError } from "./errors";

const id = z.string().regex(/^[1-9]\d*$/);
export const digitalEligibilitySchema = z.object({
  editionId: id,
  owned: z.boolean(),
  ownedItemId: id.nullable(),
  pendingOrder: z.boolean(),
  pendingOrderId: id.nullable(),
  inCart: z.boolean(),
  purchasable: z.boolean(),
});
export type DigitalEligibility = z.infer<typeof digitalEligibilitySchema>;

export async function getDigitalEligibility(editionIds: string[], signal?: AbortSignal): Promise<DigitalEligibility[]> {
  const { data, error, response } = await apiClient.GET("/api/v1/me/digital-eligibility", {
    params: { query: { editionIds: editionIds.map(id => id as unknown as number) } }, signal,
  });
  if (!response.ok) throw toApiRequestError(response.status, error, "No pudimos consultar esta compra digital", "Inténtalo otra vez.");
  const parsed = z.array(digitalEligibilitySchema).safeParse(data);
  if (!parsed.success || parsed.data.length !== new Set(editionIds).size
      || new Set(parsed.data.map(item => item.editionId)).size !== parsed.data.length
      || parsed.data.some(item => !editionIds.includes(item.editionId))) {
    throw toApiRequestError(502, {}, "No pudimos consultar esta compra digital", "Recibimos una respuesta incompleta.");
  }
  return parsed.data;
}
