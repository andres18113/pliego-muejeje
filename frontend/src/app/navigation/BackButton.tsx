import { MaterialSymbol } from "@/shared/ui/MaterialSymbol";
import { useBackNavigation } from "./useBackNavigation";
import classes from "./BackNavigation.module.css";

export function BackButton({ closeLayer }: { closeLayer?: () => void }) {
  const { canGoBack, goBack } = useBackNavigation();
  if (!canGoBack && !closeLayer) return null;
  return <button type="button" className={classes.back} aria-label="Volver atrás" onClick={closeLayer ?? goBack}>
    <MaterialSymbol name="arrow_back" aria-hidden="true" size={22} />
  </button>;
}
