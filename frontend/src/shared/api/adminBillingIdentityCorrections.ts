import { z } from "zod";
import { apiClient } from "./client";
import { toApiRequestError } from "./errors";

const idSchema = z.string().min(1);
const identificationTypeSchema = z.enum(["EC_CEDULA", "EC_RUC"]);
export const adminBillingIdentityCorrectionStatusSchema = z.enum(["PENDING", "APPROVED", "REJECTED", "WITHDRAWN"]);
export type AdminBillingIdentityCorrectionStatus = z.infer<typeof adminBillingIdentityCorrectionStatusSchema>;

export const adminBillingIdentityCorrectionSchema = z.object({
  id: idSchema,
  customerId: idSchema,
  customerName: z.string(),
  customerEmail: z.string(),
  currentType: identificationTypeSchema,
  currentNumber: z.string(),
  proposedType: identificationTypeSchema,
  proposedNumber: z.string(),
  reasonCode: z.enum(["DOCUMENT_TYPO", "DOCUMENT_CHANGED", "OTHER"]),
  note: z.string().nullable(),
  status: adminBillingIdentityCorrectionStatusSchema,
  createdAt: z.string(),
  dueAt: z.string(),
  decidedAt: z.string().nullable(),
  decidedBy: idSchema.nullable(),
  decidedByEmail: z.string().nullable(),
  decisionReason: z.string().nullable(),
  customerHasBilledInvoices: z.boolean(),
});
export type AdminBillingIdentityCorrection = z.infer<typeof adminBillingIdentityCorrectionSchema>;

export const adminBillingIdentityCorrectionPageSchema = z.object({
  items: z.array(adminBillingIdentityCorrectionSchema),
  page: z.number().int().nonnegative(),
  pageSize: z.number().int().min(1).max(50),
  totalCount: z.string().regex(/^\d+$/),
});
export type AdminBillingIdentityCorrectionPage = z.infer<typeof adminBillingIdentityCorrectionPageSchema>;

export const adminBillingIdentityCorrectionSearchSchema = z.object({
  status: adminBillingIdentityCorrectionStatusSchema.optional(),
  page: z.number().int().nonnegative().default(0),
  pageSize: z.number().int().min(1).max(50).default(20),
});
export type AdminBillingIdentityCorrectionSearch = z.input<typeof adminBillingIdentityCorrectionSearchSchema>;

export const adminBillingIdentityCorrectionDecisionRequestSchema = z.object({
  decision: z.enum(["APPROVE", "REJECT"]),
  decisionReason: z.string().trim().nullish(),
}).superRefine((value, context) => {
  if (value.decision === "REJECT" && !value.decisionReason) {
    context.addIssue({ code: "custom", path: ["decisionReason"], message: "Escribe en español el motivo del rechazo." });
  }
});
export type AdminBillingIdentityCorrectionDecisionRequest = z.infer<typeof adminBillingIdentityCorrectionDecisionRequestSchema>;

export const adminBillingIdentityCorrectionDecisionSchema = z.object({
  id: idSchema,
  status: z.enum(["APPROVED", "REJECTED"]),
  decidedAt: z.string(),
  decidedBy: idSchema,
  decisionReason: z.string().nullable(),
});
export type AdminBillingIdentityCorrectionDecision = z.infer<typeof adminBillingIdentityCorrectionDecisionSchema>;

export async function listAdminBillingIdentityCorrections(criteria: AdminBillingIdentityCorrectionSearch = {}, signal?: AbortSignal): Promise<AdminBillingIdentityCorrectionPage> {
  const query = adminBillingIdentityCorrectionSearchSchema.parse(criteria);
  const { data, error, response } = await apiClient.GET("/api/v1/admin/billing-identity-corrections", {
    params: { query }, signal, cache: "no-store",
  });
  if (!response.ok) throw toApiRequestError(response.status, error, "No pudimos consultar las solicitudes", "Comprueba tu conexión e inténtalo otra vez.");
  const parsed = adminBillingIdentityCorrectionPageSchema.safeParse(data);
  if (!parsed.success) throw invalidCorrectionResponse();
  return parsed.data;
}

export async function decideAdminBillingIdentityCorrection(requestId: string, command: AdminBillingIdentityCorrectionDecisionRequest): Promise<AdminBillingIdentityCorrectionDecision> {
  const body = adminBillingIdentityCorrectionDecisionRequestSchema.parse(command);
  const { data, error, response } = await apiClient.POST("/api/v1/admin/billing-identity-corrections/{requestId}/decision", {
    params: { path: { requestId: requestId as unknown as number } },
    body: { ...body, decisionReason: body.decisionReason ?? undefined }, cache: "no-store",
  });
  if (!response.ok) throw toApiRequestError(response.status, error, "No pudimos guardar la decisión", "Actualiza la solicitud antes de volver a intentarlo.");
  const parsed = adminBillingIdentityCorrectionDecisionSchema.safeParse(data);
  if (!parsed.success) throw invalidCorrectionResponse();
  return parsed.data;
}

function invalidCorrectionResponse() {
  return toApiRequestError(502, {}, "No pudimos consultar la solicitud", "La respuesta del servidor está incompleta. Inténtalo otra vez.");
}
