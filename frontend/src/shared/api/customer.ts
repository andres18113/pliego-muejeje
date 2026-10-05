import { z } from "zod";
import type { components } from "./generated";
import { apiClient } from "./client";
import { toApiRequestError } from "./errors";

export type AddressRequest = components["schemas"]["AddressRequest"];
export type AddressUpdateRequest = components["schemas"]["AddressUpdateRequest"];
export type ProfileUpdateRequest = components["schemas"]["ProfileUpdateRequest"];
export const addressesQueryKey = ["customer-addresses"] as const;
export const profileQueryKey = ["customer-profile"] as const;

const profileSchema = z.object({
  customerId: z.string().min(1),
  email: z.string().email(),
  firstNames: z.string(),
  lastNames: z.string(),
  phone: z.string().nullable(),
  state: z.enum(["ACTIVE", "BLOCKED"]),
  version: z.string().regex(/^(0|[1-9][0-9]*)$/),
});
export type CustomerProfile = z.infer<typeof profileSchema>;

export async function getProfile(signal?: AbortSignal): Promise<CustomerProfile> {
  const { data, error, response } = await apiClient.GET("/api/v1/me", { signal });
  if (!response.ok) throw toApiRequestError(response.status, error, "No pudimos consultar tus datos", "Comprueba tu conexión e inténtalo otra vez.");
  const parsed = profileSchema.safeParse(data);
  if (!parsed.success) throw toApiRequestError(502, {}, "No pudimos consultar tus datos", "La respuesta del servidor está incompleta. Inténtalo otra vez.");
  return parsed.data;
}

export async function updateProfile(body: ProfileUpdateRequest): Promise<void> {
  const { error, response } = await apiClient.PUT("/api/v1/me", { body });
  if (!response.ok) throw toApiRequestError(response.status, error, "No pudimos guardar tus datos", "Revisa los datos e inténtalo otra vez.");
}

export type ProfileField = "firstNames" | "lastNames" | "phone";
export async function patchProfile(field: ProfileField, value: string | null, expectedVersion: string): Promise<void> {
  const { error, response } = await apiClient.PATCH("/api/v1/me", { body: { field, value, expectedVersion } });
  if (!response.ok) throw toApiRequestError(response.status, error, "No pudimos guardar el cambio", "Revisa el perfil actual antes de guardar de nuevo.");
}

/** Thrown when the response was lost: the change may have been applied, so callers read the profile before retrying. */
export class EmailChangeOutcomeUnknown extends Error {
  constructor() {
    super("No pudimos confirmar si el correo cambió.");
    this.name = "EmailChangeOutcomeUnknown";
  }
}

export async function changeEmail(newEmail: string, currentPassword: string): Promise<string> {
  const result = await apiClient.PUT("/api/v1/me/email", { body: { newEmail, currentPassword } })
    .catch(() => { throw new EmailChangeOutcomeUnknown(); });
  if (result.response.ok) {
    const parsed = z.object({ email: z.string().min(3) }).safeParse(result.data);
    if (!parsed.success) throw new EmailChangeOutcomeUnknown();
    return parsed.data.email;
  }
  if (result.response.status >= 500) throw new EmailChangeOutcomeUnknown();
  throw toApiRequestError(result.response.status, result.error, "No pudimos cambiar tu correo", "Revisa los datos e inténtalo otra vez.");
}

const addressSchema = z.object({
  addressId: z.string().min(1),
  alias: z.string(),
  recipient: z.string(),
  line1: z.string(),
  line2: z.string().nullable().catch(null),
  city: z.string(),
  province: z.string(),
  countryCode: z.string(),
  postalCode: z.string().nullable().catch(null),
  reference: z.string().nullable().catch(null),
  phone: z.string(),
  primary: z.boolean(),
});

export type CustomerAddress = z.infer<typeof addressSchema>;

export async function listAddresses(signal?: AbortSignal): Promise<CustomerAddress[]> {
  const { data, error, response } = await apiClient.GET("/api/v1/me/addresses", { signal });
  if (!response.ok) {
    throw toApiRequestError(
      response.status,
      error,
      "No pudimos consultar tus direcciones",
      "Comprueba tu conexión e inténtalo otra vez.",
    );
  }
  const parsed = z.array(addressSchema).safeParse(data);
  if (!parsed.success) {
    throw toApiRequestError(502, {}, "No pudimos consultar tus direcciones", "La respuesta del servidor está incompleta. Inténtalo otra vez.");
  }
  return parsed.data;
}

export class AddressOutcomeUnknown extends Error {
  constructor() { super("La dirección sigue sin resolverse. Consulta el resultado antes de crear otra."); }
}

/** Replaying the same actor-scoped key and payload returns the original receipt. */
export async function createAddress(body: AddressRequest, key: string) {
  const { data, error, response } = await apiClient.POST("/api/v1/me/addresses", { body, params: { header: { "Idempotency-Key": key } } })
    .catch(() => { throw new AddressOutcomeUnknown(); });
  if (response.status >= 500) throw new AddressOutcomeUnknown();
  if (!response.ok) {
    const known = ["VALIDATION_ERROR", "MALFORMED_JSON", "P1001", "P1002", "P1003", "P1004", "P1005", "P1011", "AUTH_REQUIRED", "AUTH_INVALID_TOKEN", "AUTH_INVALID_SESSION", "ACCESS_DENIED"];
    const code = typeof error === "object" && error !== null && "code" in error ? error.code : null;
    if (!known.includes(String(code))) throw new AddressOutcomeUnknown();
  }
  if (error || !response.ok) {
    throw toApiRequestError(
      response.status,
      error,
      "No pudimos guardar la dirección",
      "Revisa los datos e inténtalo otra vez.",
    );
  }
  const parsed = z.object({ addressId: z.string().min(1) }).safeParse(data);
  if (!parsed.success) {
    throw new AddressOutcomeUnknown();
  }
  return parsed.data;
}

export async function resolveAddress(key: string) {
  const { data, error, response } = await apiClient.POST("/api/v1/me/addresses/attempts/{key}/resolve", { params: { path: { key } } });
  if (!response.ok) throw toApiRequestError(response.status, error, "Aún no pudimos consultar la dirección", "Comprueba tu conexión. El resultado sigue pendiente.");
  const parsed = z.discriminatedUnion("state", [
    z.object({ state: z.literal("PENDING"), addressId: z.null() }),
    z.object({ state: z.literal("NOT_CREATED"), addressId: z.null() }),
    z.object({ state: z.literal("CREATED"), addressId: z.string().min(1) }),
  ]).safeParse(data);
  if (!parsed.success) throw new AddressOutcomeUnknown();
  return parsed.data;
}

export async function updateAddress(addressId: string, body: AddressUpdateRequest): Promise<void> {
  const { error, response } = await apiClient.PUT("/api/v1/me/addresses/{addressId}", {
    params: { path: { addressId: addressId as unknown as number } }, body,
  });
  if (!response.ok) throw toApiRequestError(response.status, error, "No pudimos guardar la dirección", "Revisa los datos e inténtalo otra vez.");
}

export async function deleteAddress(addressId: string): Promise<void> {
  const { error, response } = await apiClient.DELETE("/api/v1/me/addresses/{addressId}", {
    params: { path: { addressId: addressId as unknown as number } },
  });
  if (!response.ok) throw toApiRequestError(response.status, error, "No pudimos eliminar la dirección", "Consulta la lista actual antes de volver a intentarlo.");
}

export async function setPrimaryAddress(addressId: string): Promise<void> {
  const { error, response } = await apiClient.PUT("/api/v1/me/addresses/{addressId}/primary", {
    params: { path: { addressId: addressId as unknown as number } },
  });
  if (!response.ok) throw toApiRequestError(response.status, error, "No pudimos cambiar la dirección principal", "Consulta la lista actual antes de volver a intentarlo.");
}
