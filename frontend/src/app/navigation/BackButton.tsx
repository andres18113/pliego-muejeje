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
 * The edition page's back arrow, drawn under the header on the content's edge before its trail. It returns to
 * wherever the reader came from (a filtered shelf, search, Ofertas), which no single named parent could promise.
 * The headers never draw an arrow beside the wordmark. `headerScrollsAway` is the edition page's claim.
 */
export function InPageBackButton({ headerScrollsAway = false }: { headerScrollsAway?: boolean }) {
  useHeaderScrollsAway(headerScrollsAway);
  return <span className={classes.inPage}><BackButton /></span>;
}

