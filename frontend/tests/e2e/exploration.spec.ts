import { expect, test, type Page } from "@playwright/test";

const categories = [
  { slug: "filosofia", name: "Filosofía", parentSlug: null },
  { slug: "literatura", name: "Literatura", parentSlug: null },
  { slug: "matematicas", name: "Matemáticas", parentSlug: null },
];
const edition = { editionId: "42", bookId: "17", title: "Cien años de soledad", authors: "Gabriel García Márquez", publisher: "Editorial Sur", isbn13: "9780306406157", price: "20.00", coverUrl: null, coverLicense: null, coverAttribution: null, format: "PAPERBACK", language: "es", available: true };
async function mock(page: Page, varied = false) {
  await page.route("**/api/v1/**", (route) => {
    const url = new URL(route.request().url());
    if (url.pathname.endsWith("/auth/refresh")) return route.fulfill({ status: 204 });
    const body = url.pathname.endsWith("/categories") ? { items: categories }
      : url.pathname.endsWith("/filter-options") ? { languages: varied ? ["en", "es"] : ["es"], formats: ["HARDCOVER", "PAPERBACK"], minimumPrice: varied ? "5.00" : "20.00", maximumPrice: varied ? "80.00" : "20.00" }
      : { items: Array.from({ length: Number(url.searchParams.get("pageSize") ?? 20) }, (_, index) => ({ ...edition, editionId: String(index + 42), title: `${edition.title} ${index + 1}` })), page: Number(url.searchParams.get("page") ?? 0), pageSize: Number(url.searchParams.get("pageSize") ?? 20), totalCount: "55" };
    return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(body) });
  });
}
async function reflow(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(page.viewportSize()!.width);
  const names = await page.getByRole("main").locator('button,a,input,select').evaluateAll((elements) => elements.filter((node) => (node as HTMLElement).offsetParent !== null).map((node) => ({ tag: node.tagName, width: node.getBoundingClientRect().width, height: node.getBoundingClientRect().height })));
  expect(names.filter((control) => control.tag === "BUTTON").every((control) => control.height >= 44)).toBe(true);
}

for (const scheme of ["light", "dark"] as const) for (const width of [320, 375, 768, 1024, 1440, 1920]) {
  test(`Home and catalog hierarchy, real facets, keyboard and enlarged text ${width}px / ${scheme}`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: scheme, reducedMotion: "reduce" });
    await page.setViewportSize({ width, height: 1000 }); await mock(page);
    await page.goto("/");
    const main = page.getByRole("main");
    await expect(main.getByRole("link", { name: "Explorar catálogo", exact: true })).toHaveCount(0);
    await expect(main.getByRole("link", { name: "Explorar catálogo completo" })).toHaveCount(0);
    await expect(main.getByRole("link", { name: "Ver categorías" })).toHaveCount(0);
    await expect(main.locator("[data-bookcard]")).toHaveCount(8);
    await reflow(page);
    await main.getByRole("navigation", { name: "Explora por tema" }).getByRole("link", { name: "Literatura", exact: true }).click();
    await expect(page).toHaveURL(/category=literatura/);
    await expect(main.getByRole("searchbox")).toHaveCount(0);
    await expect(main.getByRole("navigation", { name: "Temas del catálogo" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Quitar Literatura" })).toBeVisible();
    await expect(page.getByRole("combobox", { name: "Ordenar por" })).toHaveCount(0);
    const trigger = page.getByRole("button", { name: /^Filtros/ });
    await trigger.focus(); await page.keyboard.press("Enter");
    const surface = page.getByRole("dialog", { name: "Filtros del catálogo" });
    await expect(surface).toBeVisible();
    await expect(surface.getByRole("button", { name: "Idioma", exact: true })).toHaveCount(0);
    await expect(surface.getByRole("button", { name: "Precio (USD)" })).toHaveCount(0);
    await surface.getByRole("radio", { name: "Tapa dura" }).focus(); await page.keyboard.press("Space");
    await surface.getByRole("button", { name: "Aplicar filtros" }).click();
    await expect(page).toHaveURL(/category=literatura&format=HARDCOVER/);
    await expect(page.getByRole("button", { name: "Quitar Tapa dura" })).toBeVisible();
    await expect(page.getByRole("button", { name: /^Filtros/ })).toBeFocused();
    await reflow(page);
    // 200% text keeps hierarchy, controls and card facts readable without horizontal scroll.
    await page.evaluate(() => document.documentElement.style.fontSize = "32px");
    await reflow(page);
    await page.getByRole("button", { name: /^Filtros/ }).click();
    await reflow(page);
    await surface.getByRole("button", { name: "Restablecer filtros" }).click();
    await expect(page).toHaveURL(/\/catalog$/);
    await page.evaluate(() => document.documentElement.style.fontSize = "16px");
    await page.getByRole("link", { name: "Siguiente", exact: true }).click();
    await expect(page).toHaveURL(/page=1/);
    await expect(page.getByRole("region", { name: "Resultados", exact: true })).toBeFocused();
    await page.goBack(); await expect(page).not.toHaveURL(/page=1/);
    await expect(page.getByRole("main").getByRole("searchbox")).toHaveCount(0);
  });
}

test("filters and order preserve URL context, drafts can be cancelled, price decimals are normalized", async ({ page }) => {
  await mock(page, true); await page.setViewportSize({ width: 375, height: 900 });
  await page.goto("/catalog?que=Cien&category=literatura&sort=PRICE_DESC&page=2");
  await page.getByRole("button", { name: /^Filtros/ }).click();
  const dialog = page.getByRole("dialog", { name: "Filtros del catálogo" });
  await dialog.getByRole("radio", { name: "Tapa dura" }).check();
  await page.keyboard.press("Escape");
  await expect(page).not.toHaveURL(/format=/);
  await page.getByRole("button", { name: /^Filtros/ }).click();
  await expect(dialog.getByRole("radio", { name: "Todos los formatos" })).toBeChecked();
  await dialog.getByRole("button", { name: "Precio (USD)" }).click();
  await dialog.getByLabel("Precio mínimo").fill("9,25");
  await dialog.getByRole("button", { name: "Aplicar filtros" }).click();
  await expect(page).toHaveURL(/que=Cien&category=literatura&minPrice=9.25&sort=PRICE_DESC$/);
  await page.reload();
  await expect(page.getByRole("main").getByRole("searchbox")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Quitar Búsqueda: Cien" })).toBeVisible();
  await expect(page.getByRole("combobox", { name: "Ordenar por" })).toHaveValue("PRICE_DESC");
  await page.getByRole("button", { name: /^Quitar.*9/ }).click();
  await expect(page).toHaveURL(/que=Cien&category=literatura&sort=PRICE_DESC$/);
});

test("touch topic navigation, filter selection and search work at 320 and 375px", async ({ browser }) => {
  const context = await browser.newContext({ hasTouch: true, isMobile: true, viewport: { width: 375, height: 900 } });
  const page = await context.newPage(); await mock(page);
  for (const width of [320, 375]) {
    await page.setViewportSize({ width, height: 900 }); await page.goto("http://127.0.0.1:5173/");
    const rail = page.locator('[data-presentation="rail"]');
    await expect(rail).toBeVisible();
    await page.bringToFront();
    await page.evaluate(() => document.fonts.ready);
    await rail.scrollIntoViewIfNeeded();
    await page.waitForTimeout(150);
    const box = (await rail.boundingBox())!;
    const session = await context.newCDPSession(page);
    await session.send("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 1 });
    await page.waitForTimeout(50);
    const startX = box.x + box.width - 32, y = box.y + 80;
    const distance = Math.min(240, box.width - 60);
    await session.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: startX, y, id: 1 }] });
    for (let step = 1; step <= 8; step++) {
      await session.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: startX - step * distance / 8, y, id: 1 }] });
      await page.waitForTimeout(80);
    }
    await session.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    await expect.poll(() => rail.evaluate((node) => node.scrollLeft)).toBeGreaterThan(0);
    await expect(page).toHaveURL(/\/$/);
    await session.detach();
    await page.getByRole("navigation", { name: "Explora por tema" }).getByRole("link", { name: "Literatura", exact: true }).tap();
    await page.getByRole("button", { name: /^Filtros/ }).tap();
    await page.getByRole("radio", { name: "Tapa dura" }).tap();
    await page.getByRole("button", { name: "Aplicar filtros" }).tap();
    await expect(page).toHaveURL(/format=HARDCOVER/);
    await page.getByRole("button", { name: "Buscar en el catálogo" }).tap();
    await page.getByRole("searchbox", { name: "Buscar en el catálogo" }).fill("Cien");
    await page.getByRole("dialog").getByRole("button", { name: "Buscar", exact: true }).tap();
    await expect(page).toHaveURL(/que=Cien$/);
    await reflow(page);
  }
  await context.close();
});

test("Home rail moves by controls and keyboard, and restores its position after detail", async ({ page }) => {
  await mock(page); await page.emulateMedia({ reducedMotion: "reduce" }); await page.setViewportSize({ width: 375, height: 900 }); await page.goto("/");
  const rail = page.locator('[data-presentation="rail"]');
  await expect(rail.locator('[data-bookcard]')).toHaveCount(8);
  await page.getByRole("button", { name: "Ver más libros" }).focus(); await page.keyboard.press("Enter");
  await expect.poll(() => rail.evaluate((node) => node.scrollLeft)).toBeGreaterThan(0);
  const before = await rail.evaluate((node) => node.scrollLeft);
  await page.getByRole("button", { name: "Ver libros anteriores" }).click();
  await expect.poll(() => rail.evaluate((node) => node.scrollLeft)).toBeLessThan(before);
  await rail.locator('[data-bookcard-link]').nth(6).focus();
  await expect.poll(() => rail.evaluate((node) => node.scrollLeft)).toBeGreaterThan(before);
  const saved = await rail.evaluate((node) => node.scrollLeft);
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/catalog\/editions\/48\?from=%2F/);
  await page.goBack(); await expect(rail).toBeVisible();
  await expect.poll(() => rail.evaluate((node) => node.scrollLeft)).toBeCloseTo(saved, 0);
  await expect(page.getByRole("main").getByRole("searchbox")).toHaveCount(0);
});
