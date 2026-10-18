import { z } from "zod";
import { cedulaValidationMessage, isValidEcuadorianCedula } from "@/shared/validation/cedula";
import { personNameError } from "@/shared/validation/person";
import { apiClient } from "./client";
import { toApiRequestError } from "./errors";

export const billingIdentitySchema = z.object({
  type: z.literal("EC_CEDULA"),
  number: z.string().transform(value => value.replace(/^ +| +$/g, "")).refine(isValidEcuadorianCedula, cedulaValidationMessage),
});
export type BillingIdentity = z.infer<typeof billingIdentitySchema>;
const required = (label: string, max: number) => z.string().trim().min(1, `Escribe ${label}.`).max(max, `Usa como máximo ${max} caracteres.`);
export const billingAddressSchema = z.object({
  line1: required("la dirección de facturación", 200),
  line2: z.string().trim().max(200).nullable(),
  city: required("la ciudad de facturación", 100),
  province: required("la provincia de facturación", 100),
  countryCode: z.literal("EC"),
  postalCode: z.string().trim().max(20).nullable(),
});
export const checkoutBillingSchema = z.object({
  billingIdentity: billingIdentitySchema,
  buyerName: z.string().trim().superRefine((value, context) => {
    const message = personNameError(value, "nombres");
    if (message) context.addIssue({ code: "custom", message });
  }),
  billingAddress: billingAddressSchema,
});
export type CheckoutBilling = z.infer<typeof checkoutBillingSchema>;

export const invoiceMetadataSchema = z.object({
  invoiceId:z.string().min(1),orderId:z.string().min(1),
  state:z.enum(["DRAFT","ISSUED","VOID"]),provenance:z.enum(["SIMULATED","LEGACY"]),
  documentNumber:z.string().nullable(),files:z.array(z.object({type:z.enum(["PDF","XML"]),state:z.enum(["PENDING","PROCESSING","READY","FAILED","UNAVAILABLE"])})),
});
export type InvoiceMetadata=z.infer<typeof invoiceMetadataSchema>;
export type InvoiceFileType="PDF"|"XML";
export async function getInvoiceMetadata(orderId:string,signal?:AbortSignal):Promise<InvoiceMetadata|null> {
  const {data,error,response}=await apiClient.GET("/api/v1/orders/{orderId}/invoice",{params:{path:{orderId}},signal,cache:"no-store"});
  if(response.status===404) return null;
  if(!response.ok) throw toApiRequestError(response.status,error,"No pudimos consultar los documentos","Tu compra se conserva. Vuelve a consultar los documentos.");
  const parsed=invoiceMetadataSchema.safeParse(data);
  if(!parsed.success || parsed.data.orderId!==orderId) throw toApiRequestError(502,{},"No pudimos consultar los documentos","La respuesta del servidor está incompleta.");
  return parsed.data;
}
export async function getInvoiceFile(orderId:string,type:InvoiceFileType,signal?:AbortSignal):Promise<Blob> {
  const {data,error,response}=await apiClient.GET("/api/v1/orders/{orderId}/invoice/files/{type}",{params:{path:{orderId,type}},parseAs:"blob",signal,headers:{Accept:type==="PDF" ? "application/pdf" : "application/xml"},cache:"no-store"});
  if(!response.ok) throw toApiRequestError(response.status,error,"No pudimos descargar el documento","El documento puede seguir en preparación. Actualiza sus datos y vuelve a consultar.");
  const mime=response.headers.get("Content-Type")?.split(";")[0].trim();
  if(!data || data.size===0 || mime!==(type==="PDF"?"application/pdf":"application/xml")) throw toApiRequestError(502,{},"No pudimos descargar el documento","El archivo recibido está incompleto. Vuelve a consultar los documentos.");
  return data;
}
