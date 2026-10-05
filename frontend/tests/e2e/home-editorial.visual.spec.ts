import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
const env = (globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env ?? {};
const output = "../docs/audit/home-next-reading-2026-10-03/";
test.skip(!env.PLIEGO_VISUAL_LIVE, "Set PLIEGO_VISUAL_LIVE=1 for the Home's real public catalog checks.");
async function ready(page: Page) {
  await expect(page.locator("[data-reading-scene]")).toHaveCount(4); await expect(page.locator("#literature-heading")).toBeVisible();
  await page.locator("img").evaluateAll((images) => images.forEach((image) => (image as HTMLImageElement).loading = "eager"));
  await page.evaluate(() => document.fonts.ready); await expect(page.locator(".cover-image--loading")).toHaveCount(0, { timeout: 45_000 });
}
async function accessible(page: Page) {
  const audit = await new AxeBuilder({ page }).setLegacyMode().withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"]).analyze();
  expect(audit.violations.map(({ id, nodes }) => ({ id, nodes: nodes.map(({ target, failureSummary }) => ({ target, failureSummary })) }))).toEqual([]);
}
for (const scheme of ["light", "dark"] as const) for (const width of [320, 375, 390, 768, 1024, 1440, 1920]) {
  test.describe(`Home ${scheme} ${width}px`, () => {
    test.use({ viewport: { width, height: width < 600 ? 844 : 1000 }, isMobile: width < 600, hasTouch: width <= 1024 });
    test("complete Home: real editorial books, responsive composition, keyboard and commerce destinations", async ({ page }, testInfo) => {
      test.setTimeout(150_000); await page.route("**/api/v1/auth/refresh", (route) => route.fulfill({ status: 204 }));
      await page.emulateMedia({ colorScheme: scheme, reducedMotion: "reduce" });
      const errors: string[] = []; page.on("pageerror", (error) => errors.push(error.message)); await page.goto("/"); await ready(page);
      const hero = page.locator('section[aria-labelledby="page-title"]');
      // The brand character carries the hero; product covers stay out of it.
      await expect(hero.locator("img")).toHaveCount(0); await expect(hero.locator('svg[aria-hidden="true"]')).toHaveCount(1);
      await expect(hero.getByRole("link")).toHaveCount(1);
      const heroAction = hero.getByRole("link", { name: "Explorar libros", exact: true }); await heroAction.focus();
      await expect(heroAction).toBeFocused(); expect(await heroAction.evaluate((node) => getComputedStyle(node).outlineStyle)).not.toBe("none");
      await page.evaluate(() => { document.activeElement instanceof HTMLElement && document.activeElement.blur(); scrollTo(0, 0); });
      await expect(page.getByTestId("site-header")).toHaveAttribute("data-home", "true");
      const track = page.locator("[data-reading-track]"); await expect(track).toHaveAttribute("data-active", "0");
      await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth)).toBe(width);
      await accessible(page); await page.evaluate(() => scrollTo(0, 0));
      await page.screenshot({ path: `${output}home-${scheme}-${width}.png`, fullPage: true }); await page.screenshot({ path: `${output}hero-${scheme}-${width}.png` });
      for (const section of ["discovery-heading", "explora-temas", "literature-heading"]) {
        const target = section === "explora-temas" ? page.locator("#explora-temas") : page.locator(`#${section}`).locator("xpath=ancestor::section[1]");
        await target.screenshot({ path: `${output}${section}-${scheme}-${width}.png`, style: "header { visibility: hidden; }" });
      }
      const geometry = await page.locator("[data-reading-scene] .book-cover").evaluateAll((covers) => covers.map((cover) => {
        const rect = cover.getBoundingClientRect(); const img = cover.querySelector<HTMLImageElement>("img");
        return { ratio: rect.width / rect.height, width: rect.width, height: rect.height, fit: img ? getComputedStyle(img).objectFit : null, decoded: Boolean(img?.naturalWidth) };
      }));
      for (const cover of geometry) { expect(cover.ratio).toBeCloseTo(2 / 3, 2); expect(cover.fit).toBe("contain"); expect(cover.decoded).toBe(true); }
      const feature = page.locator('section[aria-labelledby="literature-heading"]');
      const editionHref = await feature.getByRole("link", { name: "Ver esta edición", exact: true }).getAttribute("href"); const editionId = editionHref!.split("/editions/")[1].split("?")[0];
      const response = await page.request.get(`/api/v1/catalog/editions/${editionId}`); expect(response.ok()).toBe(true);
      const edition = await response.json(); await expect(page.locator("#literature-heading")).toHaveText(edition.title);
      const first = page.locator("[data-reading-scene]:not([inert])"); const link = first.locator("[data-reading-title]");
      await link.scrollIntoViewIfNeeded(); await link.focus(); await expect(link).toBeFocused(); expect(await link.evaluate((node) => getComputedStyle(node).outlineStyle)).not.toBe("none");
      await page.keyboard.press("Tab"); await expect(first.locator("[data-reading-cart]")).toBeFocused();
      await page.keyboard.press("Tab"); await expect(first.locator("[data-reading-favorite]")).toBeFocused();
      await first.locator("[data-reading-favorite]").click(); await expect(page).toHaveURL(/\/sign-in\?from=/); await page.goBack(); await ready(page);
      // Topic chips choose the set; dots and arrows move inside it; nothing moves by itself.
      const scene = page.locator('section[aria-labelledby="discovery-heading"]');
      const topics = scene.getByRole("group", { name: "Elige un tema" });
      for (const topic of ["Literatura", "Matemáticas", "Filosofía"]) {
        await topics.getByRole("button", { name: topic, exact: true }).click();
        await expect(topics.getByRole("button", { name: topic, exact: true })).toHaveAttribute("aria-pressed", "true");
        await expect(scene.getByRole("group", { name: `Libros de ${topic}` })).toBeVisible(); await ready(page);
        await expect(track).toHaveAttribute("data-active", "0");
        await expect(scene.getByRole("button", { name: "Libro anterior" })).toHaveAttribute("aria-disabled", "true");
        await scene.screenshot({ path: `${output}scene-${topic}-${scheme}-${width}.png`, style: "header { visibility: hidden; }" });
      }
      const dots = scene.getByRole("group", { name: "Libros de Filosofía" }).getByRole("button");
      await dots.last().click(); await expect(dots.last()).toHaveAttribute("aria-current", "true");
      await expect(scene.getByRole("button", { name: "Libro siguiente" })).toHaveAttribute("aria-disabled", "true");
      await scene.screenshot({ path: `${output}scene-last-${scheme}-${width}.png`, style: "header { visibility: hidden; }" });
      await dots.first().click(); await expect(dots.first()).toHaveAttribute("aria-current", "true");
      const next = scene.getByRole("button", { name: "Libro siguiente", exact: true }); await next.scrollIntoViewIfNeeded(); if (width <= 1024) await next.tap(); else await next.click();
      await expect(dots.nth(1)).toHaveAttribute("aria-current", "true");
      await expect(track).toHaveAttribute("data-active", "1");
      await first.locator("[data-reading-title]").click(); await expect(page).toHaveURL(/\/catalog\/editions\//); await page.goBack(); await ready(page);
      await expect(track).toHaveAttribute("data-active", "1"); await expect(dots.nth(1)).toHaveAttribute("aria-current", "true");
      await page.evaluate(() => { document.activeElement instanceof HTMLElement && document.activeElement.blur(); document.documentElement.style.fontSize = "32px"; });
      await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth)).toBe(width); await page.evaluate(() => scrollTo(0, 0));
      await page.screenshot({ path: `${output}text200-${scheme}-${width}.png`, fullPage: true }); await page.evaluate(() => document.documentElement.style.fontSize = "");
      await page.getByRole("button", { name: "Buscar libros en el catálogo", exact: true }).click(); const search = page.getByRole("dialog", { name: "Buscar en el catálogo" });
      await expect(search.getByRole("searchbox")).toBeFocused(); await search.getByRole("searchbox").fill("cien"); await expect(search.getByRole("link", { name: /Cien años de soledad/ })).toBeVisible(); await accessible(page);
      await page.keyboard.press("Escape"); await expect(page.getByRole("button", { name: "Buscar libros en el catálogo", exact: true })).toBeFocused();
      await page.getByRole("navigation", { name: "Explora por tema" }).getByRole("link", { name: "Matemáticas", exact: true }).click();
      await expect(page).toHaveURL(/\/catalog\?category=matematicas/); await expect(page.getByTestId("site-header")).not.toHaveAttribute("data-home"); expect(errors).toEqual([]);
      await testInfo.attach("geometry", { body: JSON.stringify({ width, scheme, geometry, errors }, null, 2), contentType: "application/json" });
    });
  });
}

for (const scheme of ["light", "dark"] as const) {
  test(`Home recovery and empty catalog remain accessible at 320px / ${scheme}`, async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 844 }); await page.emulateMedia({ colorScheme: scheme, reducedMotion: "reduce" });
    await page.route("**/api/v1/auth/refresh", (route) => route.fulfill({ status: 204 }));
    let failed = true;
    const unavailable = { status: 503, contentType: "application/problem+json", body: JSON.stringify({ status: 503, title: "Servicio no disponible", detail: "Revisa tu conexión e inténtalo otra vez." }) };
    await page.route("**/api/v1/catalog/categories", (route) => failed ? route.fulfill(unavailable) : route.fulfill({ contentType: "application/json", body: JSON.stringify({ items: [{ slug: "filosofia", name: "Filosofía", parentSlug: null }] }) }));
    await page.route("**/api/v1/catalog/editions**", (route) => route.fulfill({ contentType: "application/json", body: JSON.stringify({ items: [], page: 0, pageSize: 4, totalCount: "0" }) }));
    await page.goto("/"); const scene = page.locator('section[aria-labelledby="discovery-heading"]');
    const retry = scene.getByRole("button", { name: "Volver a intentar", exact: true }); await expect(retry).toBeVisible();
    await page.evaluate(() => document.fonts.ready); await accessible(page);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(320);
    await page.screenshot({ path: `${output}recovery-${scheme}-320.png`, fullPage: true });
    failed = false; await retry.click(); await expect(scene.getByRole("heading", { name: "Aún no hay libros publicados en Filosofía." })).toBeVisible();
    await expect(scene.getByRole("link", { name: "Ver el catálogo" })).toHaveAttribute("href", "/catalog"); await accessible(page);
    await page.evaluate(() => document.documentElement.style.fontSize = "32px");
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth)).toBe(320);
    await page.screenshot({ path: `${output}empty-text200-${scheme}-320.png`, fullPage: true });
  });
}
