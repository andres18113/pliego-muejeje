import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
const env = (globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env ?? {};
test.skip(!env.PLIEGO_VISUAL_LIVE, "Set PLIEGO_VISUAL_LIVE=1 for the Home's real public catalog checks.");
const popular = 'section[aria-labelledby="popular-heading"]';
async function ready(page: Page) {
  await expect(page.locator(`${popular} [data-media]`).nth(5)).toBeAttached();
  await page.evaluate(() => document.fonts.ready);
}
async function accessible(page: Page) {
  const audit = await new AxeBuilder({ page }).setLegacyMode().withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"]).analyze();
  expect(audit.violations.map(({ id, nodes }) => ({ id, nodes: nodes.map(({ target, failureSummary }) => ({ target, failureSummary })) }))).toEqual([]);
}
for (const scheme of ["light", "dark"] as const) for (const width of [320, 390, 768, 1024, 1280, 1440, 1920]) {
  test.describe(`Home ${scheme} ${width}px`, () => {
    test.use({ viewport: { width, height: width < 600 ? 844 : width === 1280 ? 720 : 900 }, isMobile: width < 600, hasTouch: width <= 1024 });
    test("complete Home: opening, popular row, footer, keyboard and real destinations", async ({ page }, testInfo) => {
      test.setTimeout(120_000); await page.route("**/api/v1/auth/refresh", (route) => route.fulfill({ status: 204 }));
      await page.emulateMedia({ colorScheme: scheme, reducedMotion: "reduce" });
      const errors: string[] = []; page.on("pageerror", (error) => errors.push(error.message)); page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });
      await page.goto("/"); await ready(page);
      // The Home is the opening, the popular row, the two ways onward, the four benefits and the closing card, then the footer.
      const main = page.getByRole("main");
      await expect(main.locator(":scope section")).toHaveCount(5);
      const hero = page.locator('section[aria-labelledby="page-title"]');
      await expect(hero.getByRole("heading", { level: 1, name: "Descubre el mundo de PLIEGO." })).toBeVisible(); await expect(hero.locator("svg")).toHaveCount(0);
      await expect(hero.getByRole("link")).toHaveText([/^Explorar libros/, /^Explorar eBooks/, /^Explorar audiolibros/]);
      const heroAction = hero.getByRole("link", { name: "Explorar libros", exact: true }); await heroAction.focus(); await expect(heroAction).toBeFocused();
      await page.evaluate(() => { document.activeElement instanceof HTMLElement && document.activeElement.blur(); scrollTo(0, 0); });
      await expect(page.getByTestId("site-header")).toHaveAttribute("data-home", "true");
      // The next section starts below the first screen.
      expect(await page.locator("#popular-heading").evaluate((node) => node.getBoundingClientRect().top)).toBeGreaterThanOrEqual(await page.evaluate(() => innerHeight));
      await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth)).toBe(width);
      await accessible(page); await page.screenshot({ path: testInfo.outputPath(`home-${scheme}-${width}.png`), fullPage: true });
      // Ofertas and Ayuda lead to the projection's destinations; the footer follows them directly.
      const onward = page.getByRole("region", { name: "Ofertas y ayuda" });
      await expect(onward.getByRole("link", { name: "Ver ofertas" })).toHaveAttribute("href", "/ofertas"); await expect(onward.getByRole("link", { name: "Ir a Ayuda" })).toHaveAttribute("href", "/ayuda");
      await expect(onward.locator("img")).toHaveCount(0); await expect(onward.locator("svg")).toHaveCount(1);
      const benefits = page.locator('section[aria-labelledby="benefits-heading"]');
      await expect(benefits.getByRole("heading", { level: 3 })).toHaveText(["Todo en un solo lugar.", "Envío gratis.", "Ofertas que sí valen la pena.", "Ayuda cuando la necesites."]);
      await expect(benefits.getByRole("link")).toHaveCount(4);
      if (width >= 1000) expect(new Set(await benefits.locator("li").evaluateAll((cards) => cards.map((card) => Math.round(card.getBoundingClientRect().top)))).size).toBe(1);
      const gap = await page.evaluate(() => document.querySelector("footer")!.getBoundingClientRect().top - document.querySelector('section[aria-labelledby="closing-heading"]')!.getBoundingClientRect().bottom);
      await expect(page.getByRole("heading", { name: "Ya está. Ahora solo falta encontrar tu próxima historia." })).toBeVisible(); await expect(page.locator('section[aria-labelledby="closing-heading"]').getByText("¡Muchas gracias!")).toBeVisible();
      // Ofertas opens by pointer on the action itself, inside the app, and the way back returns here.
      await page.evaluate(() => { (window as unknown as { pliegoSameDocument?: boolean }).pliegoSameDocument = true; });
      const offersAction = onward.getByRole("link", { name: "Ver ofertas" }); await offersAction.scrollIntoViewIfNeeded(); const actionBox = (await offersAction.boundingBox())!;
      if (width > 1024) await page.mouse.click(actionBox.x + actionBox.width / 2, actionBox.y + actionBox.height / 2); else await page.touchscreen.tap(actionBox.x + actionBox.width / 2, actionBox.y + actionBox.height / 2);
      await expect(page).toHaveURL(/\/ofertas$/); await expect(page.getByRole("heading", { level: 1, name: "Ofertas" })).toBeVisible();
      expect(await page.evaluate(() => (window as unknown as { pliegoSameDocument?: boolean }).pliegoSameDocument)).toBe(true);
      await page.goBack(); await expect(page).toHaveURL(/\/$/); await ready(page);
      expect(gap).toBeGreaterThanOrEqual(0); expect(gap).toBeLessThan(8);
      // Real titles, none repeated; the row moves by its controls and stops at its ends.
      const track = page.locator("[data-popular-track]"); const links = track.locator("[data-media] a");
      const hrefs = await links.evaluateAll((nodes) => nodes.map((node) => node.getAttribute("href"))); expect(new Set(hrefs).size).toBe(hrefs.length);
      await expect(track.locator("[data-media]").first().locator("img")).toHaveCount(1);
      const previous = page.getByRole("button", { name: "Títulos anteriores" }), next = page.getByRole("button", { name: "Más títulos" });
      await expect(previous).toHaveAttribute("aria-disabled", "true"); await next.scrollIntoViewIfNeeded(); await next.click();
      await expect(track).toHaveAttribute("data-page", "1"); await expect(previous).toHaveAttribute("aria-disabled", "false");
      await previous.click(); await expect(track).toHaveAttribute("data-page", "0");
      await page.evaluate(() => { document.documentElement.style.fontSize = "32px"; });
      await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth)).toBe(width);
      await page.evaluate(() => { document.documentElement.style.fontSize = ""; });
      const first = links.first(); const title = (await first.textContent())!; await first.click();
      await expect(page).toHaveURL(/\/catalog\/editions\//); await expect(page.getByRole("heading", { level: 1, name: title, exact: true })).toBeVisible();
      await page.goBack(); await ready(page);
      // The footer: three short groups, the real payment methods and the legal line; no subject directory.
      const footer = page.locator("footer"); const footerNav = page.getByRole("navigation", { name: "Navegación del pie de página" });
      await expect(footerNav.getByRole("heading")).toHaveText(["Explorar", "Tu PLIEGO", "Ayuda"]);
      expect(await footerNav.getByRole("link").count()).toBeLessThanOrEqual(13);
      await expect(footer.getByRole("list", { name: "Métodos de pago" }).getByRole("img")).toHaveCount(4); await expect(footer.getByText("Transferencia bancaria")).toBeVisible();
      await expect(footer.getByText("© 2026-2026 PLIEGO", { exact: true })).toBeVisible();
      await footerNav.getByRole("link", { name: "Libros", exact: true }).click();
      await expect(page).toHaveURL(/\/catalog\?productType=PHYSICAL$/); await expect(page.getByTestId("site-header")).not.toHaveAttribute("data-home"); expect(errors).toEqual([]);
    });
  });
}

for (const scheme of ["light", "dark"] as const) {
  test(`Home recovery stays accessible at 320px / ${scheme}`, async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 844 }); await page.emulateMedia({ colorScheme: scheme, reducedMotion: "reduce" });
    await page.route("**/api/v1/auth/refresh", (route) => route.fulfill({ status: 204 }));
    let failed = true;
    await page.route("**/api/v1/storefront/navigation", (route) => failed ? route.fulfill({ status: 503, contentType: "application/problem+json", body: JSON.stringify({ status: 503, title: "Servicio no disponible", detail: "Revisa tu conexión e inténtalo otra vez." }) }) : route.continue());
    await page.goto("/"); const hero = page.locator('section[aria-labelledby="page-title"]');
    const retry = hero.getByRole("button", { name: "Reintentar", exact: true }); await expect(retry).toBeVisible({ timeout: 20_000 });
    await expect(page.locator(popular)).toHaveCount(0);
    await page.evaluate(() => document.fonts.ready); await accessible(page);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(320);
    failed = false; await retry.click();
    await expect(hero.getByRole("link")).toHaveText([/^Explorar libros/, /^Explorar eBooks/, /^Explorar audiolibros/]); await ready(page); await accessible(page);
    await page.evaluate(() => { document.documentElement.style.fontSize = "32px"; });
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth)).toBe(320);
  });
}
