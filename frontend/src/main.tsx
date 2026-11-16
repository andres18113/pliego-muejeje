import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { MotionConfig } from "motion/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { App } from "./app/App";
import { primeOfferRefreshClock } from "./app/realtime/offerRefresh";
import { prefetchInitialPublicReads } from "./app/initialPublicReads";
import { PliegoThemeProvider } from "./theme/PliegoThemeProvider";
import "@fontsource-variable/roboto-flex/wght.css";
import "@fontsource-variable/bricolage-grotesque/wght.css";
import "@mantine/core/styles.css";
import "./styles.css";
import "./storefront.css";

const root = document.getElementById("root");

if (!root) {
  throw new Error("No se encontró el contenedor principal de PLIEGO.");
}

// Ask for the offer refresh clock before any price read starts (ADR 0058).
primeOfferRefreshClock();

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      refetchOnWindowFocus: false,
    },
  },
});

// The opening page's public reads follow the clock instead of waiting for its code and the session restore.
void prefetchInitialPublicReads(queryClient);

createRoot(root).render(
  <StrictMode>
    <PliegoThemeProvider>
      <QueryClientProvider client={queryClient}>
        <MotionConfig reducedMotion="user">
          <App />
        </MotionConfig>
      </QueryClientProvider>
    </PliegoThemeProvider>
  </StrictMode>,
);
