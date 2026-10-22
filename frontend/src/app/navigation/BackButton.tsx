import { MaterialSymbol } from "@/shared/ui/MaterialSymbol";
import { useBackNavigation } from "./useBackNavigation";
import { useInPageBack } from "./BackPlacementContext";
import classes from "./BackNavigation.module.css";

export function BackButton({ closeLayer }: { closeLayer?: () => void }) {
  const { canGoBack, goBack } = useBackNavigation();
  if (!canGoBack && !closeLayer) return null;
  return <button type="button" className={classes.back} aria-label="Volver atrás" onClick={closeLayer ?? goBack}>
    <MaterialSymbol name="arrow_back" aria-hidden="true" size={22} />
  </button>;
}

/**
 * The view's back arrow drawn under the header, on the content's edge (product pages). While mounted, the
 * header leaves its own slot empty, so there is never a second arrow and the wordmark stands alone.
 */
export function InPageBackButton() {
  useInPageBack();
  return <span className={classes.inPage}><BackButton /></span>;
}
