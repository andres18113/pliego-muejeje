import AxeBuilder from "@axe-core/playwright";
import { expectLightAppearance, expectUnchangedByDarkPreference } from "./light-appearance";
import { expectCoversDecoded } from "./covers";
import { expect, test, type Page } from "@playwright/test";
const env = (globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env ?? {};
const output = "../docs/audit/storefront-redesign-2026-10-03/";
test.skip(!env.PLIEGO_VISUAL_LIVE, "Set PLIEGO_VISUAL_LIVE=1 to verify the real public catalog.");
// The Home presents the popular row's products; the catalog presents book cards. Both frame covers with BookCover.
const popular = 'section[aria-labelledby="popular-heading"]';
const products = { home: `${popular} [data-popular-track] > [data-media]`, catalog: "[data-bookcard]" } as const;
const productLinks = { home: `${products.home} a`, catalog: "[data-bookcard-link]" } as const;
const escaped = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
async function ready(page: Page, surface: keyof typeof products) {
  await expect(page.locator(products[surface]).first().locator("[data-bookcard-cover]")).toBeVisible();
  await page.locator("img").evaluateAll((images) => images.forEach((image) => (image as HTMLImageElement).loading = "eager"));
  await page.evaluate(() => document.fonts.ready);
  await expectCoversDecoded(page, 45_000);
}
async function fits(page: Page, width: number) {
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth)).toBe(width);
  const header = await page.getByTestId("site-header").boundingBox();
  expect(header!.x).toBe(0); expect(header!.width).toBe(width); expect(header!.y).toBe(0);
}
async function accessible(page: Page) {
  const result = await new AxeBuilder({ page }).setLegacyMode().withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"]).analyze();
  expect(result.violations.map(({ id, nodes }) => ({ id, nodes: nodes.map(({ target, failureSummary }) => ({ target, failureSummary })) }))).toEqual([]);
}
for (const scheme of ["light", "dark"] as const) for (const width of [320, 375, 768, 1024, 1440, 1920]) {
  test.describe(`${scheme}, ${width}px`, () => {
    test.use({ viewport: { width, height: width < 600 ? 844 : 1000 }, hasTouch: width <= 1024, isMobile: width < 600 });
    test("real storefront: composition, accessible discovery, search, subjects and filters", async ({ page }, testInfo) => {
      test.setTimeout(180_000);
      await page.emulateMedia({ colorScheme: scheme, reducedMotion: "reduce" });
      await page.route("**/api/v1/auth/refresh", (route) => route.fulfill({ status: 204 }));
      const errors: string[] = []; page.on("pageerror", (error) => errors.push(error.message));
      const geometry: unknown[] = [];
      let realTitle = "";
      for (const [surface, route] of [["home", "/"], ["catalog", "/catalog"]] as const) {
        await page.goto(route); await ready(page, surface); await page.evaluate(() => scrollTo(0, 0));
        await expectLightAppearance(page); if (scheme === "dark") await expectUnchangedByDarkPreference(page);
        if (surface === "home") await expect(page.locator("[data-popular-track]")).toHaveAttribute("data-page", "0");
        await fits(page, width); await accessible(page); await page.evaluate(() => { document.querySelector<HTMLElement>("main h1")?.focus({ preventScroll: true }); scrollTo(0, 0); });
        await page.screenshot({ path: `${output}${surface}-${scheme}-${width}.png`, fullPage: true });
        const facts = await page.locator(products[surface]).evaluateAll((cards) => cards.map((card) => {
          const cover = card.querySelector("[data-bookcard-cover]")!.getBoundingClientRect();
          const image = card.querySelector<HTMLImageElement>("img");
          return { id: card.getAttribute("data-edition-id") ?? card.querySelector("a")?.getAttribute("href"), ratio: cover.width / cover.height, source: image?.currentSrc, naturalWidth: image?.naturalWidth, fit: image ? getComputedStyle(image).objectFit : null };
        })); geometry.push(facts); expect(facts.length).toBeGreaterThan(0);
        for (const fact of facts) { expect(fact.ratio).toBeCloseTo(2 / 3, 2); if (fact.source) { expect(fact.naturalWidth).toBeGreaterThan(0); expect(fact.fit).toBe("contain"); } }
        const cardLink = page.locator(productLinks[surface]).first();
        await cardLink.scrollIntoViewIfNeeded(); await cardLink.focus(); await expect(cardLink).toBeFocused();
        expect(await cardLink.evaluate((node) => getComputedStyle(node).outlineStyle)).not.toBe("none");
        expect((await cardLink.boundingBox())!.y).toBeGreaterThanOrEqual((await page.getByTestId("site-header").boundingBox())!.height);
        await page.evaluate(() => document.documentElement.style.fontSize = "32px"); await fits(page, width);
        await page.screenshot({ path: `${output}${surface}-text200-${scheme}-${width}.png` });
        await page.evaluate(() => document.documentElement.style.fontSize = "");
        if (surface === "home") { const next = page.getByRole("button", { name: "Más títulos", exact: true }); await next.scrollIntoViewIfNeeded(); if (width <= 1024) await next.tap(); else await next.click(); await expect(page.locator("[data-popular-track]")).toHaveAttribute("data-page", "1"); }
        // Search for a title the real catalog actually lists, rather than one fixed book that may leave it.
        else realTitle = (await page.locator("[data-bookcard-title]").first().textContent())!.trim();
      }
      await page.getByRole("button", { name: "Buscar libros en el catálogo", exact: true }).click();
      const dialog = page.getByRole("dialog", { name: "Buscar en el catálogo", exact: true }); const search = dialog.getByRole("searchbox");
      expect(realTitle).not.toBe(""); await expect(search).toBeFocused(); await search.fill(realTitle);
      await expect(dialog.getByRole("link", { name: new RegExp(escaped(realTitle)) }).first()).toBeVisible(); await search.press("ArrowDown");
      await expect(dialog.getByRole("listitem").first().getByRole("link")).toBeFocused(); await accessible(page);
      await page.screenshot({ path: `${output}search-${scheme}-${width}.png` }); await page.keyboard.press("Escape");
      await expect(page.getByRole("button", { name: "Buscar libros en el catálogo", exact: true })).toBeFocused();
      // The header's section menu (a panel from 1280px, the Navegación drawer below) leads to the Libros collection.
      await page.getByRole("button", { name: width >= 1280 ? "Menú de Libros" : "Abrir navegación", exact: true }).click();
      const menu = width >= 1280 ? page.getByRole("region", { name: "Menú de Libros", exact: true }) : page.getByRole("dialog", { name: "Navegación", exact: true });
      if (width < 1280) await menu.getByRole("button", { name: "Menú de Libros", exact: true }).click();
      await expect(menu.getByRole("link", { name: /^Explorar todos los libros/ })).toBeVisible();
      await menu.locator("img").evaluateAll((images) => images.forEach((image) => (image as HTMLImageElement).loading = "eager"));
      await expectCoversDecoded(menu, 45_000); await accessible(page);
      await page.screenshot({ path: `${output}navigation-${scheme}-${width}.png` }); await menu.getByRole("link", { name: /^Explorar todos los libros/ }).click();
      await expect(page).toHaveURL(/productType=PHYSICAL/); await expect(page.getByRole("heading", { level: 1, name: "Libros", exact: true })).toBeVisible();
      // A real subject applies through the URL and reads as the chosen filter.
      const filters = width < 1024 ? page.getByRole("dialog", { name: "Filtros", exact: true }) : page.getByRole("complementary", { name: "Filtros", exact: true });
      if (width < 1024) { await page.getByRole("button", { name: /^Filtros/ }).click(); await expect(filters).toBeVisible(); }
      await filters.getByRole("button", { name: "Tema", exact: true }).click();
      await filters.getByRole("radio", { name: "Literatura", exact: true }).click();
      await expect(page).toHaveURL(/category=literatura/); await expect(page).toHaveURL(/productType=PHYSICAL/);
      await expect(filters.getByRole("radio", { name: "Literatura", exact: true })).toBeChecked(); await accessible(page);
      await page.screenshot({ path: `${output}filters-${scheme}-${width}.png` });
      if (width < 1024) { await page.keyboard.press("Escape"); await expect(page.getByRole("button", { name: /^Filtros/ })).toBeFocused(); }
      expect(errors).toEqual([]); await testInfo.attach("geometry", { body: JSON.stringify({ width, scheme, geometry, errors }, null, 2), contentType: "application/json" });
    });
  });
}
