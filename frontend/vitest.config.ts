import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": new URL("./src", import.meta.url).pathname,
    },
  },
  test: {
    pool: "forks",
    // Keep JIT/Wasm, but avoid V8's background compiler aborts in jsdom workers.
    // Remove after a Node/V8 fix is verified: https://github.com/nodejs/node/issues/66126
    execArgv: ["--no-concurrent-recompilation"],
    environment: "jsdom",
    setupFiles: ["./src/test/setup.ts"],
    exclude: ["tests/e2e/**", "node_modules/**"],
    restoreMocks: true,
    clearMocks: true,
  },
});
