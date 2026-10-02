import { MaterialSymbol } from "@/shared/ui/MaterialSymbol";
import { useLayoutEffect, useRef, useState } from "react";
import { useDelayedPending } from "@/shared/hooks/useDelayedPending";
import { Skeleton } from "@mantine/core";
import classes from "./BookCover.module.css";

// Tracks decoded URL state for this SPA session; the browser owns the image bytes and HTTP cache.
const decodedCoverFits = new Map<string, "cover" | "contain">();
const CANONICAL_COVER_RATIO = 2 / 3;
const MAX_CROP_PER_EDGE = 0.04;

interface BookCoverProps {
  url: string | null;
  license: string | null;
  attribution: string | null;
  title: string;
  size?: "catalog" | "detail" | "compact" | "card";
  loading?: "eager" | "lazy";
  decorative?: boolean;
}

export function BookCover({
  url,
  license,
  attribution,
  title,
  size = "catalog",
  loading = "lazy",
  decorative = false,
}: BookCoverProps) {
  const imageRef = useRef<HTMLImageElement>(null);
  const [decodedUrl, setDecodedUrl] = useState<string | null>(null);
  const [failedUrl, setFailedUrl] = useState<string | null>(null);

  const canShowCover = canDisplayCover(url) && failedUrl !== url;
  const isDecoded = url !== null && (decodedUrl === url || decodedCoverFits.has(url));
  const isLoading = canShowCover && !isDecoded;
  const showSkeleton = useDelayedPending(isLoading, 120);
  const imageFit = size === "card" ? "contain" : url ? decodedCoverFits.get(url) ?? "contain" : "contain";
  const credit = [attribution, license ? `Licencia: ${license}` : ""].filter(Boolean).join(" · ");

  useLayoutEffect(() => {
    if (!url || !canShowCover || decodedCoverFits.has(url)) return;
    const image = imageRef.current;
    if (image?.complete && image.naturalWidth > 0) {
      decodedCoverFits.set(url, fitForCover(image));
      setDecodedUrl(url);
    }
  }, [url, canShowCover]);

  function finishImageLoad(image: HTMLImageElement) {
    if (!url) return;
    if (image.naturalWidth === 0) {
      setFailedUrl(url);
      return;
    }
    decodedCoverFits.set(url, fitForCover(image));
    setDecodedUrl(url);
  }

  function handleImageLoad(image: HTMLImageElement) {
    if (typeof image.decode !== "function") {
      finishImageLoad(image);
      return;
    }
    void image.decode().then(
      () => finishImageLoad(image),
      () => finishImageLoad(image),
    );
  }

  return (
    <figure
      className={`book-cover book-cover--${size}${canShowCover ? "" : " book-cover--fallback"}${size === "card" ? ` ${classes.card}` : ""}`}
      aria-busy={isLoading}
      data-bookcard-cover={size === "card" ? "" : undefined}
    >
      <div className="cover-frame">
        {canShowCover ? (
          <>
            {showSkeleton && (size === "card" ? <Skeleton className={classes.skeleton} height="100%" animate={false} aria-hidden="true" data-testid="cover-skeleton" /> : (
              <div className="cover-skeleton" data-testid="cover-skeleton" aria-hidden="true">
                <span className="cover-skeleton-shape cover-skeleton-top" />
                <span className="cover-skeleton-shape cover-skeleton-art" />
                <span className="cover-skeleton-shape cover-skeleton-bottom" />
              </div>
            ))}
            <img
              key={url}
              ref={imageRef}
              className={`cover-image${isLoading ? " cover-image--loading" : ""}${imageFit === "cover" ? " cover-image--cover" : ""}`}
              src={url}
              alt={decorative ? "" : `Portada de ${title}`}
              loading={loading}
              decoding="async"
              referrerPolicy="no-referrer"
              onLoad={(event) => handleImageLoad(event.currentTarget)}
              onError={() => url && setFailedUrl(url)}
            />
          </>
        ) : (
          <div className="cover-fallback" role={decorative ? undefined : "img"} aria-label={decorative ? undefined : `Portada no disponible de ${title}`} data-bookcard-fallback={size === "card" ? "" : undefined}>
            <MaterialSymbol name="menu_book" size={size === "card" ? 28 : 37} />
            <span>Portada no disponible</span>
          </div>
        )}
      </div>
      {canShowCover && credit && <figcaption className="cover-credit">{credit}</figcaption>}
    </figure>
  );
}

function fitForCover(image: HTMLImageElement): "cover" | "contain" {
  const ratio = image.naturalWidth / image.naturalHeight;
  if (!Number.isFinite(ratio) || ratio <= 0) return "contain";

  const retainedRatio = ratio < CANONICAL_COVER_RATIO
    ? ratio / CANONICAL_COVER_RATIO
    : CANONICAL_COVER_RATIO / ratio;
  const cropPerEdge = (1 - retainedRatio) / 2;
  return cropPerEdge <= MAX_CROP_PER_EDGE ? "cover" : "contain";
}

function canDisplayCover(url: string | null): url is string {
  if (!url) return false;
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  return parsed.protocol === "https:" && !parsed.username && !parsed.password
    && !isIpLiteral(parsed.hostname) && !isLocalHostname(parsed.hostname);
}

function isLocalHostname(hostname: string): boolean {
  const host = hostname.toLowerCase();
  return host === "localhost" || host.endsWith(".localhost")
    || host.endsWith(".local") || host.endsWith(".internal");
}

function isIpLiteral(hostname: string): boolean {
  const host = hostname.toLowerCase();
  if (host.startsWith("[") && host.endsWith("]")) return true;
  if (!/^[0-9.]+$/.test(host)) return false;
  const octets = host.split(".").map(Number);
  if (octets.length !== 4 || octets.some((octet) => !Number.isInteger(octet) || octet < 0 || octet > 255)) {
    return true;
  }
  return octets[0] === 0 || octets[0] === 10 || octets[0] === 127
    || (octets[0] === 169 && octets[1] === 254)
    || (octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31)
    || (octets[0] === 192 && octets[1] === 168)
    || octets[0] >= 224;
}
