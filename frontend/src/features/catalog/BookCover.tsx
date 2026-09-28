import { useLayoutEffect, useRef, useState } from "react";

// Tracks decoded URL state for this SPA session; the browser owns the image bytes and HTTP cache.
const decodedCoverFits = new Map<string, "cover" | "contain">();
const CANONICAL_COVER_RATIO = 2 / 3;
const MAX_CROP_PER_EDGE = 0.04;

interface BookCoverProps {
  url: string | null;
  license: string | null;
  attribution: string | null;
  title: string;
  size?: "catalog" | "detail" | "compact";
  loading?: "eager" | "lazy";
}

export function BookCover({
  url,
  license,
  attribution,
  title,
  size = "catalog",
  loading = "lazy",
}: BookCoverProps) {
  const imageRef = useRef<HTMLImageElement>(null);
  const [decodedUrl, setDecodedUrl] = useState<string | null>(null);
  const [failedUrl, setFailedUrl] = useState<string | null>(null);

  const canShowCover = canDisplayCover(url) && failedUrl !== url;
  const isDecoded = url !== null && (decodedUrl === url || decodedCoverFits.has(url));
  const isLoading = canShowCover && !isDecoded;
  const imageFit = url ? decodedCoverFits.get(url) ?? "contain" : "contain";
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
      className={`book-cover book-cover--${size}${canShowCover ? "" : " book-cover--fallback"}`}
      aria-busy={isLoading}
    >
      <div className="cover-frame">
        {canShowCover ? (
          <>
            {isLoading && (
              <div className="cover-skeleton" data-testid="cover-skeleton" aria-hidden="true">
                <span className="cover-skeleton-shape cover-skeleton-top" />
                <span className="cover-skeleton-shape cover-skeleton-art" />
                <span className="cover-skeleton-shape cover-skeleton-bottom" />
              </div>
            )}
            <img
              key={url}
              ref={imageRef}
              className={`cover-image${isLoading ? " cover-image--loading" : ""}${imageFit === "cover" ? " cover-image--cover" : ""}`}
              src={url}
              alt={`Portada de ${title}`}
              loading={loading}
              decoding="async"
              referrerPolicy="no-referrer"
              onLoad={(event) => handleImageLoad(event.currentTarget)}
              onError={() => url && setFailedUrl(url)}
            />
          </>
        ) : (
          <div className="cover-fallback" role="img" aria-label={`Portada no disponible de ${title}`}>
            <svg viewBox="0 0 42 48" aria-hidden="true">
              <path d="M8 5.5h19.5A6.5 6.5 0 0 1 34 12v30.5H14.5A6.5 6.5 0 0 0 8 49V5.5Z" />
              <path d="M8 5.5v36.6a6.7 6.7 0 0 1 6.5-5h19.4M14 12h13M14 18h13M14 24h9" />
            </svg>
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
