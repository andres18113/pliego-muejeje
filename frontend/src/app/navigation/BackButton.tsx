import type { ReactNode } from "react";
import { MaterialSymbol } from "@/shared/ui/MaterialSymbol";
import { useBackNavigation } from "./useBackNavigation";
import { useHeaderScrollsAway } from "./HeaderFlowContext";
import classes from "./BackNavigation.module.css";

export function BackButton() {
  const { canGoBack, goBack } = useBackNavigation();
  if (!canGoBack) return null;
  return <button type="button" className={classes.back} aria-label="Volver atrás" onClick={goBack}>
    <MaterialSymbol name="arrow_back" aria-hidden="true" size={22} />
  </button>;
}

/**
 * The view's back arrow, drawn under the header on the content's edge (as on product pages). The headers never
 * draw one beside the wordmark, so this is the view's one arrow. `headerScrollsAway` is the edition page's claim.
 */
export function InPageBackButton({ headerScrollsAway = false }: { headerScrollsAway?: boolean }) {
  useHeaderScrollsAway(headerScrollsAway);
  return <span className={classes.inPage}><BackButton /></span>;
}

/** A page's wayfinding row under the header: the back arrow, then an optional quiet trail on the same line. */
export function PageWayfinding({ className, children }: { className?: string; children?: ReactNode }) {
  return <div className={`${classes.wayfinding}${className ? ` ${className}` : ""}`}><InPageBackButton />{children}</div>;
}
