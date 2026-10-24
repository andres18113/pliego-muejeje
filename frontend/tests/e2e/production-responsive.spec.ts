import { chromium, expect, test, type Page } from "@playwright/test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { storefrontNavigationFixture } from "../../src/test/storefrontFixture";

async function mockOffers(page: Page) {
  const edition = { editionId: "42", bookId: "1", title: "Edición con oferta", authors: "Autora", publisher: "Editorial", isbn13: null, price: "8.00", coverUrl: null, coverLicense: null, coverAttribution: null, format: "EBOOK", language: "es", available: true, ebookFileFormat: "EPUB", audioDurationSeconds: null, narrators: [], offer: { offerId: "1", originalPrice: "10.00", discountAmount: "2.00", effectivePrice: "8.00", savingsAmount: "2.00", savingsPercent: "20.00", startsAt: "2026-10-01T00:00:00Z", endsAt: "2026-11-01T00:00:00Z", daysRemaining: 2, endingSoon: true } };
  await page.route("**/api/v1/**", route => {
    const url = new URL(route.request().url());
    if (url.pathname.endsWith("/auth/refresh")) return route.fulfill({ status: 204 });
    const body = url.pathname.endsWith("/storefront/navigation") ? storefrontNavigationFixture
      : url.pathname.endsWith("/filter-options") ? { productTypes: [{ code: "EBOOK", label: "eBooks", count: "8" }], categories: [], sorts: [{ code: "RELEVANCE", label: "Relevancia" }], totalCount: "8", endingSoonDays: 3, timezone: "America/Guayaquil" }
      : { items: Array.from({ length: 8 }, (_, i) => ({ ...edition, editionId: String(42 + i) })), page: 0, pageSize: 50, totalCount: "8" };
    return route.fulfill({ contentType: "application/json", body: JSON.stringify(body) });
  });
}

// chrome.tabs.setZoom changes desktop zoom: 640×756 becomes 320×378 CSS px at 200%,
// with DPR 2. CDP pinch zoom and enlarged fonts do not reproduce this layout behavior.
async function withDesktopZoom(baseURL: string, width: number, height: number, zoom: number, run: (page: Page) => Promise<void>) {
  const scratch = await mkdtemp(join(tmpdir(), "pliego-responsive-"));
  const extension = join(scratch, "zoom");
  await mkdir(extension);
  await writeFile(join(extension, "manifest.json"), JSON.stringify({ manifest_version: 3, name: "PLIEGO regression zoom", version: "1.0", permissions: ["tabs"], background: { service_worker: "worker.js" } }));
  await writeFile(join(extension, "worker.js"), "chrome.runtime.onInstalled.addListener(() => {});");
  const context = await chromium.launchPersistentContext(join(scratch, "profile"), {
    channel: "chromium", headless: true, viewport: { width, height }, baseURL,
    // Preserve the native classic scrollbar that Playwright normally hides in headless Chromium.
    ignoreDefaultArgs: ["--hide-scrollbars", "--disable-extensions"],
    args: ["--disable-features=OverlayScrollbar", `--disable-extensions-except=${extension}`, `--load-extension=${extension}`],
    env: { ...process.env, XDG_CONFIG_HOME: scratch, XDG_CACHE_HOME: scratch },
  });
  try {
    const worker = context.serviceWorkers()[0] ?? await context.waitForEvent("serviceworker");
    const page = await context.newPage();
    await mockOffers(page); await page.goto("/ofertas");
    await expect(page.getByRole("heading", { name: "Edición con oferta" }).first()).toBeVisible();
    await expect(page.getByRole("button", { name: "eBooks (8)" })).toBeVisible();
    // Reserve vertical scrolling even on short fixtures; do not suppress horizontal overflow.
    await page.addStyleTag({ content: "html { overflow-y: scroll; }" });
    const appliedZoom = await worker.evaluate(`(async () => {
      const tabs = await chrome.tabs.query({});
      const tab = tabs.find(tab => tab.url?.endsWith('/ofertas'));
      await chrome.tabs.setZoom(tab.id, ${zoom});
      return chrome.tabs.getZoom(tab.id);
    })()`);
    expect(appliedZoom).toBe(zoom);
    await expect.poll(() => page.evaluate(() => innerWidth)).toBe(width / zoom);
    await run(page);
  } finally { await context.close(); await rm(scratch, { recursive: true, force: true }); }
}

async function assertUsableWidth(page: Page) {
  const dimensions = await page.evaluate(() => ({ innerWidth, innerHeight, dpr: devicePixelRatio, clientWidth: document.documentElement.clientWidth, scrollWidth: document.documentElement.scrollWidth }));
  console.log("MOB-01 dimensions", dimensions);
  expect(dimensions.clientWidth).toBeLessThan(dimensions.innerWidth);
  expect(dimensions.scrollWidth).toBeLessThanOrEqual(dimensions.clientWidth);
  const boxes: { name: string; x: number; y: number; width: number; height: number }[] = [];
  for (const control of await page.getByTestId("site-header").locator("a, button").all()) {
    if (!await control.isVisible() || await control.textContent() === "Saltar al contenido") continue;
    const box = (await control.boundingBox())!;
    const name = await control.getAttribute("aria-label") ?? await control.innerText();
    expect(box.x, name).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width, name).toBeLessThanOrEqual(dimensions.clientWidth);
    boxes.push({ name, ...box });
  }
  for (const [index, box] of boxes.entries()) {
    for (const other of boxes.slice(index + 1)) {
      const overlaps = box.x < other.x + other.width && other.x < box.x + box.width
        && box.y < other.y + other.height && other.y < box.y + box.height;
      expect(overlaps, `${box.name} overlaps ${other.name}`).toBe(false);
    }
  }
  for (const root of ["html", "body"]) {
    const overflow = await page.locator(root).evaluate(node => getComputedStyle(node).overflowX);
    expect(["hidden", "clip"]).not.toContain(overflow);
  }
}

async function assertHeaderKeyboard(page: Page, width: number) {
  const header = page.getByTestId("site-header");
  const search = header.getByRole("button", { name: "Buscar libros en el catálogo" });
  await search.focus(); await page.keyboard.press("Enter");
  await expect(page.getByRole("searchbox", { name: "Buscar en el catálogo" })).toBeFocused();
  await page.keyboard.press("Escape"); await expect(search).toBeFocused();
  await page.keyboard.press("Tab"); await expect(header.getByRole("link", { name: "Carrito", exact: true })).toBeFocused();
  await page.keyboard.press("Tab"); await expect(header.getByRole("link", { name: "Iniciar sesión", exact: true })).toBeFocused();
  if (width < 960) {
    const menu = header.getByRole("button", { name: "Abrir navegación" });
    await menu.focus(); await page.keyboard.press("Enter");
    await expect(page.getByRole("dialog", { name: "Navegación", exact: true }).getByRole("link")).toHaveText(["Libros", "eBooks", "Audiolibros", "Ofertas", "Ayuda"]);
    await page.keyboard.press("Escape"); await expect(menu).toBeFocused();
  } else await expect(header.getByRole("navigation", { name: "Navegación principal" }).getByRole("link")).toHaveText(["Libros", "eBooks", "Audiolibros", "Ofertas", "Ayuda"]);
}

test("MOB-01 offers reflow at 320 CSS px, real 200% zoom and classic scrollbar", async ({ baseURL }) => {
  await withDesktopZoom(baseURL!, 640, 756, 2, async page => {
    expect(await page.evaluate(() => ({ width: innerWidth, height: innerHeight, dpr: devicePixelRatio }))).toEqual({ width: 320, height: 378, dpr: 2 });
    await page.screenshot({ path: test.info().outputPath("offers-320-zoom200.png") });
    await assertUsableWidth(page);
    await page.evaluate(() => scrollTo(0, 200));
    await expect(page.getByTestId("site-header")).toHaveAttribute("data-scrolled", "true");
    await assertUsableWidth(page); await assertHeaderKeyboard(page, 320);
  });
});

for (const width of [320, 390, 768, 1280]) test(`MOB-01 controls and keyboard remain usable at ${width}px with classic scrollbar`, async ({ baseURL }) => {
  await withDesktopZoom(baseURL!, width, 900, 1, async page => { await assertUsableWidth(page); await assertHeaderKeyboard(page, width); });
});
