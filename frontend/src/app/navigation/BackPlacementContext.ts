import { createContext, useContext, useLayoutEffect } from "react";

/**
 * Where the one back arrow of a view is drawn. By default it leads the site header; a page whose composition
 * places it under the header (the edition page, as product pages do) claims it so the header never shows a
 * second arrow beside the wordmark.
 */
export interface BackPlacement {
  inPage: boolean;
  claim: () => () => void;
}
export const BackPlacementContext = createContext<BackPlacement | null>(null);

/** Called by a page that renders its own BackButton under the header. Claimed before paint, so nothing flickers. */
export function useInPageBack() {
  const claim = useContext(BackPlacementContext)?.claim;
  useLayoutEffect(() => claim?.(), [claim]);
}
