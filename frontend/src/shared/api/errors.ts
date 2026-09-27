import type { components } from "./generated";

export type ApiProblem = components["schemas"]["ProblemDetail"];

export class ApiRequestError extends Error {
  constructor(
    readonly status: number,
    readonly code: string | undefined,
    readonly title: string,
    readonly detail: string,
    readonly traceId?: string,
  ) {
    super(detail);
    this.name = "ApiRequestError";
  }
}

export function toApiRequestError(
  status: number,
  problem: unknown,
  fallbackTitle: string,
  fallbackDetail: string,
) {
  const value = isRecord(problem) ? problem : {};
  return new ApiRequestError(
    status,
    asOptionalString(value.code),
    asOptionalString(value.title) || fallbackTitle,
    asOptionalString(value.detail) || fallbackDetail,
    asOptionalString(value.traceId),
  );
}

export function describeApiError(
  error: unknown,
  fallbackTitle = "No pudimos completar la solicitud",
  fallbackDetail = "Comprueba tu conexión e inténtalo otra vez.",
) {
  if (error instanceof ApiRequestError) {
    return {
      title: error.title,
      detail: error.detail,
      code: error.code,
      status: error.status,
    };
  }

  return { title: fallbackTitle, detail: fallbackDetail, code: undefined, status: undefined };
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function asOptionalString(value: unknown) {
  return typeof value === "string" && value.trim() ? value : undefined;
}
