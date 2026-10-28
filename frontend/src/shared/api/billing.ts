import { z } from "zod";
import { identificationError, identificationType, isValidIdentification, normalizeIdentification } from "@/shared/validation/identification";
import { personNameError } from "@/shared/validation/person";
import { apiClient } from "./client";
import { toApiRequestError } from "./errors";

/**
 * A cédula or a RUC (ADR 0041). The kind follows from the complete number (10 or 13 digits), so the customer
 * types one field; the server validates the pair again.
 */
export const billingIdentitySchema = z.object({
  type: z.string().optional(),
  number: z.string(),
}).transform(({ number }) => {
  const value = normalizeIdentification(number);
  return { type: identificationType(value) ?? "EC_CEDULA", number: value } as { type: "EC_CEDULA" | "EC_RUC"; number: string };
}).superRefine((identity, context) => {
  if (!isValidIdentification(identity.type, identity.number)) context.addIssue({ code: "custom", path: ["number"], message: identificationError(identity.number) ?? "Ingresa una cédula (10 dígitos) o un RUC (13 dígitos) válidos" });
});
const identificationTypeSchema = z.enum(["EC_CEDULA", "EC_RUC"]);
/** A correction the customer asked for once the number was on an invoice (ADR 0043): staff decide, nothing changes before. */
export const billingIdentityCorrectionRequestSchema = z.object({
  id: z.string(),
  status: z.enum(["PENDING", "APPROVED", "REJECTED", "WITHDRAWN"]),
  proposedType: identificationTypeSchema,
  proposedNumber: z.string(),
  reasonCode: z.enum(["DOCUMENT_TYPO", "DOCUMENT_CHANGED", "OTHER"]),
  createdAt: z.string(),
  dueAt: z.string(),
  decidedAt: z.string().nullable(),
  decisionReason: z.string().nullable(),
});
export type BillingIdentityCorrectionRequest = z.infer<typeof billingIdentityCorrectionRequestSchema>;
export type CorrectionReason = BillingIdentityCorrectionRequest["reasonCode"];
/**
 * What the server returns. Lenient on purpose: a number stored before ADR 0041 is shown so it can be corrected.
 * `correctionMode` is REQUEST once the account's identification has been on an invoice (ADR 0043); the server
 * enforces it either way, so an older reply without it reads as DIRECT and a refusal switches the editor.
 */
export const storedBillingIdentitySchema = z.object({
  type: identificationTypeSchema,
  number: z.string().regex(/^[0-9]{10}([0-9]{3})?$/),
  used: z.boolean().optional().default(false),
  correctionMode: z.enum(["DIRECT", "REQUEST"]).optional().default("DIRECT"),
  correctionRequest: billingIdentityCorrectionRequestSchema.nullable().optional().default(null),
});
export type StoredBillingIdentity = z.infer<typeof storedBillingIdentitySchema>;

/** The same person's cédula and natural-person RUC (cédula + 001): switching between them never needs review. */
export function isSamePersonIdentification(current: { type: string; number: string }, next: { type: string; number: string }) {
  return (current.type === "EC_CEDULA" && next.type === "EC_RUC" && next.number === `${current.number}001`)
    || (current.type === "EC_RUC" && next.type === "EC_CEDULA" && current.number === `${next.number}001`);
}
export type BillingIdentity = z.infer<typeof billingIdentitySchema>;
const required = (label: string, max: number) => z.string().trim().min(1, `Escribe ${label}.`).max(max, `Usa como máximo ${max} caracteres.`);
export const billingAddressSchema = z.object({
  line1: required("la dirección de facturación", 200),
  line2: z.string().trim().max(200).nullable(),
  // From the INEC catalog (ADR 0044); the invoice keeps the names the server resolves.
  provinceId: z.string().min(1, "Elige la provincia de facturación."),
  cityId: z.string().min(1, "Elige la ciudad de facturación."),
  countryCode: z.literal("EC"),
  postalCode: z.string().trim().max(20).nullable(),
});
/** Who the invoice is for (ADR 0043): the account holder, or another person or company for this invoice only. */
export type BillingRecipient = "ACCOUNT" | "OTHER";
const checkoutBillingShape = {
  billingRecipient: z.enum(["ACCOUNT", "OTHER"]).default("ACCOUNT"),
  billingIdentity: billingIdentitySchema,
  buyerName: z.string().trim(),
  billingAddress: billingAddressSchema,
};
/**
 * The buyer name follows the recipient: the account holder's is a person's name; another recipient may be a
 * company, so its razón social keeps digits and punctuation (the server allows up to 240 characters).
 * Exported so a form that spreads the shape keeps the same rule.
 */
export function refineCheckoutBilling(values: { billingRecipient?: BillingRecipient; buyerName: string }, context: z.RefinementCtx) {
  const message = values.billingRecipient === "OTHER"
    ? !values.buyerName ? "Escribe el nombre o la razón social." : [...values.buyerName].length > 240 ? "Usa como máximo 240 caracteres." : null
    : personNameError(values.buyerName, "nombres");
  if (message) context.addIssue({ code: "custom", path: ["buyerName"], message });
}
/** Judge the name even while other fields are still wrong, as a field rule would: it depends only on two strings. */
export const checkoutBillingRefinement = {
  when: (payload: { value: unknown }) => typeof (payload.value as { buyerName?: unknown } | null)?.buyerName === "string",
};
export const checkoutBillingSchema = z.object(checkoutBillingShape).superRefine(refineCheckoutBilling, checkoutBillingRefinement);
export type CheckoutBilling = z.infer<typeof checkoutBillingSchema>;
/** What the checkout form holds before parsing (the kind of identification is derived on parse). */
export type CheckoutBillingInput = z.input<typeof checkoutBillingSchema>;

export const invoiceMetadataSchema = z.object({
  invoiceId:z.string().min(1),orderId:z.string().min(1),
  state:z.enum(["DRAFT","ISSUED","VOID"]),provenance:z.enum(["SIMULATED","LEGACY"]),
  documentNumber:z.string().nullable(),files:z.array(z.object({type:z.enum(["PDF","XML"]),state:z.enum(["PENDING","PROCESSING","READY","FAILED","UNAVAILABLE"])})),
});
export type InvoiceMetadata=z.infer<typeof invoiceMetadataSchema>;
export type InvoiceFileType="PDF"|"XML";
export const invoiceDocumentAccessSchema=z.object({
  delivery:z.enum(["API_STREAM","SIGNED_URL"]),
  url:z.string().min(1),
  expiresAt:z.string().datetime().nullable(),
});
export type InvoiceDocumentAccess=z.infer<typeof invoiceDocumentAccessSchema>;
export async function getInvoiceMetadata(orderId:string,signal?:AbortSignal):Promise<InvoiceMetadata|null> {
  const {data,error,response}=await apiClient.GET("/api/v1/orders/{orderId}/invoice",{params:{path:{orderId}},signal,cache:"no-store"});
  if(response.status===404) return null;
  if(!response.ok) throw toApiRequestError(response.status,error,"No pudimos consultar los documentos","Tu compra se conserva. Vuelve a consultar los documentos.");
  const parsed=invoiceMetadataSchema.safeParse(data);
  if(!parsed.success || parsed.data.orderId!==orderId) throw toApiRequestError(502,{},"No pudimos consultar los documentos","La respuesta del servidor está incompleta.");
  return parsed.data;
}
/** `inline` asks for a PDF meant to be viewed rather than saved; the default stays an attachment. */
export async function getInvoiceFile(orderId:string,type:InvoiceFileType,signal?:AbortSignal,disposition?:"inline"|"attachment"):Promise<Blob> {
  const {data,error,response}=await apiClient.GET("/api/v1/orders/{orderId}/invoice/files/{type}",{params:{path:{orderId,type},...(disposition ? {query:{disposition}} : {})},parseAs:"blob",signal,headers:{Accept:type==="PDF" ? "application/pdf" : "application/xml"},cache:"no-store"});
  if(!response.ok) throw toApiRequestError(response.status,error,"No pudimos descargar el documento","El documento puede seguir en preparación. Actualiza sus datos y vuelve a consultar.");
  const mime=response.headers.get("Content-Type")?.split(";")[0].trim();
  if(!data || data.size===0 || mime!==(type==="PDF"?"application/pdf":"application/xml")) throw toApiRequestError(502,{},"No pudimos descargar el documento","El archivo recibido está incompleto. Vuelve a consultar los documentos.");
  return data;
}
/** Resolves an authenticated inline PDF stream or a short-lived signed URL without caching either instruction. */
export async function getInvoiceAccess(orderId:string,signal?:AbortSignal,disposition?:"inline"|"attachment"):Promise<InvoiceDocumentAccess> {
  const {data,error,response}=await apiClient.GET("/api/v1/orders/{orderId}/invoice/files/PDF/access",{params:{path:{orderId},...(disposition!==undefined?{query:{disposition}}:{})},signal,cache:"no-store"});
  if(!response.ok) throw toApiRequestError(response.status,error,"No pudimos abrir el documento","El PDF puede seguir en preparación. Actualiza los datos e inténtalo de nuevo.");
  const parsed=invoiceDocumentAccessSchema.safeParse(data);
  if(!parsed.success) throw toApiRequestError(502,{},"No pudimos abrir el documento","La respuesta del servidor está incompleta.");
  return parsed.data;
}
