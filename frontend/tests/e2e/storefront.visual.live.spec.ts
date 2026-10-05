import { expect, test } from "@playwright/test";
const output = "/tmp/pliego-redesign-legacy/";
const env = (globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env ?? {};
test.skip(!env.PLIEGO_VISUAL_LIVE, "Set PLIEGO_VISUAL_LIVE=1 for screenshots with the live catalog.");

for (const scheme of ["light", "dark"] as const) for (const width of [320, 375, 768, 1024, 1440, 1920]) {
  test(`storefront visual evidence ${width}px ${scheme}`, async ({ page }, testInfo) => {
    test.setTimeout(90_000);
    await page.emulateMedia({ colorScheme: scheme, reducedMotion: "reduce" });
    await page.setViewportSize({ width, height: width < 600 ? 844 : 1000 });
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    const measurements: unknown[] = [];
    for (const [name, route] of [["home", "/"], ["catalog", "/catalog"]]) {
      await page.goto(route);
      await expect(page.locator("[data-bookcard]").first()).toBeVisible();
      if (name === "home") await expect(page.getByRole("navigation", { name: "Explora por tema" }).getByRole("link").first()).toBeVisible();
      // Decode every real cover before the full-page capture, including lazy rows.
      await page.locator("img").evaluateAll((images) => images.forEach((image) => (image as HTMLImageElement).loading = "eager"));
      await page.evaluate(() => document.fonts.ready);
      await expect(page.locator(".cover-image--loading")).toHaveCount(0, { timeout: 30_000 });
      await page.evaluate(() => scrollTo(0, 0));
      await expect.poll(() => page.evaluate(() => scrollY)).toBe(0);
      await expect(page.getByTestId("site-header")).not.toHaveAttribute("data-scrolled", "true");
      await expect(page.locator("html")).toHaveAttribute("data-mantine-color-scheme", scheme);
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(width);
      const header = page.getByTestId("site-header");
      const bounds = await header.boundingBox();
      expect(bounds!.height).toBe(width >= 1280 ? 80 : 68);
      expect(bounds!.width).toBe(width);
      await page.screenshot({ path: `${output}${name}-${scheme}-${width}.png` });
      await page.screenshot({ path: `${output}${name}-${scheme}-${width}-full.png`, fullPage: true });
      measurements.push(await page.locator("main").evaluate((main, surface) => {
        const rectangle = (node: Element | null) => node?.getBoundingClientRect().toJSON();
        const title = main.querySelector("h1")!;
        const titleStyle = getComputedStyle(title);
        return {
          surface, viewport: innerWidth, header: rectangle(document.querySelector("header")),
          title: rectangle(title), titleSize: titleStyle.fontSize, titleLineHeight: titleStyle.lineHeight,
          grid: rectangle(main.querySelector(".edition-grid")),
          columns: main.querySelector(".edition-grid") ? getComputedStyle(main.querySelector(".edition-grid")!).gridTemplateColumns : null,
          card: rectangle(main.querySelector("[data-bookcard]")),
          overflow: document.documentElement.scrollWidth - innerWidth,
          duplicateSearch: main.querySelectorAll('[role="search"], input[type="search"]').length,
          visibleControls: [...main.querySelectorAll<HTMLElement>("button,input,select,a")].filter((node) => {
            const rect = node.getBoundingClientRect();
            return rect.width > 0 && rect.height > 0 && rect.left < innerWidth && rect.right > 0 && rect.top < innerHeight && rect.bottom > 0 && getComputedStyle(node).visibility !== "hidden" && getComputedStyle(node).opacity !== "0";
          }).length,
          renderedCovers: main.querySelectorAll("img.cover-image").length,
          failedCovers: main.querySelectorAll(".book-cover--fallback").length,
        };
      }, name));
      await page.evaluate(() => scrollTo(0, 400));
      await expect(header).toHaveAttribute("data-scrolled", "true");
      expect((await header.boundingBox())!.y).toBe(0);
      await page.screenshot({ path: `${output}${name}-${scheme}-${width}-scroll.png` });
    }
    await page.getByRole("button", { name: "Buscar libros en el catálogo", exact: true }).click();
    const search = page.getByRole("dialog", { name: "Buscar en el catálogo" });
    await expect(search.getByRole("searchbox")).toBeFocused();
    await search.getByRole("searchbox").fill("cien");
    await expect(search.getByRole("link", { name: /Cien años de soledad/ })).toBeVisible();
    await page.screenshot({ path: `${output}search-${scheme}-${width}.png` });
    const searchBounds = (await search.boundingBox())!;
    expect(searchBounds.x).toBeGreaterThanOrEqual(0);
    expect(searchBounds.x + searchBounds.width).toBeLessThanOrEqual(width);
    await page.keyboard.press("Escape");
    await expect(page.getByRole("button", { name: "Buscar libros en el catálogo", exact: true })).toBeFocused();
    await page.getByRole("button", { name: width >= 1280 ? "Literatura" : "Abrir navegación", exact: true }).click();
    const categories = width >= 1280 ? page.locator("#categorias-escritorio") : page.getByRole("dialog", { name: "Categorías", exact: true });
    if (width < 1280) await categories.getByRole("button", { name: "Literatura", exact: true }).click();
    await expect(categories.getByRole("link", { name: "Ver todos los libros de Literatura" })).toBeVisible();
    await categories.locator("img").evaluateAll((images) => images.forEach((image) => (image as HTMLImageElement).loading = "eager"));
    await expect(categories.locator(".cover-image--loading")).toHaveCount(0, { timeout: 30_000 });
    await page.screenshot({ path: `${output}categories-${scheme}-${width}.png` });
    const categoryBounds = (await categories.boundingBox())!;
    expect(categoryBounds.x).toBeGreaterThanOrEqual(0);
    expect(categoryBounds.x + categoryBounds.width).toBeLessThanOrEqual(width);
    await page.keyboard.press("Escape");
    expect(errors).toEqual([]);
    await testInfo.attach(`measurements-${scheme}-${width}`, { body: JSON.stringify({ width, scheme, measurements, errors }, null, 2), contentType: "application/json" });
  });
}
