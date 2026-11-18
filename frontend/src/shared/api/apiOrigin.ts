/**
 * The API origin from VITE_API_BASE_URL, which may name the origin (`https://api.pliegolibros.com`, as production
 * builds do) or the versioned base (`/api/v1`, the local default; `https://host/api/v1/`). Every request path,
 * including the realtime stream's, is built from this one value: never append a path to the raw variable.
 * Dependency-free so the build (index.html's early offer clock) derives the very same origin.
 */
export function apiOriginFrom(configured: string | undefined) {
  return (configured || "/api/v1").replace(/\/+$/, "").replace(/\/api\/v1$/, "");
}
