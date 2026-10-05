import { ApiRequestError } from "./errors";

/** A failed refresh is exposed as an error; stale privileged data is not silently displayed. */
export type ReadViewState<T> = { status: "loading" } | { status: "error"; title: string; detail: string; httpStatus?: number } | { status: "empty" } | { status: "ready"; data: T };
export function toReadViewState<T>(query: { isPending: boolean; isError: boolean; error: unknown; data: T | undefined }, empty: (data: T) => boolean): ReadViewState<T> {
  if (query.isError) return { status: "error", title: query.error instanceof ApiRequestError ? query.error.title : "No pudimos consultar los datos", detail: query.error instanceof Error ? query.error.message : "Inténtalo otra vez.", ...(query.error instanceof ApiRequestError ? { httpStatus: query.error.status } : {}) };
  if (query.isPending || query.data === undefined) return { status: "loading" };
  return empty(query.data) ? { status: "empty" } : { status: "ready", data: query.data };
}
