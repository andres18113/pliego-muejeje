import { useQuery } from "@tanstack/react-query";
import { z } from "zod";
import { toApiRequestError } from "./errors";
import { apiClient } from "./client";

const countrySchema = z.array(z.object({ code: z.string().length(2), name: z.string().min(1) }));
export type CountryReference = z.infer<typeof countrySchema>[number];
const transferSchema = z.object({
  bank: z.string().min(1), beneficiary: z.string().min(1), accountType: z.string().min(1),
  accountNumber: z.string().min(1), identification: z.string().min(1),
});

async function getCountries(signal?: AbortSignal) {
  const { data, error, response } = await apiClient.GET("/api/v1/reference/countries", { signal });
  if (!response.ok) throw toApiRequestError(response.status, error, "No pudimos consultar los países", "Inténtalo otra vez.");
  const parsed = countrySchema.safeParse(data);
  if (!parsed.success) throw toApiRequestError(502, null, "No pudimos consultar estos datos", "La respuesta está incompleta.");
  return parsed.data;
}

async function getTransferDetails(signal?: AbortSignal) {
  const { data, error, response } = await apiClient.GET("/api/v1/reference/transfer-details", { signal });
  if (!response.ok) throw toApiRequestError(response.status, error, "No pudimos consultar los datos bancarios", "Inténtalo otra vez.");
  const parsed = transferSchema.safeParse(data);
  if (!parsed.success) throw toApiRequestError(502, null, "No pudimos consultar los datos bancarios", "La respuesta está incompleta.");
  return parsed.data;
}

export function useCountries() {
  return useQuery({ queryKey: ["reference-countries"], queryFn: ({ signal }) => getCountries(signal), staleTime: 24 * 60 * 60 * 1000 });
}

export function useTransferDetails(enabled = true) {
  return useQuery({ queryKey: ["reference-transfer-details"], queryFn: ({ signal }) => getTransferDetails(signal), enabled, staleTime: 60 * 60 * 1000 });
}
