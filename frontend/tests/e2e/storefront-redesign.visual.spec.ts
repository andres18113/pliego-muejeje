import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
const env = (globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env ?? {};
const output = "../docs/audit/storefront-redesign-2026-10-03/";
test.skip(!env.PLIEGO_VISUAL_LIVE, "Set PLIEGO_VISUAL_LIVE=1 to verify the real public catalog.");
async function ready(page: Page) {
  await expect(page.locator("[data-bookcard]").first()).toBeVisible();
  await page.locator("img").evaluateAll((images) => images.forEach((image) => (image as HTMLImageElement).loading = "eager"));
  await page.evaluate(() => document.fonts.ready);
  await expect(page.locator(".cover-image--loading")).toHaveCount(0, { timeout: 45_000 });
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
      for (const [surface, route] of [["home", "/"], ["catalog", "/catalog"]]) {
        await page.goto(route); await ready(page); await page.evaluate(() => scrollTo(0, 0));
        if (surface === "home") expect(await page.locator('[data-presentation="rail"]').evaluate((node) => node.scrollLeft)).toBe(0);
        await fits(page, width); await accessible(page); await page.evaluate(() => { document.querySelector<HTMLElement>("main h1")?.focus({ preventScroll: true }); scrollTo(0, 0); });
        await page.screenshot({ path: `${output}${surface}-${scheme}-${width}.png`, fullPage: true });
        const facts = await page.locator("[data-bookcard]").evaluateAll((cards) => cards.map((card) => {
          const cover = card.querySelector("[data-bookcard-cover]")!.getBoundingClientRect();
          const image = card.querySelector<HTMLImageElement>("img");
          return { id: card.getAttribute("data-edition-id"), ratio: cover.width / cover.height, source: image?.currentSrc, naturalWidth: image?.naturalWidth, fit: image ? getComputedStyle(image).objectFit : null };
        })); geometry.push(facts);
        for (const fact of facts) { expect(fact.ratio).toBeCloseTo(2 / 3, 2); if (fact.source) { expect(fact.naturalWidth).toBeGreaterThan(0); expect(fact.fit).toBe("contain"); } }
        const cardLink = page.locator("[data-bookcard-link]").first();
        await cardLink.scrollIntoViewIfNeeded(); await cardLink.focus(); await expect(cardLink).toBeFocused();
        expect(await cardLink.evaluate((node) => getComputedStyle(node).outlineStyle)).not.toBe("none");
        expect((await cardLink.boundingBox())!.y).toBeGreaterThanOrEqual((await page.getByTestId("site-header").boundingBox())!.height);
        await page.evaluate(() => document.documentElement.style.fontSize = "32px"); await fits(page, width);
        await page.screenshot({ path: `${output}${surface}-text200-${scheme}-${width}.png` });
        await page.evaluate(() => document.documentElement.style.fontSize = "");
        if (surface === "home") { const next = page.getByRole("button", { name: "Ver más libros", exact: true }); await next.scrollIntoViewIfNeeded(); if (width <= 1024) await next.tap(); else await next.click(); await expect.poll(() => page.locator('[data-presentation="rail"]').evaluate((node) => node.scrollLeft)).toBeGreaterThan(0); }
      }
      await page.getByRole("button", { name: "Buscar en el catálogo", exact: true }).click();
      const dialog = page.getByRole("dialog", { name: "Buscar en el catálogo", exact: true }); const search = dialog.getByRole("searchbox");
      await expect(search).toBeFocused(); await search.fill("cien");
      await expect(dialog.getByRole("link", { name: /Cien años de soledad/ })).toBeVisible(); await search.press("ArrowDown");
      await expect(dialog.getByRole("link", { name: /Cien años de soledad/ })).toBeFocused(); await accessible(page);
      await page.screenshot({ path: `${output}search-${scheme}-${width}.png` }); await page.keyboard.press("Escape");
      await expect(page.getByRole("button", { name: "Buscar en el catálogo", exact: true })).toBeFocused();
      await page.getByRole("button", { name: width >= 1280 ? "Literatura" : "Abrir navegación", exact: true }).click();
      const menu = width >= 1280 ? page.locator("#categorias-escritorio") : page.getByRole("dialog", { name: "Categorías", exact: true });
      if (width < 1280) await menu.getByRole("button", { name: "Literatura", exact: true }).click();
      await expect(menu.getByRole("link", { name: "Ver todos los libros de Literatura" })).toBeVisible();
      await menu.locator("img").evaluateAll((images) => images.forEach((image) => (image as HTMLImageElement).loading = "eager"));
      await expect(menu.locator(".cover-image--loading")).toHaveCount(0, { timeout: 45_000 }); await accessible(page);
      await page.screenshot({ path: `${output}navigation-${scheme}-${width}.png` }); await menu.getByRole("link", { name: "Ver todos los libros de Literatura" }).click();
      await expect(page).toHaveURL(/category=literatura/);
      await expect(page.getByRole("navigation", { name: "Temas del catálogo" }).getByRole("link", { name: "Literatura", exact: true })).toHaveAttribute("aria-current", "page");
      const filters = width < 1024 ? page.getByRole("dialog", { name: "Filtros del catálogo" }) : page.getByRole("complementary", { name: "Filtros del catálogo" });
      if (width < 1024) { await page.getByRole("button", { name: /^Filtros/ }).click(); await expect(filters).toBeVisible(); await filters.getByRole("button", { name: "Tema", exact: true }).click(); }
      await expect(filters.getByRole("radio", { name: "Literatura", exact: true })).toBeChecked(); await accessible(page);
      await page.screenshot({ path: `${output}filters-${scheme}-${width}.png` });
      if (width < 1024) { await page.keyboard.press("Escape"); await expect(page.getByRole("button", { name: /^Filtros/ })).toBeFocused(); }
      expect(errors).toEqual([]); await testInfo.attach("geometry", { body: JSON.stringify({ width, scheme, geometry, errors }, null, 2), contentType: "application/json" });
    });
  });
}
