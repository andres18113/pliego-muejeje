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
    // WSL2 reports 32 CPUs. Unbounded forks reached 31 workers/~7.5 GiB PSS; three cap at ~1.5 GiB RSS.
    maxWorkers: 3,
    // Keep Maglev disabled: on WSL2 with Node 24.22.1/V8 13.6.233.17, --no-maglev alone passed 20/20 full runs
    // (1,075 tests each; 60–83s). Previously reported baseline: only --no-concurrent-recompilation
    // still crashed about 20–25% of full runs. Related Node issue #66126 remains open for a similar
    // Vitest 5/jsdom-forks crash.
    execArgv: ["--no-maglev"],
    environment: "jsdom",
    setupFiles: ["./src/test/setup.ts"],
    exclude: ["tests/e2e/**", "test-results/**", "playwright-report/**", "node_modules/**"],
    restoreMocks: true,
    clearMocks: true,
  },
});
