#!/usr/bin/env node
// Regenerates the self-hosted Material Symbols subset from the `MaterialSymbolName` union, the one list of icons.
// Run from frontend/ after adding or removing an icon:  node scripts/update-material-symbols.mjs
// Google Fonts serves a woff2 subset only to a browser User-Agent, so one is sent explicitly.
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";

const root = new URL("../", import.meta.url);
const componentFile = new URL("src/shared/ui/MaterialSymbol.tsx", root);
const fontFile = new URL("src/assets/fonts/material-symbols-outlined.woff2", root);
const manifestFile = new URL("src/assets/fonts/material-symbols-outlined.json", root);
const browserUserAgent = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36";

export function materialSymbolNames(source) {
  const union = source.match(/export type MaterialSymbolName =([^;]+);/);
  if (!union) throw new Error("MaterialSymbolName union not found");
  return [...union[1].matchAll(/"([a-z0-9_]+)"/g)].map(match => match[1]).sort();
}

const icons = materialSymbolNames(await readFile(componentFile, "utf8"));
// Same axes as before: FILL 0–1, optical size 20–48, weight 400–500 (MaterialSymbol uses 400 and 500).
const cssUrl = `https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:FILL,opsz,wght@0..1,20..48,400..500&icon_names=${icons.join(",")}&display=block`;
const css = await (await fetch(cssUrl, { headers: { "User-Agent": browserUserAgent } })).text();
const fontUrl = css.match(/src:\s*url\(([^)]+)\)\s*format\(['"]woff2['"]\)/)?.[1];
if (!fontUrl) throw new Error(`No woff2 source in Google Fonts response:\n${css}`);
const response = await fetch(fontUrl, { headers: { "User-Agent": browserUserAgent } });
if (!response.ok) throw new Error(`Font download failed: ${response.status}`);
const font = Buffer.from(await response.arrayBuffer());
await writeFile(fontFile, font);
await writeFile(manifestFile, `${JSON.stringify({
  family: "Material Symbols Outlined",
  license: "Apache-2.0 (https://github.com/google/material-design-icons)",
  axes: "FILL 0..1, opsz 20..48, wght 400..500",
  bytes: font.length,
  sha256: createHash("sha256").update(font).digest("hex"),
  icons,
}, null, 2)}\n`);
console.log(`Wrote ${icons.length} icons, ${font.length} bytes.`);
