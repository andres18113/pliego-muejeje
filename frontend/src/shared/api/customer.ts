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

/** Address creation is a non-idempotent POST; callers must re-read addresses after an unknown outcome. */
export async function createAddress(body: AddressRequest) {
  const { data, error, response } = await apiClient.POST("/api/v1/me/addresses", { body });
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
    throw toApiRequestError(502, {}, "No pudimos confirmar la dirección", "Consulta tus direcciones antes de volver a guardarla.");
  }
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
