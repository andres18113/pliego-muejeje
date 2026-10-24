import { createContext, useContext, useLayoutEffect } from "react";

/**
 * Whether the site header leaves with the scroll instead of staying and compacting. The edition page claims it
 * while its own wayfinding row (back arrow and trail) and context bar carry the view's orientation.
 */
export interface HeaderFlow {
  scrollsAway: boolean;
  claim: () => () => void;
}
export const HeaderFlowContext = createContext<HeaderFlow | null>(null);

/** Called by a page whose header leaves with the scroll. Claimed before paint, so nothing flickers. */
export function useHeaderScrollsAway(active: boolean) {
  const claim = useContext(HeaderFlowContext)?.claim;
  useLayoutEffect(() => active ? claim?.() : undefined, [active, claim]);
}
