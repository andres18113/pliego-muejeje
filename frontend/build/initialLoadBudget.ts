import { gzipSync } from "node:zlib";
import type { Plugin } from "vite";

/**
 * Guards what every visitor downloads before the first page renders: the entry chunk plus its static imports and
 * their CSS (exactly what index.html preloads). A production build fails when that set grows past the gzip budget or
 * reaches a dependency that only a later route needs — the way a 193 KB phone-number library once arrived on every
 * page through one shared validation import. Raise the budget deliberately, with the measurement, never to get a
 * build through.
 */
export interface InitialLoadPolicy {
  /** Gzip (level 9) bytes allowed for the initial JS + CSS. */
  maxGzipBytes: number;
  /** Module paths that must never be part of the initial graph, with the reason shown when they are. */
  forbidden: { pattern: RegExp; reason: string }[];
}

export const initialLoadPolicy: InitialLoadPolicy = {
  // Measured 2026-11-15: 317 KB after the mobile loading work (391 KB before). Headroom ≈ 7 %.
  maxGzipBytes: 340 * 1024,
  forbidden: [
    { pattern: /node_modules\/libphonenumber-js\//, reason: "phone validation belongs to forms on account and checkout routes" },
    { pattern: /node_modules\/react-phone-number-input\//, reason: "the phone field belongs to account and checkout routes" },
    { pattern: /node_modules\/country-flag-icons\//, reason: "flags belong to the country picker on form routes" },
    { pattern: /\/src\/features\/purchase\/CartPreviewDrawer\.tsx$/, reason: "the cart drawer loads on pages that can add to the cart" },
  ],
};

/** The parts of a Rollup output the policy reads (kept structural so tests can build one by hand). */
export type BundleItem =
  | { type: "chunk"; fileName: string; isEntry: boolean; imports: string[]; moduleIds: string[]; code: string; viteMetadata?: { importedCss: Set<string> } }
  | { type: "asset"; fileName: string; source: string | Uint8Array };

export interface InitialLoadReport { files: string[]; gzipBytes: number; violations: string[] }

export function evaluateInitialLoad(bundle: Record<string, BundleItem>, policy: InitialLoadPolicy): InitialLoadReport {
  const entries = Object.values(bundle).filter((item): item is Extract<BundleItem, { type: "chunk" }> => item.type === "chunk" && item.isEntry);
  const chunks = new Set<string>();
  const css = new Set<string>();
  const visit = (fileName: string) => {
    const item = bundle[fileName];
    if (!item || item.type !== "chunk" || chunks.has(fileName)) return;
    chunks.add(fileName);
    item.viteMetadata?.importedCss.forEach(file => css.add(file));
    item.imports.forEach(visit);
  };
  entries.forEach(entry => visit(entry.fileName));

  const violations: string[] = [];
  let gzipBytes = 0;
  for (const fileName of chunks) {
    const chunk = bundle[fileName] as Extract<BundleItem, { type: "chunk" }>;
    gzipBytes += gzipSync(chunk.code, { level: 9 }).length;
    for (const rule of policy.forbidden) {
      const hit = chunk.moduleIds.find(id => rule.pattern.test(id.replace(/\\/g, "/")));
      if (hit) violations.push(`${hit} is in the initial load (${fileName}): ${rule.reason}.`);
    }
  }
  for (const fileName of css) {
    const asset = bundle[fileName];
    if (asset?.type === "asset") gzipBytes += gzipSync(asset.source, { level: 9 }).length;
  }
  if (gzipBytes > policy.maxGzipBytes) {
    violations.push(`Initial JS + CSS is ${(gzipBytes / 1024).toFixed(1)} KB gzip, over the ${(policy.maxGzipBytes / 1024).toFixed(0)} KB budget.`);
  }
  return { files: [...chunks, ...css], gzipBytes, violations };
}

export function initialLoadBudget(policy: InitialLoadPolicy = initialLoadPolicy): Plugin {
  return {
    name: "pliego-initial-load-budget",
    apply: "build",
    generateBundle(_options, bundle) {
      const report = evaluateInitialLoad(bundle as unknown as Record<string, BundleItem>, policy);
      if (report.violations.length) this.error(`Initial load policy:\n- ${report.violations.join("\n- ")}`);
      this.info(`initial load: ${report.files.length} files, ${(report.gzipBytes / 1024).toFixed(1)} KB gzip (budget ${(policy.maxGzipBytes / 1024).toFixed(0)} KB)`);
    },
  };
}
