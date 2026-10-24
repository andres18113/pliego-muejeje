import { expect, test, type Page } from "@playwright/test";
import { storefrontNavigationFixture } from "../../src/test/storefrontFixture";

const synopsis = Array.from({ length: 40 }, (_, index) => `Párrafo ${index + 1} de una sinopsis larga para recorrer la página.`).join(" ");
const edition = {
  editionId: "42", bookId: "1", sku: "PAPER-42", title: "50 experimentos imprescindibles para entender la psicología social", subtitle: null,
  authors: [{ name: "Autora Prueba", order: 1 }], publisher: { name: "Editorial" }, categories: [], isbn13: "9788491044338", pageCount: 312,
  price: "25.95", coverUrl: null, coverLicense: null, coverAttribution: null, coverSourceUrl: null, format: "PAPERBACK", language: "es",
  available: true, ebookFileFormat: null, audioDurationSeconds: null, narrators: [], offer: null, synopsis, publicationDate: null,
};

async function mockEdition(page: Page) {
  await page.route("**/api/v1/**", route => {
    const url = new URL(route.request().url());
    if (url.pathname.endsWith("/auth/refresh")) return route.fulfill({ status: 204 });
    if (url.pathname.endsWith("/storefront/navigation")) return route.fulfill({ json: storefrontNavigationFixture });
    if (url.pathname.endsWith("/catalog/editions/42")) return route.fulfill({ json: edition });
    return route.fulfill({ json: { items: [], page: 0, pageSize: 20, totalCount: "0" } });
  });
}

const frames = (page: Page) => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));

for (const [width, barHeight] of [[1440, 72], [1024, 60], [390, 56]] as const) {
  test(`the edition hands over from header to context bar in place, as product pages do, at ${width}px`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 800 });
    await mockEdition(page);
    await page.goto("/catalog");
    await page.goto("/catalog/editions/42");
    const header = page.getByTestId("site-header");
    const bar = page.getByRole("region", { name: "Resumen del libro" });
    // The page's own arrow: the one that leads the wayfinding row, never the bar's.
    const row = page.getByRole("navigation", { name: "Ruta de navegación" }).locator("..").getByRole("button", { name: "Volver atrás" });
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();

    // Top: the usual header with the wordmark alone; the arrow under it, on the content edge; no bar.
    await expect(header.getByRole("button", { name: "Volver atrás" })).toHaveCount(0);
    await expect(row).toBeVisible();
    await expect(bar).toHaveCount(0);
    const headerAtTop = (await header.boundingBox())!;
    expect((await row.boundingBox())!.y).toBeGreaterThanOrEqual(headerAtTop.y + headerAtTop.height);
    await page.screenshot({ path: testInfo.outputPath(`top-${width}.png`) });
    const headingTop = await page.getByRole("heading", { level: 1 }).evaluate(node => node.getBoundingClientRect().top + window.scrollY);

    // Scrolling down in small steps: the header leaves with the page and never compacts; the bar exists exactly
    // when the wayfinding row has left the viewport, and is then already at its fixed place — no slide, no fade.
    let appearedAt = -1;
    for (let y = 0; y <= 600; y += 16) {
      await page.evaluate(top => window.scrollTo(0, top), y);
      await frames(page);
      const rowBottom = await row.evaluate(node => node.getBoundingClientRect().bottom);
      expect((await header.boundingBox())!.height).toBe(headerAtTop.height);
      const present = await bar.count();
      expect(present).toBe(rowBottom <= 0 ? 1 : 0);
      if (present) {
        if (appearedAt < 0) appearedAt = y;
        const box = (await bar.boundingBox())!;
        expect([box.y, box.height, box.width]).toEqual([0, barHeight, width]);
        expect(await bar.evaluate(node => { const style = getComputedStyle(node); return [style.transform, style.opacity, style.transitionDuration]; }))
          .toEqual(["none", "1", "0s"]);
      }
    }
    expect(appearedAt).toBeGreaterThan(0);
    // The header scrolled away with the page instead of staying under the bar.
    expect((await header.boundingBox())!.y + headerAtTop.height).toBeLessThanOrEqual(0);
    await expect(bar.getByRole("button", { name: "Volver atrás" })).toBeVisible();
    await expect(bar.getByText(edition.title)).toBeVisible();
    await expect(bar.getByText("$ 25,95")).toBeVisible();
    await expect(bar.locator(".book-cover")).toBeVisible();
    expect(await page.getByRole("heading", { level: 1 }).evaluate(node => node.getBoundingClientRect().top + window.scrollY)).toBe(headingTop);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    expect(await bar.evaluate(node => getComputedStyle(node).backgroundColor)).toBe(await header.evaluate(node => getComputedStyle(node).backgroundColor));
    await page.screenshot({ path: testInfo.outputPath(`scrolled-${width}.png`) });

    // Back up in the same steps: the bar is gone the moment the row returns; the header comes back with the scroll.
    for (let y = 600; y >= 0; y -= 16) {
      await page.evaluate(top => window.scrollTo(0, top), y);
      await frames(page);
      const rowBottom = await row.evaluate(node => node.getBoundingClientRect().bottom);
      expect(await bar.count()).toBe(rowBottom <= 0 ? 1 : 0);
    }
    await page.evaluate(() => window.scrollTo(0, 0));
    await frames(page);
    await expect(bar).toHaveCount(0);
    await expect(header.getByRole("link", { name: "PLIEGO, ir al inicio" })).toBeVisible();
    expect((await header.boundingBox())!.y).toBe(0);

    // The bar's arrow keeps the back function.
    await page.evaluate(() => window.scrollTo(0, 600));
    await bar.getByRole("button", { name: "Volver atrás" }).click();
    await expect(page).toHaveURL(/\/catalog$/);
  });
}

test("the context bar follows the header surface in dark mode", async ({ page }, testInfo) => {
  await page.emulateMedia({ colorScheme: "dark" });
  await page.setViewportSize({ width: 1280, height: 800 });
  await mockEdition(page);
  await page.goto("/catalog/editions/42");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await page.evaluate(() => window.scrollTo(0, 700));
  const bar = page.getByRole("region", { name: "Resumen del libro" });
  await expect(bar).toBeVisible();
  expect(await bar.evaluate(node => getComputedStyle(node).backgroundColor))
    .toBe(await page.getByTestId("site-header").evaluate(node => getComputedStyle(node).backgroundColor));
  await page.screenshot({ path: testInfo.outputPath("scrolled-dark.png") });
});
