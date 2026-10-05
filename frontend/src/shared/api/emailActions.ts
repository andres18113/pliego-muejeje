import { apiClient } from "./client";
import { toApiRequestError } from "./errors";

/** A lost response can follow a committed command. Tokens must not be retried automatically. */
export class EmailActionOutcomeUnknown extends Error {
  constructor() {
    super("No pudimos confirmar el resultado. Revisa tu correo o intenta iniciar sesión antes de solicitar otro enlace.");
    this.name = "EmailActionOutcomeUnknown";
  }
}

export async function requestEmailAction(purpose: "verification" | "recovery", email: string): Promise<string> {
  const path = purpose === "verification" ? "/api/v1/auth/resend-verification" : "/api/v1/auth/forgot-password";
  const { data, error, response } = await apiClient.POST(path, { body: { email } })
    .catch(() => { throw new EmailActionOutcomeUnknown(); });
  if (response.status >= 500) throw new EmailActionOutcomeUnknown();
  if (!response.ok) throw toApiRequestError(response.status, error, "No pudimos solicitar el correo", "Comprueba tus datos e inténtalo otra vez.");
  if (response.status !== 202 || typeof data?.message !== "string" || !data.message.trim()) throw new EmailActionOutcomeUnknown();
  return data.message;
}

export async function verifyEmail(token: string): Promise<void> {
  const result = await apiClient.POST("/api/v1/auth/verify-email", { body: { token } })
    .catch(() => { throw new EmailActionOutcomeUnknown(); });
  requireConsumed(result.response, result.error);
}

export async function resetPassword(token: string, password: string): Promise<void> {
  const result = await apiClient.POST("/api/v1/auth/reset-password", { body: { token, password } })
    .catch(() => { throw new EmailActionOutcomeUnknown(); });
  requireConsumed(result.response, result.error);
}

function requireConsumed(response: Response, error: unknown) {
  if (response.status >= 500 || (response.ok && response.status !== 204)) throw new EmailActionOutcomeUnknown();
  if (!response.ok) throw toApiRequestError(response.status, error, "No pudimos completar la acción", "El enlace no es válido, venció o ya se utilizó. Solicita otro enlace.");
}
