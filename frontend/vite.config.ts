import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

/**
 * One identifier per build, stamped into the bundle and emitted as /version.json, so an open tab can tell that a
 * newer release is live (see app/version). PLIEGO_BUILD_ID pins it (e.g. the release ID); otherwise a UTC stamp.
 */
const buildId = process.env.PLIEGO_BUILD_ID || new Date().toISOString().replace(/\D/g, "").slice(0, 14);
const buildVersion: Plugin = {
  name: "pliego-build-version",
  apply: "build",
  generateBundle() {
    this.emitFile({ type: "asset", fileName: "version.json", source: `${JSON.stringify({ buildId })}\n` });
  },
};

export default defineConfig(({ command }) => ({
  cacheDir: process.env.PLIEGO_VITE_CACHE_DIR || "node_modules/.vite",
  // Only production builds carry an ID: under `vite serve` the version check stays inert (no fetch, no listeners).
  define: command === "build" ? { __PLIEGO_BUILD_ID__: JSON.stringify(buildId) } : {},
  plugins: [tailwindcss(), react(), buildVersion],
  resolve: {
    alias: {
      "@": new URL("./src", import.meta.url).pathname,
    },
  },
  server: {
    fs: { allow: [new URL(".", import.meta.url).pathname, new URL("../shared", import.meta.url).pathname] },
    proxy: {
      "/api": {
        target: process.env.PLIEGO_API_PROXY_TARGET || "http://localhost:8080",
        changeOrigin: true,
      },
    },
  },
}));
