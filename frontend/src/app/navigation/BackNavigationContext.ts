import { createContext } from "react";
export interface BackNavigation {
  canGoBack: boolean;
  fallback: string;
  goBack: () => void;
}
export const BackNavigationContext = createContext<BackNavigation | null>(null);
