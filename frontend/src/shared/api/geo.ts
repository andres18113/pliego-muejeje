import { z } from "zod";
import { apiClient } from "./client";
import { toApiRequestError } from "./errors";

/** Ecuador's provinces and their localities (INEC, ADR 0044): reference data the server owns and caches for a day. */
const provinceSchema = z.object({ id: z.string(), code: z.string(), name: z.string() });
const citySchema = z.object({
  id: z.string(),
  code: z.string(),
  name: z.string(),
  kind: z.enum(["CABECERA_CANTONAL", "PARROQUIA_RURAL"]),
  cantonName: z.string(),
  /** Common names the INEC records for the same place ("Bucay"); they find it, they never add a second row. */
  aliases: z.array(z.string()).optional().default([]),
});
export type Province = z.infer<typeof provinceSchema>;
export type City = z.infer<typeof citySchema>;

export const provincesQueryKey = ["geo-provinces"] as const;
export const citiesQueryKey = (provinceId: string) => ["geo-cities", provinceId] as const;
/** The catalog changes only with a migration: one read per session is enough. */
export const geoStaleTime = 24 * 60 * 60 * 1000;

export async function getProvinces(signal?: AbortSignal): Promise<Province[]> {
  const { data, error, response } = await apiClient.GET("/api/v1/geo/provinces", { signal });
  if (!response.ok) throw toApiRequestError(response.status, error, "No pudimos consultar las provincias", "Comprueba tu conexión e inténtalo otra vez.");
  const parsed = z.array(provinceSchema).safeParse(data);
  if (!parsed.success) throw toApiRequestError(502, {}, "No pudimos consultar las provincias", "La respuesta del servidor está incompleta.");
  return parsed.data;
}

export async function getCities(provinceId: string, signal?: AbortSignal): Promise<City[]> {
  const { data, error, response } = await apiClient.GET("/api/v1/geo/provinces/{provinceId}/cities", {
    params: { path: { provinceId } }, signal,
  });
  if (!response.ok) throw toApiRequestError(response.status, error, "No pudimos consultar las ciudades", "Comprueba tu conexión e inténtalo otra vez.");
  const parsed = z.array(citySchema).safeParse(data);
  if (!parsed.success) throw toApiRequestError(502, {}, "No pudimos consultar las ciudades", "La respuesta del servidor está incompleta.");
  return parsed.data;
}
