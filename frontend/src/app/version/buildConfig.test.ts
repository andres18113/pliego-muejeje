import { describe, expect, it } from "vitest";
import config from "../../../vite.config";

/** The version check must stay inert in development: only production builds carry a build ID (and /version.json). */
describe("build ID definition", () => {
  const resolve = (command: "build" | "serve") =>
    (config as (env: { command: "build" | "serve"; mode: string; isSsrBuild?: boolean; isPreview?: boolean }) => { define?: Record<string, string> })({ command, mode: command === "build" ? "production" : "development" });

  it("is absent under the dev server", () => {
    expect(resolve("serve").define ?? {}).not.toHaveProperty("__PLIEGO_BUILD_ID__");
  });

  it("is stamped into production builds", () => {
    expect(JSON.parse(resolve("build").define!.__PLIEGO_BUILD_ID__)).toMatch(/^[A-Za-z0-9._-]{1,64}$/);
  });
});
