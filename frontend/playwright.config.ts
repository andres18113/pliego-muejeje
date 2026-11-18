import { defineConfig, devices } from "@playwright/test";

const baseURL = process.env.PLIEGO_E2E_BASE_URL || "http://127.0.0.1:5173";

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: true,
  // Every worker shares one Vite dev server: Playwright's default (half the CPUs, 16 under WSL2) leaves lazy routes
  // compiling past the 5s assertion window. CI passes --workers=1.
  workers: 4,
  reporter: "list",
  use: {
    baseURL,
    trace: "retain-on-failure",
  },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
  ],
  webServer: {
    command: "npm run dev -- --host 127.0.0.1",
    url: baseURL,
    reuseExistingServer: true,
    timeout: 120_000,
  },
});
