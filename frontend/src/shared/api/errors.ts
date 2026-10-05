import type { components } from "./generated";

export type ApiProblem = components["schemas"]["ProblemDetail"];

export type ApiFieldViolation = {
  readonly field: string;
  readonly message: string;
};

export class ApiRequestError extends Error {
  constructor(
    readonly status: number,
    readonly code: string | undefined,
    readonly title: string,
    readonly detail: string,
    readonly traceId?: string,
    readonly violations: readonly ApiFieldViolation[] = [],
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
    parseFieldViolations(value.violations),
  );
}

export function fieldErrorMessages(error: unknown, field: string): string | undefined {
  if (!(error instanceof ApiRequestError)) return undefined;

  const messages = error.violations
    .filter((violation) => violation.field === field)
    .map((violation) => violation.message);
  return [...new Set(messages)].join(" ") || undefined;
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

function parseFieldViolations(value: unknown): ApiFieldViolation[] {
  if (!Array.isArray(value)) return [];

  const violations: ApiFieldViolation[] = [];
  for (const item of value) {
    if (!isRecord(item)) continue;
    const field = asOptionalString(item.field);
    const message = asOptionalString(item.message);
    if (field && message) violations.push({ field, message });
  }
  return violations;
}
