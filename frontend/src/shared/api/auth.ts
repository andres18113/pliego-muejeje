import type { components } from "./generated";
import { apiClient } from "./client";
import { toApiRequestError } from "./errors";

export type LoginResponse = components["schemas"]["LoginResponse"];
export type RegisterRequest = components["schemas"]["RegisterRequest"];

let refreshInFlight: Promise<Required<LoginResponse> | null> | null = null;

export async function login(body: components["schemas"]["LoginRequest"]) {
  const { data, error, response } = await apiClient.POST("/api/v1/auth/login", { body });
  if (error) {
    throw toApiRequestError(response.status, error, "No se pudo iniciar sesión", "Revisa tus datos e inténtalo otra vez.");
  }
  return requireLoginResponse(data, "No se pudo iniciar sesión");
}

export async function refreshSession() {
  if (refreshInFlight) return refreshInFlight;
  refreshInFlight = withAuthSessionLock(async () => {
    const { data, error, response } = await apiClient.POST("/api/v1/auth/refresh", {
      params: { header: { "X-PLIEGO-SESSION-REQUEST": "1" } },
    });
    if (response.status === 204) return null;
    if (error) {
      throw toApiRequestError(response.status, error, "No se pudo restaurar la sesión", "Comprueba tu conexión e inténtalo otra vez.");
    }
    return requireLoginResponse(data, "No se pudo restaurar la sesión");
  }).finally(() => {
    refreshInFlight = null;
  });
  return refreshInFlight;
}

export async function logoutSession() {
  await withAuthSessionLock(async () => {
    const { error, response } = await apiClient.POST("/api/v1/auth/logout", {
      params: { header: { "X-PLIEGO-SESSION-REQUEST": "1" } },
    });
    if (error || !response.ok) {
      throw toApiRequestError(response.status, error, "No se pudo cerrar sesión", "Comprueba tu conexión e inténtalo otra vez.");
    }
  });
}

export async function register(body: RegisterRequest) {
  const { data, error, response } = await apiClient.POST("/api/v1/auth/register", { body });
  if (error) {
    throw toApiRequestError(response.status, error, "No pudimos crear tu cuenta", "Revisa tus datos e inténtalo otra vez.");
  }
  if (!data?.customerId || data.state !== "PENDING_VERIFICATION") {
    throw toApiRequestError(502, {}, "No pudimos crear tu cuenta", "La respuesta del servidor está incompleta. Inténtalo otra vez.");
  }
  return data;
}

function requireLoginResponse(data: LoginResponse | undefined, title: string) {
  if (!data?.accessToken || !data.user?.role || !data.user.email || !data.user.userId || !data.expiresInSeconds) {
    throw toApiRequestError(502, {}, title, "La respuesta del servidor está incompleta. Inténtalo otra vez.");
  }
  return data as Required<LoginResponse>;
}

async function withAuthSessionLock<T>(operation: () => Promise<T>): Promise<T> {
  if (typeof navigator === "undefined" || !navigator.locks) return operation();
  return navigator.locks.request("pliego-auth-session", { mode: "exclusive" }, operation);
}
