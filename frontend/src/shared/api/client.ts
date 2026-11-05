import createClient from "openapi-fetch";
import type { Middleware } from "openapi-fetch";
import type { paths } from "./generated";
import { SessionRenewedError } from "./errors";

/**
 * The API origin from VITE_API_BASE_URL, which may name the origin (`https://api.pliegolibros.com`, as production
 * builds do) or the versioned base (`/api/v1`, the local default; `https://host/api/v1/`). Every request path,
 * including the realtime stream's, is built from this one value: never append a path to the raw variable.
 */
export function apiOriginFrom(configured: string | undefined) {
  return (configured || "/api/v1").replace(/\/+$/, "").replace(/\/api\/v1$/, "");
}

const apiOrigin = apiOriginFrom(import.meta.env.VITE_API_BASE_URL);

/** An absolute API path (`/api/v1/...`) on the configured origin; same-origin when the origin is relative. */
export function apiUrl(path: `/api/v1/${string}`) {
  return `${apiOrigin}${path}`;
}

export const apiClient = createClient<paths>({
  baseUrl: apiOrigin || (typeof window !== "undefined" ? window.location.origin : "http://localhost"),
  fetch: (request: Request) => globalThis.fetch(new Request(request, { credentials: "include" })),
  headers: {
    Accept: "application/json, application/problem+json",
  },
});

let accessToken: string | null = null;

export function setApiAccessToken(token: string | null) {
  accessToken = token;
}

const bearerMiddleware: Middleware = {
  onRequest({ request, schemaPath }) {
    // Public auth commands authenticate using credentials or the HttpOnly session cookie.
    // An expired bearer must not prevent Spring from reaching those recovery endpoints.
    if (accessToken && !schemaPath.startsWith("/api/v1/auth/")) request.headers.set("Authorization", `Bearer ${accessToken}`);
    else request.headers.delete("Authorization");
    return request;
  },
  onResponse({ request, response }) {
    const sentBearer = request.headers.get("Authorization");
    if (response.status === 401 && sentBearer && sentBearer !== (accessToken ? `Bearer ${accessToken}` : null)) {
      throw new SessionRenewedError();
    }
    return response;
  },
};

apiClient.use(bearerMiddleware);
