import { safeAuthReturnHref } from "@/features/auth/authLocation";

const privatePath = /^\/(?:account|favorites|cart|checkout|orders|biblioteca)(?:\/|$)/;
const ephemeralPath = /^\/(?:sign-in|register|verificar-correo|reenviar-verificacion|recuperar-contrasena|restablecer-contrasena)\/?$/;
const sensitiveKey = /token|code|secret|password|credential|authorization/i;

/** Compare screens independently of trailing slashes; keep the original href for returns. */
export function canonicalBackPath(href: string): string {
  return href.split(/[?#]/)[0].replace(/\/+$/, "") || "/";
}

/** Reuse the auth/catalog allowlist; email actions are never return destinations. */
export function safeBackHref(href: string, role: string | null, depth = 0): string | null {
  if (!href.startsWith("/") || href.startsWith("//") || /[\\\u0000-\u0020]/.test(href)) return null;
  try {
    const url = new URL(href, window.location.origin);
    const path = canonicalBackPath(url.pathname);
    if ([...url.searchParams.keys()].some(key => sensitiveKey.test(key)) || sensitiveKey.test(url.hash)) return null;
    const from = url.searchParams.get("from");
    if (from && (depth >= 3 || safeBackHref(from, role, depth + 1) === null)) return null;
    if (privatePath.test(path) && role !== "CUSTOMER") return null;
    if (/^\/admin(?:\/|$)/.test(path)) return role === "ADMIN" && !url.search && !url.hash ? href : null;
    if (/^\/ayuda(?:\/[a-z0-9-]+)?$/.test(path)) return href;
    const canonicalHref = `${path}${url.search}${url.hash}`;
    return safeAuthReturnHref(canonicalHref) === canonicalHref ? href : null;
  } catch { return null; }
}

export function backFallback(href: string, role: string | null): string {
  const path = canonicalBackPath(href);
  if (privatePath.test(path) && role !== "CUSTOMER") return "/";
  if (/^\/admin(?:\/|$)/.test(path)) return role === "ADMIN" ? "/admin" : "/";
  if (path === "/checkout") return "/cart";
  if (path === "/cart" || path.startsWith("/catalog/editions/")) return "/catalog";
  if (/^\/orders\/\d+\//.test(path)) return path.match(/^\/orders\/\d+/)![0];
  if (path.startsWith("/orders/")) return "/orders";
  if (path.startsWith("/account/addresses/")) return "/account/addresses";
  if (path === "/account/addresses" || path === "/account/identity") return "/account";
  if (path.startsWith("/biblioteca/")) return "/biblioteca";
  if (path.startsWith("/ayuda/")) return "/ayuda";
  return "/";
}

type Visit = { key: string; href: string | null; path: string };
/** Memory only: no tokens, no persistent history across reloads or authorities. */
export class BackNavigationHistory {
  private entries: Visit[] = [];
  private index = -1;
  private authority = "";
  private retired = new Set<string>();
  private consumedAuth = new Set<string>();

  observe(visit: { key: string; href: string; purchased?: boolean }, action: string, authority: string) {
    const previous = this.entries[this.index];
    const nextPath = canonicalBackPath(visit.href);
    // Establishing a session must leave the active auth view alive until its redirect completes.
    if (previous && ephemeralPath.test(previous.path) && (authority !== this.authority || (previous.key !== visit.key && !ephemeralPath.test(nextPath)))) {
      this.entries.forEach(entry => { if (ephemeralPath.test(entry.path) && entry.key !== visit.key) this.consumedAuth.add(entry.key); });
    }
    if (authority !== this.authority) {
      this.entries = []; this.index = -1; this.retired.clear(); this.authority = authority;
    }
    const path = nextPath;
    const role = authority.startsWith("ADMIN:") ? "ADMIN" : authority.startsWith("CUSTOMER:") ? "CUSTOMER" : null;
    const href = safeBackHref(visit.href, role);
    const entry: Visit = { key: visit.key, href, path: href || ephemeralPath.test(path) ? path : "" };
    if (visit.purchased && /^\/orders\/[1-9][0-9]*\/?$/.test(path)) {
      this.entries.forEach(previous => { if (previous.path === "/checkout") this.retired.add(previous.key); });
    }
    const known = this.entries.findIndex(item => item.key === visit.key);
    if (known >= 0) { this.index = known; return; }
    if (action === "POP") { this.entries = [entry]; this.index = 0; return; }
    this.entries = this.entries.slice(0, this.index + 1);
    if (action === "REPLACE" && this.index >= 0) this.entries[this.index] = entry;
    else { this.entries.push(entry); this.index++; }
  }

  previous(authority: string): { href: string; delta: number } | null {
    if (authority !== this.authority) return null;
    const current = this.entries[this.index];
    for (let i = this.index - 1; i >= 0; i--) {
      const entry = this.entries[i];
      if (!entry.href || this.isRetired(entry.key)) continue;
      // Queries and hashes within one screen form one visit for the global arrow.
      if (entry.path === current?.path) continue;
      return { href: entry.href, delta: i - this.index };
    }
    return null;
  }
  isRetired(key: string) { return this.retired.has(key) || this.consumedAuth.has(key); }
}
