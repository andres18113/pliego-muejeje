import type { components } from "./generated";
import { apiClient } from "./client";
import { toApiRequestError } from "./errors";

export type LoginResponse = components["schemas"]["LoginResponse"];
export type RegisterRequest = components["schemas"]["RegisterRequest"];

export async function login(body: components["schemas"]["LoginRequest"]) {
  const { data, error, response } = await apiClient.POST("/api/v1/auth/login", { body });
  if (error) {
    throw toApiRequestError(response.status, error, "No se pudo iniciar sesión", "Revisa tus datos e inténtalo otra vez.");
  }
  if (!data?.accessToken || !data.user?.role || !data.user.email || !data.user.userId) {
    throw toApiRequestError(502, {}, "No se pudo iniciar sesión", "La respuesta del servidor está incompleta. Inténtalo otra vez.");
  }
  return data as Required<LoginResponse>;
}

export async function register(body: RegisterRequest) {
  const { data, error, response } = await apiClient.POST("/api/v1/auth/register", { body });
  if (error) {
    throw toApiRequestError(response.status, error, "No pudimos crear tu cuenta", "Revisa tus datos e inténtalo otra vez.");
  }
  if (!data?.customerId || data.state !== "ACTIVE") {
    throw toApiRequestError(502, {}, "No pudimos crear tu cuenta", "La respuesta del servidor está incompleta. Inténtalo otra vez.");
  }
  return data;
}
