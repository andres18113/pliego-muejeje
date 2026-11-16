/**
 * Responsive cover candidates (pipeline recipe `responsive-v1`, scripts/generate_responsive_images.py).
 *
 * Every published edition cover is an immutable 720×1080 WebP at
 *   https://covers.pliegolibros.com/covers/editions/v2/<SKU>-<hash12>.webp
 * and the pipeline writes the same image at fixed widths, never re-cropped, as
 *   <VITE_COVER_VARIANTS_BASE><SKU>-<hash12>-w<width>.webp
 * The base is set at build time only once those objects are published; unset, covers keep their single URL.
 * Any other cover URL (another host or path, a query, credentials) keeps its single URL as well.
 */
export type CoverSize = "catalog" | "detail" | "compact" | "card";

export const coverVariantWidths = [160, 240, 360, 480] as const;
const ORIGINAL_WIDTH = 720;
const publishedCover = /^https:\/\/covers\.pliegolibros\.com\/covers\/editions\/v2\/(PLG-BK-[0-9]{6,}-[0-9a-f]{12})\.webp$/;
const configuredBase: string | undefined = import.meta.env.VITE_COVER_VARIANTS_BASE;

/** `srcset` for a published cover: the fixed-width variants plus the original as the largest candidate. */
export function coverSrcSet(url: string | null, base: string | undefined = configuredBase): string | undefined {
  if (!url || !base || !base.endsWith("/")) return undefined;
  const match = publishedCover.exec(url);
  if (!match) return undefined;
  return [...coverVariantWidths.map(width => `${base}${match[1]}-w${width}.webp ${width}w`), `${url} ${ORIGINAL_WIDTH}w`].join(", ");
}

/**
 * The jacket's rendered width per size, measured on Home, the catalog, Ofertas and an edition (320–1920px wide):
 * cards at most 96px under 480px, 140px under 1280px and 200px beyond; detail 172–220px under 1024px and 340px from
 * there; compact thumbnails at most 80px.
 */
const measuredSizes: Record<CoverSize, string> = {
  compact: "80px",
  card: "(max-width: 479px) 96px, (max-width: 1279px) 140px, 200px",
  catalog: "(max-width: 479px) 96px, (max-width: 1279px) 140px, 200px",
  detail: "(max-width: 1023px) 220px, 340px",
};

/**
 * `sizes` for a cover. Only a lazy image may start with `auto` (the browser then uses its laid-out width, with the
 * measured bounds as the fallback where `auto` is unsupported): on an eager image Chrome rejects the whole value and
 * falls back to 100vw — the full 720px original for a 100px card.
 */
export function coverSizes(size: CoverSize, loading: "eager" | "lazy") {
  return loading === "lazy" && (size === "card" || size === "catalog") ? `auto, ${measuredSizes[size]}` : measuredSizes[size];
}
