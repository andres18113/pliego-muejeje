import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { MotionConfig } from "motion/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { App } from "./app/App";
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

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      refetchOnWindowFocus: false,
    },
  },
});

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
