import { describe, expect, it } from "vitest";
import { evaluateInitialLoad, initialLoadPolicy, type BundleItem } from "./initialLoadBudget";

const chunk = (fileName: string, options: Partial<Extract<BundleItem, { type: "chunk" }>> = {}): BundleItem => ({
  type: "chunk", fileName, isEntry: false, imports: [], moduleIds: [], code: "export {};", ...options,
});

describe("evaluateInitialLoad", () => {
  it("follows the entry's static imports and their CSS, and ignores lazy chunks", () => {
    const bundle: Record<string, BundleItem> = {
      "index.js": chunk("index.js", { isEntry: true, imports: ["shared.js"], viteMetadata: { importedCss: new Set(["index.css"]) } }),
      "shared.js": chunk("shared.js"),
      "Checkout.js": chunk("Checkout.js", { moduleIds: ["/app/node_modules/libphonenumber-js/max/index.js"] }),
      "index.css": { type: "asset", fileName: "index.css", source: "body{margin:0}" },
    };
    const report = evaluateInitialLoad(bundle, initialLoadPolicy);
    expect(report.files.sort()).toEqual(["index.css", "index.js", "shared.js"]);
    expect(report.violations).toEqual([]);
  });

  it("reports a route-only dependency reached from the entry", () => {
    const bundle: Record<string, BundleItem> = {
      "index.js": chunk("index.js", { isEntry: true, imports: ["person.js"] }),
      "person.js": chunk("person.js", { moduleIds: ["/app/node_modules/libphonenumber-js/max/index.js"] }),
    };
    const [violation] = evaluateInitialLoad(bundle, initialLoadPolicy).violations;
    expect(violation).toContain("libphonenumber-js");
    expect(violation).toContain("person.js");
  });

  it("reports an initial load over the gzip budget", () => {
    const random = Array.from({ length: 4000 }, (_, i) => (i * 7919 % 104729).toString(36)).join("");
    const bundle: Record<string, BundleItem> = { "index.js": chunk("index.js", { isEntry: true, code: random }) };
    const report = evaluateInitialLoad(bundle, { maxGzipBytes: 1024, forbidden: [] });
    expect(report.violations).toEqual([expect.stringContaining("over the 1 KB budget")]);
  });
});
