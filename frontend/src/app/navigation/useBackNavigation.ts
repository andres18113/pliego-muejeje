import { useContext } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { BackNavigationContext } from "./BackNavigationContext";
import { backFallback } from "./BackNavigationHistory";

export function useBackNavigation() {
  const context = useContext(BackNavigationContext);
  const location = useLocation();
  const navigate = useNavigate();
  // Isolated components/error harnesses have no proven history: never use a browser delta.
  const fallback = backFallback(location.pathname, null);
  return context ?? { canGoBack: location.pathname !== fallback, fallback, goBack: () => { void navigate(fallback, { replace: true }); } };
}
