import createClient from "openapi-fetch";
import type { Middleware } from "openapi-fetch";
import type { paths } from "./generated";
import { SessionRenewedError } from "./errors";

const configuredBaseUrl = (import.meta.env.VITE_API_BASE_URL || "/api/v1").replace(/\/$/, "");
const apiOrigin = configuredBaseUrl.replace(/\/api\/v1$/, "");

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
