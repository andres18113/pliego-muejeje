import { expect, test, type Page } from "@playwright/test";
import { storefrontNavigationFixture } from "../../src/test/storefrontFixture";

const testFrontendOrigin = process.env.PLIEGO_E2E_BASE_URL || "http://127.0.0.1:5173";
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
    const body = url.pathname.endsWith("/storefront/navigation") ? storefrontNavigationFixture : url.pathname.endsWith("/categories") ? { items: categories }
      : url.pathname.endsWith("/filter-options") ? { languages: varied ? ["en", "es"] : ["es"], formats: ["HARDCOVER", "PAPERBACK"], minimumPrice: varied ? "5.00" : "20.00", maximumPrice: varied ? "80.00" : "20.00" }
      : { items: Array.from({ length: Number(url.searchParams.get("pageSize") ?? 20) }, (_, index) => ({ ...edition, editionId: String(index + 42), title: `${edition.title} ${index + 1}` })), page: Number(url.searchParams.get("page") ?? 0), pageSize: Number(url.searchParams.get("pageSize") ?? 20), totalCount: "55" };
    return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(body) });
  });
}
async function reflow(page: Page) {
  await page.evaluate(() => document.fonts.ready);
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(page.viewportSize()!.width);
  const names = await page.getByRole("main").locator('button,a,input,select').evaluateAll((elements) => elements.filter((node) => (node as HTMLElement).offsetParent !== null).map((node) => ({ tag: node.tagName, width: node.getBoundingClientRect().width, height: node.getBoundingClientRect().height })));
  expect(names.filter((control) => control.tag === "BUTTON").every((control) => control.height >= 44)).toBe(true);
}

/** The Home's popular row needs a featured title in the projection; the catalog mock supplies the books that follow it. */
async function mockPopular(page: Page) {
  const navigation = { sections: storefrontNavigationFixture.sections.map((section) => section.key === "PHYSICAL" ? { ...section, featured: [{
    editionId: "9001", bookId: "9001", title: "Destacado de prueba", authors: "Autora de prueba", coverUrl: null, format: "PAPERBACK", productType: "PHYSICAL", price: "20.00", offer: null, href: "/catalog/editions/9001",
  }] } : section) };
  await page.route("**/api/v1/storefront/navigation", (route) => route.fulfill({ json: navigation }));
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
    // The Home is the opening with one entry point per way of reading; its footer names the storefront's sections, not every subject.
    await expect(main.getByRole("heading", { level: 1, name: "Descubre el mundo de PLIEGO." })).toBeVisible();
    await expect(main.locator('section[aria-labelledby="page-title"]').getByRole("link", { name: /^Explorar / })).toHaveCount(3);
    await expect(main.getByRole("heading", { name: "Tu próxima lectura." })).toHaveCount(0);
    await reflow(page);
    const footer = page.getByRole("navigation", { name: "Navegación del pie de página" });
    await expect(footer.getByRole("link", { name: "Literatura", exact: true })).toHaveCount(0);
    await expect(footer.getByRole("link", { name: "Libros", exact: true })).toHaveAttribute("href", "/catalog?productType=PHYSICAL");
    await page.goto("/catalog?category=literatura");
    await expect(page).toHaveURL(/category=literatura/);
    await expect(main.getByRole("searchbox")).toHaveCount(0);
    // Category is the collection (heading) and a removable criterion; it is not repeated as in-page tabs.
    await expect(main.getByRole("navigation", { name: "Temas del catálogo" })).toHaveCount(0);
    await expect(main.getByRole("heading", { level: 1, name: "Literatura" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Quitar Literatura" })).toBeVisible();
    // Sort is the real contract; price orders appear only when prices differ.
    await page.getByRole("combobox", { name: "Ordenar por" }).click();
    await expect(page.getByRole("listbox", { name: "Ordenar por" }).getByRole("option")).toHaveText([/^Más vendidos/, /^Título: A–Z/]);
    await page.keyboard.press("Escape");
    // Desktop keeps the filters beside the shelf; narrower widths open the same panel in a drawer.
    const desktop = width >= 1024;
    const trigger = page.getByRole("button", { name: /^Filtros/ });
    const surface = desktop ? main.getByRole("complementary", { name: "Filtros" }) : page.getByRole("dialog", { name: "Filtros" });
    if (desktop) await expect(trigger).toHaveCount(0);
    else {
      await expect(main.getByRole("complementary")).toHaveCount(0);
      await expect(trigger).toHaveAccessibleName(/Filtros, 1 activo/);
      await trigger.focus(); await page.keyboard.press("Enter");
    }
    await expect(surface).toBeVisible();
    await expect(surface.getByRole("button", { name: "Idioma" })).toHaveCount(0);
    await expect(surface.getByText("Precio mínimo")).toHaveCount(0);
    await surface.getByRole("button", { name: "Formato" }).click();
    await surface.getByRole("radio", { name: "Tapa dura" }).focus(); await page.keyboard.press("Space");
    await expect(page).toHaveURL(/category=literatura&format=HARDCOVER/);
    await expect(surface).toBeVisible();
    if (!desktop) {
      await page.keyboard.press("Escape");
      await expect(surface).toHaveCount(0);
      await expect(trigger).toBeFocused();
    }
    await expect(page.getByRole("button", { name: "Quitar Tapa dura" })).toBeVisible();
    await reflow(page);
    // 200% text keeps hierarchy, controls and card facts readable without horizontal scroll.
    await page.evaluate(() => document.documentElement.style.fontSize = "32px");
    await reflow(page);
    if (!desktop) await trigger.click();
    await reflow(page);
    await surface.getByRole("button", { name: "Restablecer filtros" }).click();
    await expect(page).toHaveURL(/\/catalog$/);
    if (!desktop) await page.keyboard.press("Escape");
    await page.evaluate(() => document.documentElement.style.fontSize = "16px");
    await page.getByRole("link", { name: "Siguiente", exact: true }).click();
    await expect(page).toHaveURL(/page=1/);
    await expect(page.getByRole("region", { name: "Resultados", exact: true })).toBeFocused();
    await page.goBack(); await expect(page).not.toHaveURL(/page=1/);
    await expect(page.getByRole("main").getByRole("searchbox")).toHaveCount(0);
  });
}

test("filters and order preserve URL context, apply in place, price decimals are normalized", async ({ page }) => {
  await mock(page, true); await page.setViewportSize({ width: 375, height: 900 });
  await page.goto("/catalog?que=Cien&category=literatura&sort=PRICE_DESC&page=2");
  await page.getByRole("button", { name: /^Filtros/ }).click();
  const dialog = page.getByRole("dialog", { name: "Filtros" });
  await dialog.getByRole("button", { name: "Formato" }).click();
  const formats = dialog.getByRole("group", { name: "Formato" });
  await expect(formats.getByRole("radio", { name: "Todos los formatos", exact: true })).toBeChecked();
  await formats.getByText("Tapa dura", { exact: true }).click();
  await expect(page).toHaveURL(/format=HARDCOVER/);
  await expect(page).not.toHaveURL(/page=/);
  await formats.getByText("Todos los formatos", { exact: true }).click();
  await expect(page).not.toHaveURL(/format=/);
  // Price is browsed through the sort order; a typed range is no longer offered, but shared URLs keep working.
  await expect(dialog.getByText("Precio mínimo")).toHaveCount(0);
  await page.keyboard.press("Escape");
  await page.goto("/catalog?que=Cien&category=literatura&minPrice=9.25&sort=PRICE_DESC");
  await expect(page.getByRole("main").getByRole("searchbox")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Quitar búsqueda «Cien»" })).toBeVisible();
  await expect(page.getByRole("combobox", { name: "Ordenar por" })).toContainText("Precio: mayor a menor");
  await page.getByRole("button", { name: /^Quitar.*9/ }).click();
  await expect(page).toHaveURL(/que=Cien&category=literatura&sort=PRICE_DESC$/);
});

test("touch topic navigation, filter selection and search work at 320 and 375px", async ({ browser }) => {
  const context = await browser.newContext({ hasTouch: true, isMobile: true, viewport: { width: 375, height: 900 } });
  const page = await context.newPage(); await mock(page); await mockPopular(page);
  for (const width of [320, 375]) {
    await page.setViewportSize({ width, height: 900 }); await page.goto(`${testFrontendOrigin}/`);
    const track = page.locator("[data-popular-track]"); const rail = track.locator("xpath=..");
    await expect(track.locator("[data-media]")).toHaveCount(11);
    await expect(rail).toBeVisible();
    await page.bringToFront();
    await page.evaluate(() => document.fonts.ready);
    await rail.scrollIntoViewIfNeeded();
    await page.waitForTimeout(150);
    const box = (await rail.boundingBox())!;
    const session = await context.newCDPSession(page);
    // hasTouch already owns emulation. Overriding it in this temporary session
    // changes pointer media/maxTouchPoints when the session detaches.
    await page.waitForTimeout(50);
    const startX = box.x + box.width - 32, y = box.y + 80;
    const distance = Math.min(240, box.width - 60);
    await session.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: startX, y, id: 1 }] });
    for (let step = 1; step <= 8; step++) {
      await session.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: startX - step * distance / 8, y, id: 1 }] });
      await page.waitForTimeout(80);
    }
    await session.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    await expect(track).toHaveAttribute("data-page", "1");
    await expect(page).toHaveURL(/\/$/);
    await session.detach();
    await page.goto(`${testFrontendOrigin}/catalog?category=literatura`);
    await expect(page.locator("[data-bookcard]").first()).toBeVisible();
    await page.getByRole("button", { name: /^Filtros/ }).tap();
    const filters = page.getByRole("dialog", { name: "Filtros" });
    await filters.getByRole("button", { name: "Formato" }).tap();
    await filters.getByText("Tapa dura", { exact: true }).tap();
    await expect(page).toHaveURL(/format=HARDCOVER/);
    await filters.getByRole("button", { name: /^Ver \d+ edici/ }).tap();
    await expect(filters).toHaveCount(0);
    await page.getByRole("button", { name: "Buscar libros en el catálogo" }).tap();
    await page.getByRole("searchbox", { name: "Buscar en el catálogo" }).fill("Cien");
    await page.getByRole("dialog").getByRole("button", { name: "Buscar", exact: true }).tap();
    await expect(page).toHaveURL(/que=Cien$/);
    await reflow(page);
  }
  await context.close();
});

for (const width of [1440, 1280, 1024, 390]) {
  test(`Home "Ver ofertas" opens /ofertas by pointer and keyboard inside the app at ${width}px`, async ({ page }) => {
    await mock(page); await page.setViewportSize({ width, height: width === 1280 ? 720 : 900 }); await page.goto("/");
    const action = page.getByRole("region", { name: "Ofertas y ayuda" }).getByRole("link", { name: "Ver ofertas" });
    await expect(action).toHaveAttribute("href", "/ofertas"); await action.scrollIntoViewIfNeeded();
    await page.evaluate(() => { (window as unknown as { pliegoSameDocument?: boolean }).pliegoSameDocument = true; });
    // A real pointer on the action: nothing decorative may sit between it and the click.
    const box = (await action.boundingBox())!; const x = box.x + box.width / 2, y = box.y + box.height / 2;
    await page.mouse.move(x, y); await page.waitForTimeout(650);
    expect(await page.evaluate(([px, py]) => Boolean(document.elementFromPoint(px, py)?.closest('a[href="/ofertas"]')), [x, y])).toBe(true);
    await page.mouse.click(x, y);
    await expect(page).toHaveURL(/\/ofertas$/);
    expect(await page.evaluate(() => (window as unknown as { pliegoSameDocument?: boolean }).pliegoSameDocument)).toBe(true);
    await page.goBack(); await expect(page).toHaveURL(/\/$/);
    await action.focus(); await page.keyboard.press("Enter");
    await expect(page).toHaveURL(/\/ofertas$/);
    expect(await page.evaluate(() => (window as unknown as { pliegoSameDocument?: boolean }).pliegoSameDocument)).toBe(true);
  });
}

test("Home popular row moves by controls and keyboard, never past its ends, and opens a title", async ({ page }) => {
  await mock(page); await mockPopular(page); await page.emulateMedia({ reducedMotion: "reduce" }); await page.setViewportSize({ width: 375, height: 900 }); await page.goto("/");
  const track = page.locator("[data-popular-track]");
  // One featured title plus ten more from the catalog, none repeated; two to a page on a phone.
  await expect(track.locator("[data-media]")).toHaveCount(11);
  expect(new Set(await track.locator("[data-media] a").evaluateAll((links) => links.map((link) => link.getAttribute("href")))).size).toBe(11);
  const previous = page.getByRole("button", { name: "Títulos anteriores" }), next = page.getByRole("button", { name: "Más títulos" });
  await expect(previous).toHaveAttribute("aria-disabled", "true"); await expect(track.locator("[data-media]:not([inert])")).toHaveCount(2);
  await next.focus(); await page.keyboard.press("Enter");
  await expect(track).toHaveAttribute("data-page", "1"); await expect(next).toBeFocused(); await expect(previous).toHaveAttribute("aria-disabled", "false");
  await previous.click(); await expect(track).toHaveAttribute("data-page", "0");
  const pages = page.getByRole("group", { name: "Páginas de títulos populares" }).getByRole("button");
  await expect(pages).toHaveCount(6); await pages.last().click();
  await expect(track).toHaveAttribute("data-page", "5"); await expect(pages.last()).toHaveAttribute("aria-current", "true"); await expect(next).toHaveAttribute("aria-disabled", "true");
  await next.evaluate((node: HTMLElement) => node.click()); await expect(track).toHaveAttribute("data-page", "5");
  // Arrow keys belong to the page, not to the row: a focused title does not move it.
  const title = track.locator("[data-media]:not([inert]) a").last(); await title.focus(); await page.keyboard.press("ArrowLeft");
  await expect(track).toHaveAttribute("data-page", "5");
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth)).toBe(375);
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/catalog\/editions\/\d+$/);
});
