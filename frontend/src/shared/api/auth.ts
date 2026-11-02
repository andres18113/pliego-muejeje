import type { components } from "./generated";
import { apiClient } from "./client";
import { LoginRateLimitedError, toApiRequestError } from "./errors";
import { registrationSessionSchema, registrationSessionStateSchema, type RegistrationSession } from "./registrationSession";

export type LoginResponse = components["schemas"]["LoginResponse"];
export type RegisterRequest = components["schemas"]["RegisterRequest"];

let refreshInFlight: Promise<Required<LoginResponse> | null> | null = null;

export async function login(body: components["schemas"]["LoginRequest"]) {
  return withAuthSessionLock(async (signal) => {
  const { data, error, response } = await apiClient.POST("/api/v1/auth/login", { body, signal });
  if (response.status === 429) {
    const base = toApiRequestError(429, error, "Demasiados intentos", "Espera unos minutos antes de volver a intentarlo.");
    throw new LoginRateLimitedError(base, retryAtFrom(response.headers.get("Retry-After")));
  }
  if (error) {
    throw toApiRequestError(response.status, error, "No se pudo iniciar sesión", "Revisa tus datos e inténtalo otra vez.");
  }
  return requireLoginResponse(data, "No se pudo iniciar sesión");
  });
}

export async function refreshSession() {
  if (refreshInFlight) return refreshInFlight;
  refreshInFlight = withAuthSessionLock(async (signal) => {
    const { data, error, response } = await apiClient.POST("/api/v1/auth/refresh", {
      params: { header: { "X-PLIEGO-SESSION-REQUEST": "1" } },
      signal,
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
  await withAuthSessionLock(async (signal) => {
    const { error, response } = await apiClient.POST("/api/v1/auth/logout", {
      params: { header: { "X-PLIEGO-SESSION-REQUEST": "1" } },
      signal,
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

/**
 * What the browser that registered learns when it asks to continue (ADR 0050). Only a verified account whose
 * continuation cookie belongs to this browser becomes a session; a pending answer never grants anything.
 */
export type RegistrationExchange =
  | { kind: "authenticated"; session: RegistrationSession }
  | { kind: "pending" }
  /** Another tab of this browser just exchanged it: the shared session cookie is restored with /refresh. */
  | { kind: "refresh" }
  /** No continuation (expired, used, another browser): ordinary sign-in from here. */
  | { kind: "ended" }
  /** The server's quota is spent for now (ADR 0050): the continuation is kept; nothing is asked before `retryAt`. */
  | { kind: "retry"; retryAt: number }
  /** Too soon after this browser's last check (any tab): nothing was asked; the next check may go at `nextAt`. */
  | { kind: "wait"; nextAt: number };

/**
 * One check per CHECK_GAP_MS for the whole browser, whatever asks (interval, focus, network, the button, any tab):
 * at most 300 an hour against the server's 600 per continuation (ADR 0050), so every tab together stays at half
 * the quota. Both pacing marks are timestamps shared through `localStorage` — never identity — and read inside the
 * cross-tab session lock, so two tabs cannot both pass the gate.
 */
export const CHECK_GAP_MS = 12_000;
const LAST_CHECK_KEY = "pliego.registrationLastCheckAt";
const RETRY_KEY = "pliego.registrationRetryAt";
const DEFAULT_RETRY_MS = 60_000;
const MAX_RETRY_MS = 60 * 60_000;
/** This tab's own marks, always kept: if storage can be read but not written (quota, blocked site data), the latest
 * of this tab's and the shared mark still decides, so a failed write can never reopen the gate. */
const inTab = new Map<string, number>();

function readMark(key: string) {
  let shared = 0;
  try { shared = Number(window.localStorage.getItem(key)) || 0; } catch { /* this tab's mark alone */ }
  return Math.max(shared, inTab.get(key) ?? 0);
}

function writeMark(key: string, value: number) {
  inTab.set(key, value);
  try { window.localStorage.setItem(key, String(value)); } catch { /* kept in this tab */ }
}

function forgetRetryAt() {
  inTab.delete(RETRY_KEY);
  try { window.localStorage.removeItem(RETRY_KEY); } catch { /* nothing stored */ }
}

/** The wait is over (signed in, or no continuation left): no pacing mark outlives it, in this tab or storage. */
export function forgetRegistrationPacing() {
  forgetRetryAt();
  inTab.delete(LAST_CHECK_KEY);
  try { window.localStorage.removeItem(LAST_CHECK_KEY); } catch { /* nothing stored */ }
}

/** The earliest moment this browser may ask again. Marks a moved clock could have made impossible are ignored. */
export function nextCheckAt(now = Date.now()) {
  const last = readMark(LAST_CHECK_KEY);
  const retryAt = readMark(RETRY_KEY);
  const paced = last > 0 && last <= now ? last + CHECK_GAP_MS : 0;
  const server = retryAt <= now + MAX_RETRY_MS ? retryAt : 0;
  return Math.max(paced, server);
}

/** Retry-After as delta-seconds or an HTTP date; missing or nonsense waits a minute; never longer than an hour. */
export function retryAtFrom(header: string | null, now = Date.now()) {
  const value = header?.trim() ?? "";
  let delay = /^\d+$/.test(value) ? Number(value) * 1000 : value ? Date.parse(value) - now : Number.NaN;
  if (!Number.isFinite(delay) || delay <= 0) delay = DEFAULT_RETRY_MS;
  return now + Math.min(delay, MAX_RETRY_MS);
}

/** `cancel` stops a check whose page went away while it waited for the lock: nothing is sent or counted then. */
export async function exchangeRegistrationSession(cancel?: AbortSignal): Promise<RegistrationExchange> {
  return withAuthSessionLock(async (signal) => {
    cancel?.throwIfAborted();
    // Every trigger (interval, focus, network, the button, any tab) passes here, inside the cross-tab lock.
    const now = Date.now();
    const retryAt = readMark(RETRY_KEY);
    if (now < retryAt && retryAt <= now + MAX_RETRY_MS) return { kind: "retry", retryAt } as const;
    const nextAt = nextCheckAt(now);
    if (now < nextAt) return { kind: "wait", nextAt } as const;
    // Counted before it is sent: the server counts attempts, answered or not.
    writeMark(LAST_CHECK_KEY, now);
    const { data, error, response } = await apiClient.POST("/api/v1/auth/registration-session", {
      params: { header: { "X-PLIEGO-SESSION-REQUEST": "1" } },
      signal,
    });
    if (response.status === 204) { forgetRegistrationPacing(); return { kind: "ended" } as const; }
    if (response.status === 202) {
      const state = registrationSessionStateSchema.safeParse(data);
      if (!state.success) throw toApiRequestError(502, {}, "No pudimos comprobar tu verificación", "La respuesta del servidor está incompleta.");
      if (state.data.state === "RETRY_LATER") {
        const next = retryAtFrom(response.headers.get("Retry-After"));
        writeMark(RETRY_KEY, next);
        return { kind: "retry", retryAt: next } as const;
      }
      forgetRetryAt();
      return state.data.state === "REFRESH_REQUIRED" ? { kind: "refresh" } as const : { kind: "pending" } as const;
    }
    if (error || response.status !== 200) {
      throw toApiRequestError(response.status, error, "No pudimos comprobar tu verificación", "Comprueba tu conexión e inténtalo otra vez.");
    }
    const session = registrationSessionSchema.safeParse(data);
    if (!session.success) throw toApiRequestError(502, {}, "No pudimos comprobar tu verificación", "La respuesta del servidor está incompleta.");
    forgetRegistrationPacing();
    return { kind: "authenticated", session: session.data } as const;
  });
}

function requireLoginResponse(data: LoginResponse | undefined, title: string) {
  if (!data?.accessToken || !data.user?.role || !data.user.email || !data.user.userId || !data.expiresInSeconds) {
    throw toApiRequestError(502, {}, title, "La respuesta del servidor está incompleta. Inténtalo otra vez.");
  }
  return data as Required<LoginResponse>;
}

/** Serializes every command that can create, rotate or end the session cookie, across this browser's tabs. */
export async function withAuthSessionLock<T>(operation: (signal: AbortSignal) => Promise<T>): Promise<T> {
  const controller = new AbortController();
  // Bound both cross-tab lock waiting and the request holding that lock.
  const deadline = setTimeout(() => controller.abort(new DOMException(
    "La operación de sesión tardó demasiado. Inténtalo otra vez.", "TimeoutError",
  )), 10_000);
  try {
    if (typeof navigator === "undefined" || !navigator.locks) return await operation(controller.signal);
    return await navigator.locks.request("pliego-auth-session", {
      mode: "exclusive", signal: controller.signal,
    }, () => operation(controller.signal));
  } finally {
    clearTimeout(deadline);
  }
}
