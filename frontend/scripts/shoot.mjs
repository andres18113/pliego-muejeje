// Dev-only screenshot helper: node scripts/shoot.mjs <outDir> [path...]
import { chromium } from "@playwright/test";
import { mkdirSync } from "node:fs";

const outDir = process.argv[2] ?? "shots";
const paths = process.argv.slice(3).length ? process.argv.slice(3) : ["/", "/catalog"];
const widths = (process.env.WIDTHS ?? "390,1440").split(",").map(Number);
const full = process.env.FULL !== "0";
const scheme = process.env.SCHEME ?? "light";
mkdirSync(outDir, { recursive: true });

const browser = await chromium.launch();
for (const width of widths) {
  const context = await browser.newContext({
    viewport: { width, height: width < 700 ? 844 : width < 1100 ? 1024 : 900 },
    colorScheme: scheme,
    reducedMotion: "reduce",
  });
  const page = await context.newPage();
  for (const path of paths) {
    await page.goto(`http://127.0.0.1:5173${path}`, { waitUntil: "networkidle" });
    await page.waitForTimeout(700);
    const name = `${path.replace(/[^a-z0-9]+/gi, "_") || "home"}-${width}-${scheme}.png`;
    await page.screenshot({ path: `${outDir}/${name}`, fullPage: full });
    console.log(`${outDir}/${name}`);
  }
  await context.close();
}
await browser.close();
