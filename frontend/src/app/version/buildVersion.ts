/**
 * An open tab keeps the code it was loaded with. After a release, this compares the running build with the one the
 * server now publishes in /version.json (no-store) and reports a newer one — on start and whenever the tab comes back
 * (visible, back/forward cache, network), at most once a minute. It never reloads by itself, and it checks only the
 * site's own static file: never business data.
 */
export const runningBuildId: string | null = typeof __PLIEGO_BUILD_ID__ === "string" ? __PLIEGO_BUILD_ID__ : null;
export const versionCheckInterval = 60_000;
const buildIdPattern = /^[A-Za-z0-9._-]{1,64}$/;

/** The published build ID, or null when the file is missing, an HTML fallback, malformed or unreachable. */
export async function fetchPublishedBuildId(fetcher: typeof fetch = fetch): Promise<string | null> {
  try {
    const response = await fetcher(`/version.json?t=${Date.now()}`, { cache: "no-store", credentials: "omit", headers: { Accept: "application/json" } });
    if (!response.ok || !(response.headers.get("content-type") ?? "").includes("json")) return null;
    const body: unknown = await response.json();
    const id = body && typeof body === "object" ? (body as { buildId?: unknown }).buildId : null;
    return typeof id === "string" && buildIdPattern.test(id) ? id : null;
  } catch {
    return null;
  }
}

export type VersionEnvironment = {
  running: string | null;
  fetchPublished: () => Promise<string | null>;
  listen: (event: "visible" | "pageshow" | "online", listener: () => void) => () => void;
  now: () => number;
};

export function browserVersionEnvironment(): VersionEnvironment {
  return {
    running: runningBuildId,
    fetchPublished: () => fetchPublishedBuildId(),
    listen: (event, listener) => {
      if (event === "visible") {
        const onChange = () => { if (document.visibilityState === "visible") listener(); };
        document.addEventListener("visibilitychange", onChange);
        return () => document.removeEventListener("visibilitychange", onChange);
      }
      window.addEventListener(event, listener);
      return () => window.removeEventListener(event, listener);
    },
    now: () => Date.now(),
  };
}

/** Calls onNewer(id) once per newer published build. Returns a stop function. Inert without a running build ID. */
export function watchBuildVersion(env: VersionEnvironment, onNewer: (buildId: string) => void) {
  if (!env.running) return () => undefined;
  let stopped = false, checkedAt = -Infinity, reported: string | null = null, inFlight = false;
  const check = async () => {
    const now = env.now();
    if (stopped || inFlight || now - checkedAt < versionCheckInterval) return;
    checkedAt = now;
    inFlight = true;
    const published = await env.fetchPublished();
    inFlight = false;
    if (stopped || !published || published === env.running || published === reported) return;
    reported = published;
    onNewer(published);
  };
  const removers = (["visible", "pageshow", "online"] as const).map(event => env.listen(event, () => void check()));
  void check();
  return () => { stopped = true; for (const remove of removers) remove(); };
}
