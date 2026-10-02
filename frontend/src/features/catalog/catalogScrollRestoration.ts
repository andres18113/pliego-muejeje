import { useEffect, useLayoutEffect, useRef, type RefObject } from "react";
import { useLocation, useNavigationType } from "react-router-dom";

const returnPositionStorageKey = "pliego.catalog-return-position";

interface CatalogReturnPosition {
  locationKey: string;
  href: string;
  scrollY: number;
}

export function rememberCatalogReturnPosition(position: CatalogReturnPosition) {
  try {
    window.sessionStorage.setItem(returnPositionStorageKey, JSON.stringify(position));
  } catch {
    // React Router's scroll restoration remains available when session storage is unavailable.
  }
}

export function useCatalogReturnScrollRestoration(
  contentReady: boolean,
  focusTarget?: RefObject<HTMLElement | null>,
) {
  const location = useLocation();
  const navigationType = useNavigationType();
  const href = `${location.pathname}${location.search}${location.hash}`;
  const savedPosition = useRef<CatalogReturnPosition | null | undefined>(undefined);
  const previousOverflowAnchor = useRef<string | null>(null);

  useLayoutEffect(() => {
    if (navigationType !== "POP") return;

    if (savedPosition.current === undefined) {
      try {
        const serialized = window.sessionStorage.getItem(returnPositionStorageKey);
        savedPosition.current = serialized ? JSON.parse(serialized) as CatalogReturnPosition : null;
      } catch {
        savedPosition.current = null;
      }
    }

    const saved = savedPosition.current;
    if (!saved) return;
    if (saved.locationKey !== location.key || saved.href !== href || !Number.isFinite(saved.scrollY)) {
      try {
        window.sessionStorage.removeItem(returnPositionStorageKey);
      } catch {
        // Ignore storage cleanup failures.
      }
      savedPosition.current = null;
      return;
    }

    if (previousOverflowAnchor.current === null) {
      previousOverflowAnchor.current = document.documentElement.style.overflowAnchor;
      document.documentElement.style.overflowAnchor = "none";
    }

    if (contentReady) {
      window.scrollTo(0, Math.max(0, saved.scrollY));
      focusTarget?.current?.focus({ preventScroll: true });
      try {
        window.sessionStorage.removeItem(returnPositionStorageKey);
      } catch {
        // Ignore storage cleanup failures.
      }
      savedPosition.current = null;
      document.documentElement.style.overflowAnchor = previousOverflowAnchor.current;
      previousOverflowAnchor.current = null;
      return;
    }

    const frame = window.requestAnimationFrame(() => window.scrollTo(0, Math.max(0, saved.scrollY)));
    return () => window.cancelAnimationFrame(frame);
  }, [contentReady, focusTarget, href, location.key, navigationType]);

  useEffect(() => () => {
    if (previousOverflowAnchor.current === null) return;
    document.documentElement.style.overflowAnchor = previousOverflowAnchor.current;
    previousOverflowAnchor.current = null;
  }, []);
}
