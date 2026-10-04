import { expect, test, type Locator, type Page } from "@playwright/test";

const env = (globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env ?? {};
const output = "/tmp/pliego-redesign-legacy/";
test.skip(!env.PLIEGO_VISUAL_LIVE, "Set PLIEGO_VISUAL_LIVE=1 for public catalog visual verification.");

// Authentication/cart are fixtures; the public catalog and cover images remain real.
async function customerChrome(page: Page) {
  await page.route("**/api/v1/auth/refresh", (route) => route.fulfill({
    contentType: "application/json", body: JSON.stringify({ accessToken: "visual-fixture", tokenType: "Bearer", expiresInSeconds: 3600, user: { userId: "100", email: "visual@example.test", role: "CUSTOMER" } }),
  }));
  await page.route("**/api/v1/cart", (route) => route.fulfill({ contentType: "application/json", body: JSON.stringify({
    cartId: "visual-cart", state: "ACTIVE", totalCurrent: "2500.00",
    items: [50, 50, 25].map((quantity, index) => ({ cartItemId: String(index + 1), editionId: String(index + 42), title: "Edición de prueba", authors: "Autor", sku: `VISUAL-${index}`, coverUrl: null, quantity, currentPrice: "20.00", currentSubtotal: `${quantity * 20}.00`, available: true, unavailabilityReason: null })),
  }) }));
  await page.route("**/api/v1/me/favorites/status**", (route) => route.fulfill({ contentType: "application/json", body: JSON.stringify(new URL(route.request().url()).searchParams.getAll("editionIds").map((editionId) => ({ editionId, favorite: false }))) }));
  await page.route("**/api/v1/catalog/**", (route) => {
    const headers = { ...route.request().headers() };
    delete headers.authorization;
    return route.continue({ headers });
  });
}

async function decoded(page: Page) {
  await expect(page.locator("[data-bookcard]").first()).toBeVisible();
  await page.locator("img").evaluateAll((images) => images.forEach((image) => (image as HTMLImageElement).loading = "eager"));
  await page.evaluate(() => document.fonts.ready);
  await expect(page.locator(".cover-image--loading")).toHaveCount(0, { timeout: 30_000 });
}

async function unclipped(target: Locator, expansion = 0) {
  const violations = await target.evaluate((node, extra) => {
    const box = node.getBoundingClientRect();
    const errors: string[] = [];
    for (let ancestor = node.parentElement; ancestor; ancestor = ancestor.parentElement) {
      const style = getComputedStyle(ancestor);
      const bounds = ancestor.getBoundingClientRect();
      const clips = (overflow: string) => ["hidden", "clip", "auto", "scroll"].includes(overflow);
      if (clips(style.overflowX) && (box.left - extra < bounds.left - .75 || box.right + extra > bounds.right + .75)) errors.push(`horizontal: ${ancestor.className}`);
      if (clips(style.overflowY) && (box.top - extra < bounds.top - .75 || box.bottom + extra > bounds.bottom + .75)) errors.push(`vertical: ${ancestor.className}`);
    }
    return errors;
  }, expansion);
  expect(violations).toEqual([]);
}

async function headerState(page: Page, touch: boolean, path: string) {
  const header = page.getByTestId("site-header");
  const cart = header.getByRole("link", { name: "Carrito, 125 unidades" });
  const badge = header.getByTestId("header-cart-count");
  await expect(badge).toHaveText("99+");
  await unclipped(badge);
  await expect(cart).toHaveCSS("overflow", "visible");
  const bounds = await header.boundingBox();
  expect(bounds!.y).toBe(0);
  if (!touch) {
    await cart.hover();
    await unclipped(badge);
    await page.screenshot({ path: `${path}-header-hover.png` });
    await page.mouse.move(0, 0);
  }
  await cart.focus();
  await expect(cart).toBeFocused();
  await unclipped(cart, 5);
  await page.screenshot({ path: `${path}-header-focus.png` });
}

for (const theme of ["light", "dark"] as const) for (const width of [320, 375, 768, 1024, 1440, 1920]) for (const touch of [false, true]) {
  test.describe(`${theme} ${width}px ${touch ? "touch" : "mouse"}`, () => {
    test.use({ viewport: { width, height: width < 600 ? 844 : 1000 }, hasTouch: touch, isMobile: touch });
    test("visual polish preserves covers, header paint and product hierarchy", async ({ page }, testInfo) => {
      test.setTimeout(90_000);
      await page.emulateMedia({ colorScheme: theme, reducedMotion: "reduce" });
      await customerChrome(page);
      const measurements: unknown[] = [];
      for (const [surface, route] of [["home", "/"], ["catalog", "/catalog"]]) {
        const file = `${output}${surface}-${theme}-${width}-${touch ? "touch" : "mouse"}`;
        await page.goto(route);
        await decoded(page);
        await page.evaluate(() => scrollTo(0, 0));
        await expect(page.locator("html")).toHaveAttribute("data-mantine-color-scheme", theme);
        expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(width);
        if (surface === "home") {
          const collisions = await page.locator("main h1").evaluate((title) => {
            const box = title.getBoundingClientRect();
            return [...document.querySelectorAll("[data-position]")].filter((book) => {
              const rect = book.getBoundingClientRect();
              return rect.left < box.right && rect.right > box.left && rect.top < box.bottom && rect.bottom > box.top;
            }).length;
          });
          expect(collisions).toBe(0);
          for (const image of await page.locator("[data-position] img").all()) await unclipped(image);
        }
        await page.screenshot({ path: `${file}.png` });
        await page.screenshot({ path: `${file}-full.png`, fullPage: true });
        await headerState(page, touch, file);
        await page.evaluate(() => scrollTo(0, 400));
        await expect(page.getByTestId("site-header")).toHaveAttribute("data-scrolled", "true");
        await headerState(page, touch, `${file}-scroll`);
        const first = page.locator("[data-bookcard]").first();
        const link = first.locator("[data-bookcard-link]");
        await link.scrollIntoViewIfNeeded();
        if (!touch) await link.hover();
        await link.focus();
        await expect(link).toBeFocused();
        await unclipped(link, 5);
        const linkBounds = (await link.boundingBox())!;
        const headerBounds = (await page.getByTestId("site-header").boundingBox())!;
        expect(linkBounds.y).toBeGreaterThanOrEqual(headerBounds.y + headerBounds.height + 5);
        await unclipped(first.locator("img"));
        await page.screenshot({ path: `${file}-product-focus.png` });
        const geometry = await page.locator("[data-bookcard]").evaluateAll((cards) => cards.map((card) => {
          const media = card.querySelector("[data-bookcard-link] > div:first-child")!.getBoundingClientRect();
          const cover = card.querySelector("[data-bookcard-cover]")!.getBoundingClientRect();
          const frame = card.querySelector(".cover-frame")!;
          const image = card.querySelector<HTMLImageElement>("img")!;
          const title = card.querySelector("[data-bookcard-title]")!.getBoundingClientRect();
          return { width: media.width, height: media.height, coverWidth: cover.width, coverHeight: cover.height, inside: cover.left >= media.left && cover.right <= media.right && cover.top >= media.top && cover.bottom <= media.bottom, titleGap: title.top - media.bottom, ratio: cover.width / cover.height, fit: getComputedStyle(image).objectFit, background: getComputedStyle(frame).backgroundColor, naturalWidth: image.naturalWidth, naturalHeight: image.naturalHeight };
        }));
        for (const book of geometry) {
          expect(book.inside).toBe(true);
          expect(book.titleGap).toBeGreaterThanOrEqual(15);
          expect(book.ratio).toBeCloseTo(2 / 3, 2);
          expect(book.fit).toBe("contain");
          expect(book.background).toBe("rgba(0, 0, 0, 0)");
          expect(book.naturalWidth).toBeGreaterThan(0);
        }
        if (surface === "home") {
          expect(geometry[0].coverWidth / geometry[0].width).toBeGreaterThan(.65);
          const arrow = page.getByRole("button", { name: "Ver más libros" });
          await arrow.scrollIntoViewIfNeeded();
          if (touch) await arrow.tap(); else await arrow.click();
          await expect.poll(() => page.locator('[data-presentation="rail"]').evaluate((rail) => rail.scrollLeft)).toBeGreaterThan(0);
        }
        measurements.push({ surface, geometry });
        await page.getByRole("button", { name: "Buscar en el catálogo", exact: true }).click();
        const search = page.getByRole("searchbox", { name: "Buscar en el catálogo" });
        await expect(search).toBeFocused();
        await unclipped(page.getByRole("search", { name: "Catálogo" }), 4);
        await page.keyboard.press("Escape");
      }
      await testInfo.attach("cover-geometry", { body: JSON.stringify({ theme, width, touch, measurements }, null, 2), contentType: "application/json" });
    });
  });
}

test("all public covers remain complete in their canonical frames", async ({ page }, testInfo) => {
  test.setTimeout(90_000);
  await page.route("**/api/v1/auth/refresh", (route) => route.fulfill({ status: 204 }));
  const records: unknown[] = [];
  for (const pageIndex of [0, 1]) {
    await page.goto(`/catalog?pageSize=50&page=${pageIndex}`);
    await decoded(page);
    records.push(...await page.locator("[data-bookcard]").evaluateAll((cards) => cards.map((card) => {
      const image = card.querySelector<HTMLImageElement>("img")!;
      const frame = card.querySelector(".cover-frame")!;
      return { id: card.getAttribute("data-edition-id"), source: image.currentSrc, naturalWidth: image.naturalWidth, naturalHeight: image.naturalHeight, fit: getComputedStyle(image).objectFit, background: getComputedStyle(frame).backgroundColor };
    })));
  }
  expect(records.length).toBeGreaterThan(50);
  await testInfo.attach("all-public-cover-sources", { body: JSON.stringify(records, null, 2), contentType: "application/json" });
});
