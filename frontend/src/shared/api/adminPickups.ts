import { z } from "zod";
import { apiClient } from "./client";
import { toApiRequestError } from "./errors";
import { pickupStateSchema } from "./pickup";

const idSchema = z.string().min(1);
const timestampSchema = z.iso.datetime({ offset: true });
const moneySchema = z.string().regex(/^\d+\.\d{2}$/);
const pickupCodeSchema = z.string().trim().min(1, "Ingresa el código de retiro.").max(64, "El código de retiro no es válido.");

/** Administrative projection: codes are accepted by commands and never returned to callers. */
export const adminPickupViewSchema = z.object({
  orderId: idSchema,
  orderReference: z.string().min(1),
  state: pickupStateSchema,
  orderState: z.string().min(1),
  paymentState: z.string().min(1),
  createdAt: timestampSchema,
  readyAt: timestampSchema.nullable(),
  collectedAt: timestampSchema.nullable(),
  collectedBy: z.object({ userId: idSchema, email: z.string() }).nullable(),
  identityVerified: z.boolean().nullable(),
  location: z.object({ id: idSchema, name: z.string(), address: z.string(), city: z.string() }),
  customer: z.object({
    customerId: idSchema, name: z.string(), email: z.string(),
    identityType: z.string().nullable(), identityNumber: z.string().nullable(),
  }),
  items: z.array(z.object({
    orderItemId: idSchema, title: z.string(), format: z.string().nullable(), quantity: z.number().int().positive(),
  })),
  unitCount: z.number().int().nonnegative(),
  total: moneySchema,
});
export type AdminPickupView = z.infer<typeof adminPickupViewSchema>;

export const adminPickupDetailSchema = adminPickupViewSchema.extend({
  paymentMethod: z.string().nullable(),
  availableActions: z.object({ cancel: z.boolean(), cancellationDeadline: timestampSchema.nullable() }),
});
export type AdminPickupDetail = z.infer<typeof adminPickupDetailSchema>;

export const adminPickupPageSchema = z.object({
  items: z.array(adminPickupViewSchema),
  page: z.number().int().nonnegative(),
  pageSize: z.number().int().min(1).max(50),
  totalCount: z.string().regex(/^\d+$/),
});
export type AdminPickupPage = z.infer<typeof adminPickupPageSchema>;

export const adminPickupSearchSchema = z.object({
  state: pickupStateSchema.optional(),
  q: z.string().max(100, "La búsqueda no puede superar 100 caracteres.").optional(),
  page: z.number().int().nonnegative().default(0),
  pageSize: z.number().int().min(1).max(50).default(20),
});
export type AdminPickupSearch = z.input<typeof adminPickupSearchSchema>;

export const adminPickupLookupRequestSchema = z.object({ code: pickupCodeSchema });
export type AdminPickupLookupRequest = z.infer<typeof adminPickupLookupRequestSchema>;
export const adminPickupCollectRequestSchema = z.object({
  pickupCode: pickupCodeSchema,
  identityVerified: z.literal(true, "Confirma la identificación de quien retira el pedido."),
});
export type AdminPickupCollectRequest = z.infer<typeof adminPickupCollectRequestSchema>;

export async function lookupAdminPickup(code: string, signal?: AbortSignal): Promise<AdminPickupView> {
  const body = adminPickupLookupRequestSchema.parse({ code });
  const { data, error, response } = await apiClient.POST("/api/v1/admin/pickups/lookup", { body, signal, cache: "no-store" });
  if (!response.ok) throw toApiRequestError(response.status, error, "No pudimos consultar el retiro", "Revisa el código de retiro e inténtalo otra vez.");
  return parsePickup(data);
}

export async function listAdminPickups(criteria: AdminPickupSearch = {}, signal?: AbortSignal): Promise<AdminPickupPage> {
  const query = adminPickupSearchSchema.parse(criteria);
  const { data, error, response } = await apiClient.GET("/api/v1/admin/pickups", { params: { query }, signal, cache: "no-store" });
  if (!response.ok) throw toApiRequestError(response.status, error, "No pudimos consultar los retiros", "Comprueba tu conexión e inténtalo otra vez.");
  const parsed = adminPickupPageSchema.safeParse(data);
  if (!parsed.success) throw invalidPickupResponse();
  return parsed.data;
}

export async function collectAdminPickup(orderId: string, command: AdminPickupCollectRequest): Promise<AdminPickupView> {
  const body = adminPickupCollectRequestSchema.parse(command);
  const { data, error, response } = await apiClient.POST("/api/v1/admin/orders/{orderId}/pickup/collect", {
    params: { path: { orderId: orderId as unknown as number } }, body, cache: "no-store",
  });
  if (!response.ok) throw toApiRequestError(response.status, error, "No pudimos confirmar el retiro", "Consulta el estado actual del retiro antes de volver a intentarlo.");
  return parsePickup(data);
}

export async function getAdminPickup(orderId: string, signal?: AbortSignal): Promise<AdminPickupDetail> {
  const { data, error, response } = await apiClient.GET("/api/v1/admin/pickups/{orderId}", {
    params: { path: { orderId: orderId as unknown as number } }, signal, cache: "no-store",
  });
  if (!response.ok) throw toApiRequestError(response.status, error, "No pudimos consultar el retiro", "Comprueba tu conexión e inténtalo otra vez.");
  return parseDetail(data);
}

export async function verifyAdminPickupCode(orderId: string, code: string): Promise<AdminPickupDetail> {
  const body = adminPickupLookupRequestSchema.parse({ code });
  const { data, error, response } = await apiClient.POST("/api/v1/admin/pickups/{orderId}/verify-code", {
    params: { path: { orderId: orderId as unknown as number } }, body, cache: "no-store",
  });
  if (!response.ok) throw toApiRequestError(response.status, error, "No pudimos verificar el código", "Revisa el código e inténtalo otra vez.");
  return parseDetail(data);
}

function parseDetail(data: unknown): AdminPickupDetail {
  const parsed = adminPickupDetailSchema.safeParse(data);
  if (!parsed.success) throw invalidPickupResponse();
  return parsed.data;
}

function parsePickup(data: unknown): AdminPickupView {
  const parsed = adminPickupViewSchema.safeParse(data);
  if (!parsed.success) throw invalidPickupResponse();
  return parsed.data;
}

function invalidPickupResponse() {
  return toApiRequestError(502, {}, "No pudimos consultar el retiro", "La respuesta del servidor está incompleta. Inténtalo otra vez.");
}
