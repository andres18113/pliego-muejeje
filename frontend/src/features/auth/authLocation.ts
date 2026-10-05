import { safeCatalogReturnHref } from "@/features/catalog/catalogUrl";

export function authLocation(pathname: string, from: string) {
  return { pathname, search: new URLSearchParams({ from }).toString() };
}

const customerIntentPath = /^\/(?:account(?:\/addresses)?|favorites|cart|checkout|(?:orders|biblioteca)(?:\/[1-9][0-9]{0,18})?)\/?$/;

/**
 * Validates the post-sign-in destination: catalog routes plus the CUSTOMER purchase
 * surfaces. Anything else, including other origins, falls back to the catalog.
 */
export function safeAuthReturnHref(candidate: string | null | undefined) {
  if (candidate && candidate.startsWith("/") && !candidate.startsWith("//") && !candidate.includes("\\")) {
    try {
      const parsed = new URL(candidate, window.location.origin);
      if (parsed.origin === window.location.origin && customerIntentPath.test(parsed.pathname)) {
        return `${parsed.pathname}${parsed.search}${parsed.hash}`;
      }
    } catch {
      return "/catalog";
    }
  }
  return safeCatalogReturnHref(candidate);
}
