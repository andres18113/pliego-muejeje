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

/** The floating pill's place: inset from the viewport's edges (32px, 24px below 1024px, 8px on phones), fully round. */
function pill(width: number) {
  const [top, side, height] = width < 600 ? [8, 8, 56] : width < 1024 ? [16, 24, 64] : [16, 32, 64];
  const span = Math.min(width - 2 * side, 1760);
  return { x: (width - span) / 2, y: top, width: span, height };
}

const frames = (page: Page) => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));

for (const width of [1440, 1024, 390] as const) {
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
        expect(box).toEqual(pill(width));
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
    // A light floating pill: fully round, on the white card surface; no jacket competes with the title.
    await expect(bar.locator(".book-cover")).toHaveCount(0);
    expect(Number.parseFloat(await bar.evaluate(node => getComputedStyle(node).borderTopLeftRadius))).toBeGreaterThanOrEqual(pill(width).height / 2);
    // The one addition: the scene's own action, here a guest's way in ("Iniciar sesión" on phones).
    await expect(bar.getByRole("link", { name: width < 600 ? "Iniciar sesión" : "Iniciar sesión para agregar" })).toBeVisible();
    expect(await page.getByRole("heading", { level: 1 }).evaluate(node => node.getBoundingClientRect().top + window.scrollY)).toBe(headingTop);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    expect(await bar.evaluate(node => getComputedStyle(node).backgroundColor)).toBe("rgb(255, 255, 255)");
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

/** The long synopsis opened in full, so the page has a long lower part to scroll through. */
async function openSynopsis(page: Page) {
  await page.locator("[aria-controls='synopsis-text']").click();
  await page.evaluate(() => window.scrollTo(0, 0));
}

const offer = { offerId: "7", originalPrice: "32.00", discountAmount: "6.05", effectivePrice: "25.95", savingsAmount: "6.05", savingsPercent: "18.91",
  startsAt: "2026-10-01T00:00:00Z", endsAt: "2026-12-31T00:00:00Z", daysRemaining: 60, endingSoon: false };

/** A signed-in customer and a server cart; every amount comes from these responses, never from the page. */
async function mockCustomer(page: Page, state: { quantity: number; posts: number; fail?: boolean }, detail: Record<string, unknown>) {
  await page.route("**/api/v1/**", route => {
    const path = new URL(route.request().url()).pathname;
    const json = (body: unknown) => route.fulfill({ json: body });
    if (path.endsWith("/auth/refresh")) return json({ accessToken: "t", tokenType: "Bearer", expiresInSeconds: 1800, user: { userId: "100", email: "c@example.invalid", role: "CUSTOMER" } });
    if (path.endsWith("/storefront/navigation")) return json(storefrontNavigationFixture);
    if (path.endsWith("/catalog/editions/42")) return json(detail);
    if (path.endsWith("/me/favorites/status")) return json({ items: [{ editionId: "42", favorite: false }] });
    if (path.endsWith("/cart/items") && route.request().method() === "POST") {
      state.posts++;
      if (state.fail) return route.fulfill({ status: 409, json: { type: "urn:pliego:problem:P2050", code: "P2050", status: 409, title: "No pudimos agregar la edición", detail: "No queda stock suficiente para esa cantidad." } });
      state.quantity += 1;
      return json({ cartItemId: "100", quantity: state.quantity });
    }
    if (path.endsWith("/cart")) {
      const q = state.quantity;
      const money = (value: number) => value.toFixed(2);
      const items = q ? [{ cartItemId: "100", editionId: "42", title: edition.title, authors: "Autora Prueba", sku: "PAPER-42", coverUrl: null, quantity: q,
        currentPrice: "25.95", currentSubtotal: money(25.95 * q), originalPrice: "32.00", unitSavings: "6.05", originalSubtotal: money(32 * q), lineSavings: money(6.05 * q),
        available: true, requiresPhysicalFulfillment: true, quantityEditable: true, format: "PAPERBACK", unavailabilityReason: null }] : [];
      return json({ cartId: "40", state: "ACTIVE", requiresPhysicalFulfillment: q > 0, physicalItemCount: q, digitalItemCount: 0, items,
        totalCurrent: money(25.95 * q), originalSubtotal: money(32 * q), savingsTotal: money(6.05 * q), currentSubtotal: money(25.95 * q),
        subtotal: money(25.95 * q), taxRate: "0.00", taxAmount: "0.00", shippingAmount: "0.00", total: money(25.95 * q) });
    }
    return json({ items: [], page: 0, pageSize: 20, totalCount: "0" });
  });
}

for (const width of [1280, 360] as const) {
  test(`the bar keeps its place through the whole page and adds with the scene's own cart at ${width}px`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 800 });
    const state = { quantity: 0, posts: 0 };
    await mockCustomer(page, state, { ...edition, offer });
    await page.goto("/catalog/editions/42");
    const scene = page.getByRole("region", { name: "Compra" });
    const bar = page.getByRole("region", { name: "Resumen del libro" });
    const row = page.getByRole("navigation", { name: "Ruta de navegación" }).locator("..").getByRole("button", { name: "Volver atrás" });
    const label = width < 600 ? "Agregar" : "Agregar al carrito";
    await expect(scene.getByRole("button", { name: "Agregar al carrito" })).toBeVisible();
    await openSynopsis(page);
    await expect(scene.locator("s")).toHaveText("$ 32,00");
    const headingTop = await page.getByRole("heading", { level: 1 }).evaluate(node => node.getBoundingClientRect().top + window.scrollY);
    const bottom = await page.evaluate(() => document.documentElement.scrollHeight - window.innerHeight);

    // Top: no bar. Middle and bottom: the same bar, in the same place, with its one added action.
    await expect(bar).toHaveCount(0);
    for (const [name, y] of [["middle", Math.round(bottom / 2)], ["bottom", bottom]] as const) {
      await page.evaluate(top => window.scrollTo(0, top), y);
      await frames(page);
      await expect(bar).toBeVisible();
      expect(await bar.boundingBox()).toEqual(pill(width));
      await expect(bar.getByRole("button", { name: "Volver atrás" })).toBeVisible();
      await expect(bar.getByText(edition.title)).toBeVisible();
      await expect(bar.getByText("$ 25,95")).toBeVisible();
      // The previous price is struck beside it where the bar has room, as it was designed.
      await expect(bar.locator("s")).toBeVisible({ visible: width >= 600 });
      await expect(bar.locator(".book-cover")).toHaveCount(0);
      await expect(bar.getByRole("button", { name: label, exact: true })).toBeVisible();
      // Nothing in the pill overlaps or leaves it: arrow and title, then price and action, side by side inside its edge.
      const boxes = await bar.evaluate(node => [...node.firstElementChild!.querySelectorAll(":scope > div > *")].map(child => child.getBoundingClientRect()).map(box => [box.left, box.right]));
      boxes.slice(1).forEach(([left], index) => expect(left).toBeGreaterThanOrEqual(boxes[index][1] - 0.5));
      const edge = pill(width);
      expect(boxes[0][0]).toBeGreaterThanOrEqual(edge.x);
      expect(boxes[boxes.length - 1][1]).toBeLessThanOrEqual(edge.x + edge.width - 4);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
      await page.screenshot({ path: testInfo.outputPath(`${name}-${width}.png`) });
    }

    // Back up in small steps: the bar stays until the page's own row (and the scene beside or under it) returns.
    for (let y = bottom; y >= 0; y -= 24) {
      await page.evaluate(top => window.scrollTo(0, top), y);
      await frames(page);
      const rowBottom = await row.evaluate(node => node.getBoundingClientRect().bottom);
      expect(await bar.count()).toBe(rowBottom <= 0 ? 1 : 0);
    }
    await page.evaluate(() => window.scrollTo(0, 0));
    await frames(page);
    await expect(bar).toHaveCount(0);
    await expect(scene.getByRole("button", { name: "Agregar al carrito" })).toBeInViewport();
    expect(await page.getByRole("heading", { level: 1 }).evaluate(node => node.getBoundingClientRect().top + window.scrollY)).toBe(headingTop);

    // From the bottom, the bar adds through the scene's mutation; the cart answers with the server's lines and saving.
    await page.evaluate(top => window.scrollTo(0, top), bottom);
    await bar.getByRole("button", { name: label, exact: true }).click();
    await expect.poll(() => state.posts).toBe(1);
    const drawer = page.getByRole("dialog", { name: "Tu carrito" });
    await expect(drawer).toBeVisible();
    await expect(drawer.locator("s")).toHaveText(/\$\s32,00/);
    await expect(drawer.getByText("Ahorro total hoy")).toBeVisible();
    await expect(drawer.locator("dl").getByText("$ 25,95")).toBeVisible();
    // The scene shares the outcome: one add, one confirmation.
    await expect(scene.getByRole("link", { name: "Ver carrito" })).toBeAttached();
  });
}

test("a failed add from the bar brings the purchase scene and its explanation back into view", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  const state = { quantity: 0, posts: 0, fail: true };
  await mockCustomer(page, state, edition);
  await page.goto("/catalog/editions/42");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await openSynopsis(page);
  await page.evaluate(() => window.scrollTo(0, 1400));
  const bar = page.getByRole("region", { name: "Resumen del libro" });
  await bar.getByRole("button", { name: "Agregar al carrito" }).click();
  const scene = page.getByRole("region", { name: "Compra" });
  await expect(scene.getByRole("alert").or(scene.getByRole("status")).filter({ hasText: /stock|disponible/i }).first()).toBeInViewport();
  await expect(bar).toHaveCount(0);
  await expect(page.getByRole("dialog", { name: "Tu carrito" })).toHaveCount(0);
});

test("an unavailable edition keeps its price in the bar and says it is not available, with no action", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await mockCustomer(page, { quantity: 0, posts: 0 }, { ...edition, available: false });
  await page.goto("/catalog/editions/42");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await openSynopsis(page);
  await page.evaluate(() => window.scrollTo(0, 1400));
  const bar = page.getByRole("region", { name: "Resumen del libro" });
  await expect(bar.getByText("No disponible", { exact: true })).toBeVisible();
  await expect(bar.getByRole("button", { name: "Agregar al carrito" })).toHaveCount(0);
});

test("the floating bar takes the card tone in dark mode", async ({ page }, testInfo) => {
  await page.emulateMedia({ colorScheme: "dark" });
  await page.setViewportSize({ width: 1280, height: 800 });
  await mockEdition(page);
  await page.goto("/catalog/editions/42");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await page.evaluate(() => window.scrollTo(0, 700));
  const bar = page.getByRole("region", { name: "Resumen del libro" });
  await expect(bar).toBeVisible();
  // The dark scheme's card tone, one step lighter than the page, as PLIEGO's white cards are in light.
  expect(await bar.evaluate(node => getComputedStyle(node).backgroundColor)).toBe("rgb(43, 45, 71)");
  await page.screenshot({ path: testInfo.outputPath("scrolled-dark.png") });
});
