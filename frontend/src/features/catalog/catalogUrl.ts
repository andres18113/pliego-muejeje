import type { EditionSearch } from "@/shared/api/catalog";

export type CatalogCriteria = EditionSearch;

export function readCatalogCriteria(search: string): CatalogCriteria {
  const params = new URLSearchParams(search);
  return normalizeCatalogCriteria({
    query: params.get("q") || "",
    scope: params.get("scope") as CatalogCriteria["scope"],
    category: params.get("category") || "",
    minPrice: params.get("minPrice") || "",
    maxPrice: params.get("maxPrice") || "",
    language: params.get("language") || "",
    format: params.get("format") as CatalogCriteria["format"],
    sort: params.get("sort") as CatalogCriteria["sort"],
    page: parseInteger(params.get("page"), 0, 0, 2_147_483_647),
    pageSize: parseInteger(params.get("pageSize"), 20, 1, 50),
  });
}

export function writeCatalogCriteria(criteria: CatalogCriteria) {
  const normalized = normalizeCatalogCriteria(criteria);
  const params = new URLSearchParams();
  if (normalized.query) {
    params.set("q", normalized.query);
    if (normalized.scope !== "title") params.set("scope", normalized.scope);
  }
  if (normalized.category) params.set("category", normalized.category);
  if (normalized.minPrice) params.set("minPrice", normalized.minPrice);
  if (normalized.maxPrice) params.set("maxPrice", normalized.maxPrice);
  if (normalized.language) params.set("language", normalized.language);
  if (normalized.format) params.set("format", normalized.format);
  if (normalized.sort !== "TITLE_ASC") params.set("sort", normalized.sort);
  if (normalized.page > 0) params.set("page", String(normalized.page));
  if (normalized.pageSize !== 20) params.set("pageSize", String(normalized.pageSize));
  return params;
}

export function catalogHref(criteria: CatalogCriteria) {
  const query = writeCatalogCriteria(criteria).toString();
  return query ? `/?${query}` : "/";
}

export function hasActiveFilters(criteria: CatalogCriteria) {
  return Boolean(
    criteria.category ||
      criteria.minPrice ||
      criteria.maxPrice ||
      criteria.language ||
      criteria.format,
  );
}

export function hasAnyCriteria(criteria: CatalogCriteria) {
  return Boolean(criteria.query || hasActiveFilters(criteria));
}

export function safeExternalHttpHref(candidate: string | null | undefined) {
  if (!candidate || !/^https?:\/\//i.test(candidate)) return null;
  try {
    const parsed = new URL(candidate);
    if ((parsed.protocol !== "http:" && parsed.protocol !== "https:")
        || !parsed.hostname || parsed.username || parsed.password) {
      return null;
    }
    return parsed.href;
  } catch {
    return null;
  }
}

export function safeCatalogReturnHref(candidate: string | null | undefined) {
  if (!candidate || !candidate.startsWith("/") || candidate.startsWith("//") || candidate.includes("\\")) {
    return "/";
  }
  try {
    const parsed = new URL(candidate, window.location.origin);
    const isCatalogPath = parsed.pathname === "/" || /^\/catalog\/editions\/[1-9][0-9]*\/?$/.test(parsed.pathname);
    return parsed.origin === window.location.origin && isCatalogPath
      ? `${parsed.pathname}${parsed.search}${parsed.hash}`
      : "/";
  } catch {
    return "/";
  }
}

function normalizeCatalogCriteria(criteria: CatalogCriteria): CatalogCriteria {
  let scope: CatalogCriteria["scope"] =
    criteria.scope === "author" || criteria.scope === "isbn13" ? criteria.scope : "title";
  let query = typeof criteria.query === "string" ? criteria.query.trim() : "";
  if (scope === "isbn13") {
    const isbn = query.replace(/[\s-]/g, "");
    if (/^[0-9]{13}$/.test(isbn)) query = isbn;
    else {
      query = "";
      scope = "title";
    }
  }

  const rawCategory = typeof criteria.category === "string" ? criteria.category.trim().toLowerCase() : "";
  const category = rawCategory.length <= 140 && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(rawCategory)
    ? rawCategory
    : "";
  let minPrice = normalizePrice(criteria.minPrice);
  let maxPrice = normalizePrice(criteria.maxPrice);
  if (minPrice && maxPrice && priceInCents(minPrice) > priceInCents(maxPrice)) {
    [minPrice, maxPrice] = [maxPrice, minPrice];
  }

  const rawLanguage = typeof criteria.language === "string" ? criteria.language.trim().toLowerCase() : "";
  const language = /^[a-z]{2,3}$/.test(rawLanguage) ? rawLanguage : "";

  return {
    query,
    scope,
    category,
    minPrice,
    maxPrice,
    language,
    format: criteria.format === "PAPERBACK" || criteria.format === "HARDCOVER" ? criteria.format : "",
    sort: criteria.sort === "PRICE_ASC" || criteria.sort === "PRICE_DESC" ? criteria.sort : "TITLE_ASC",
    page: Number.isInteger(criteria.page) && criteria.page >= 0 && criteria.page <= 2_147_483_647
      ? criteria.page
      : 0,
    pageSize: Number.isInteger(criteria.pageSize) && criteria.pageSize >= 1 && criteria.pageSize <= 50
      ? criteria.pageSize
      : 20,
  };
}

function parseInteger(value: string | null, fallback: number, minimum: number, maximum: number) {
  if (!value || !/^\d+$/.test(value)) return fallback;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= minimum && parsed <= maximum ? parsed : fallback;
}

function normalizePrice(value: string) {
  if (typeof value !== "string" || value.trim() === "") return "";
  const match = /^(\d+)(?:\.(\d{1,2}))?$/.exec(value.trim());
  if (!match) return "";

  const whole = match[1].replace(/^0+(?=\d)/, "");
  const fraction = (match[2] || "").padEnd(2, "0");
  const cents = BigInt(whole) * 100n + BigInt(fraction);
  if (cents > BigInt(Number.MAX_SAFE_INTEGER)) return "";
  return `${whole}.${fraction}`;
}

function priceInCents(value: string) {
  const [whole, fraction] = value.split(".");
  return BigInt(whole) * 100n + BigInt(fraction);
}
