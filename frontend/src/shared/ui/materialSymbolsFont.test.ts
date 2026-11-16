import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import font from "@/assets/fonts/material-symbols-outlined.json";

// The self-hosted subset only contains the glyphs it was generated for; a name added to MaterialSymbolName without
// rerunning `node scripts/update-material-symbols.mjs` would render as its ligature text.
describe("self-hosted Material Symbols subset", () => {
  it("contains exactly the names MaterialSymbolName allows", () => {
    const source = readFileSync(resolve(process.cwd(), "src/shared/ui/MaterialSymbol.tsx"), "utf8");
    const union = source.match(/export type MaterialSymbolName =([^;]+);/)?.[1] ?? "";
    const names = [...union.matchAll(/"([a-z0-9_]+)"/g)].map(match => match[1]).sort();
    expect(names.length).toBeGreaterThan(0);
    expect(font.icons).toEqual(names);
  });

  it("is no longer requested from Google Fonts", () => {
    const html = readFileSync(resolve(process.cwd(), "index.html"), "utf8");
    expect(html).not.toContain("fonts.googleapis.com");
    expect(html).toContain('href="/src/assets/fonts/material-symbols-outlined.woff2"');
  });
});
