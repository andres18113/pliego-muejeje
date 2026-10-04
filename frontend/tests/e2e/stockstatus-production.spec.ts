import { expect, test, type Page } from "@playwright/test";

const summary = { editionId: "42", bookId: "17", title: "Cien años de soledad", authors: "Gabriel García Márquez", publisher: "Debolsillo", isbn13: "9786287745131", price: "20.00", coverUrl: null, coverLicense: null, coverAttribution: null, format: "HARDCOVER", language: "es", available: true };
const unavailable = { ...summary, editionId: "43", bookId: "18", title: "Introducción al álgebra lineal", authors: "José Alfredo Collazos Sánchez, Carlos Alberto Ramírez Vanegas, Óscar Danilo Montoya Giraldo", publisher: "Ecoe Ediciones", isbn13: "9789585082656", format: "PAPERBACK", available: false };

async function install(page: Page, scheme: "light" | "dark", quantityConflict = false) {
  await page.addInitScript((scheme) => localStorage.setItem("mantine-color-scheme-value", scheme), scheme);
  await page.route("**/api/v1/**", (route) => {
    const url = new URL(route.request().url()), path = url.pathname.replace("/api/v1", "");
    const ok = (data: unknown) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(data) });
    if (path === "/auth/refresh") return ok({ accessToken: "test-stock-token", tokenType: "Bearer", expiresInSeconds: 3600, user: { userId: "100", email: "stock@example.test", role: "CUSTOMER" } });
    if (path === "/catalog/categories") return ok({ items: [{ slug: "literatura", name: "Literatura", parentSlug: null }] });
    if (path === "/catalog/filter-options") return ok({ languages: ["es"], minimumPrice: "20.00", maximumPrice: "20.00" });
    if (path === "/catalog/editions") return ok({ items: [summary, unavailable], page: 0, pageSize: 20, totalCount: "2" });
    if (/^\/catalog\/editions\/\d+$/.test(path)) {
      const book = path.endsWith("43") ? unavailable : summary;
      return ok({ ...book, authors: [{ authorId: "9", name: book.authors, order: 1 }], publisher: { publisherId: "5", name: book.publisher }, categories: [], pageCount: 496, publicationDate: "1967-05-30", sku: "PLG-BK-000014", synopsis: "La historia de la familia Buendía.", subtitle: null, coverSourceUrl: null });
    }
    if (path === "/me/favorites/status") return ok(url.searchParams.getAll("editionIds").map((editionId) => ({ editionId, favorite: false })));
    if (path === "/me/favorites") return ok({ items: [{ ...unavailable, favoritedAt: "2026-10-01T12:00:00Z" }], page: 0, pageSize: 20, totalCount: "1" });
    if (path === "/cart") return ok({ cartId: "40", state: "ACTIVE", items: [null, "P3002", "P2042", "P2043"].map((reason, index) => ({
      cartItemId: String(100 + index), editionId: String(42 + index), title: index === 0 ? summary.title : `${unavailable.title} ${index}`, authors: summary.authors, sku: `PLG-BK-${index}`, coverUrl: null, quantity: 2, currentPrice: "20.00", currentSubtotal: "40.00", available: reason === null, unavailabilityReason: reason,
    })), totalCurrent: "160.00" });
    if (path === "/cart/items" && quantityConflict) return route.fulfill({ status: 409, contentType: "application/problem+json", body: JSON.stringify({ type: "urn:pliego:problem:P3002", code: "P3002", status: 409, title: "Existencias insuficientes", detail: "La cantidad solicitada no está cubierta." }) });
    if (path === "/me/addresses") return ok([{ addressId: "15", alias: "Casa", recipient: "Lector de prueba", line1: "Av. Principal 100", line2: null, city: "Quito", province: "Pichincha", countryCode: "EC", postalCode: null, reference: null, phone: "+593991234567", primary: true }]);
    if (path === "/reference/countries") return ok([{ code: "EC", name: "Ecuador" }]);
    if (path === "/reference/transfer-details") return ok({ bank: "Banco de prueba", beneficiary: "PLIEGO", accountType: "Ahorros", accountNumber: "000000", identification: "0000000000" });
    if (path === "/me") return ok({ customerId: "100", email: "stock@example.test", firstNames: "Lector", lastNames: "Prueba", phone: null, state: "ACTIVE" });
    return route.fulfill({ status: 404, contentType: "application/json", body: "{}" });
  });
}

async function check(page: Page, count: number) {
  const statuses = page.locator("main [data-stockstatus]");
  await expect(statuses).toHaveCount(count);
  await page.evaluate(() => document.fonts.ready);
  const result = await statuses.evaluateAll((elements) => {
    const luminance = (color: string) => {
      // Canvas resolves both rgb() and opaque color-mix()/color(srgb ...) to sRGB bytes.
      const context = document.createElement("canvas").getContext("2d")!;
      context.fillStyle = color; context.fillRect(0, 0, 1, 1);
      const values = [...context.getImageData(0, 0, 1, 1).data].slice(0, 3).map((value) => { const c = value / 255; return c <= .04045 ? c / 12.92 : ((c + .055) / 1.055) ** 2.4; });
      return .2126 * values[0] + .7152 * values[1] + .0722 * values[2];
    };
    return elements.filter((element) => (element as HTMLElement).offsetParent !== null).map((element) => {
      const text = [...element.querySelectorAll<HTMLElement>("[data-stockstatus-label], [data-stockstatus-explanation]")];
      const surface = element.closest('[data-bookcard], .detail-copy, .cart-line-copy, .summary-lines');
      if (surface) text.push(...surface.querySelectorAll<HTMLElement>('a:not(.button), .edition-detail-link'));
      return {
        overflow: element.scrollWidth > element.clientWidth + 1,
        role: element.getAttribute("role"), live: element.getAttribute("aria-live"), tab: element.getAttribute("tabindex"),
        contrasts: text.map((text) => { let surface: Element | null = text;
          while (surface && getComputedStyle(surface).backgroundColor === "rgba(0, 0, 0, 0)") surface = surface.parentElement;
          const a = luminance(getComputedStyle(text).color), b = luminance(getComputedStyle(surface!).backgroundColor); return (Math.max(a, b) + .05) / (Math.min(a, b) + .05); }),
        clipped: text.some((text) => text.scrollHeight > text.clientHeight || getComputedStyle(text).webkitLineClamp !== "none"),
      };
    });
  });
  if (count > 0) expect(result.length).toBeGreaterThan(0);
  for (const status of result) {
    expect(status.overflow).toBe(false); expect(status.clipped).toBe(false);
    expect(status.role).toBeNull(); expect(status.live).toBeNull(); expect(status.tab).toBeNull();
    expect(Math.min(...status.contrasts)).toBeGreaterThanOrEqual(4.5);
  }
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBe(0);
}

for (const scheme of ["light", "dark"] as const) {
  test(`StockStatus in production routes: ${scheme}, desktop/mobile and real API states`, async ({ page }) => {
    test.setTimeout(120_000);
    await install(page, scheme);
    for (const width of [320, 390, 768, 1440, 1920]) {
      await page.setViewportSize({ width, height: 1000 });
      await page.goto("/catalog"); await expect(page.locator("[data-bookcard]")).toHaveCount(2); await check(page, 2);
      await expect(page.locator("html")).toHaveAttribute("data-mantine-color-scheme", scheme);
      await expect(page.locator('.edition-item [data-bookcard-cart][data-unavailable]')).toHaveText("shopping_cart_offAgregar");
      await expect(page.locator('.edition-item [data-stockstatus]')).toHaveCount(2);
      await page.goto("/"); await expect(page.locator("[data-reading-scene]")).toHaveCount(2); await expect(page.locator("main [data-stockstatus]")).toHaveCount(3); await check(page, 3);
      await page.goto("/favorites"); await expect(page.locator("[data-bookcard]")).toHaveCount(1); await check(page, 1);
      await page.goto("/catalog/editions/42"); await check(page, 1);
      await page.goto("/catalog/editions/43"); await check(page, 1);
      await expect(page.locator('[data-stockstatus-label]')).toHaveText("No disponible");
      await expect(page.locator('.detail-purchase').getByRole('button', { name: 'Agregar al carrito' })).toHaveCount(0);
      await page.goto("/cart"); await check(page, 4);
      await page.locator('.cart-line-copy h3 a').first().hover();
      await check(page, 4);
      await expect(page.locator('[data-stockstatus-explanation]')).toHaveText(["No hay existencias suficientes para esta cantidad.", "Esta edición ya no está a la venta.", "Este libro ya no está a la venta."]);
      await expect(page.getByRole('group', { name: 'Cantidad de Introducción al álgebra lineal 1' })).toHaveAccessibleDescription(/No disponible.*No hay existencias suficientes para esta cantidad/);
      await page.goto("/checkout");
      if (width <= 900) await page.locator('.checkout-summary-disclosure summary').click();
      await check(page, 6); // Desktop aside and mobile disclosure share the real component.
    }
  });
}

test("StockStatus: a cart command conflict does not turn general edition stock into unavailable", async ({ page }) => {
  await install(page, "dark", true);
  await page.goto("/catalog/editions/42");
  await expect(page.locator('[data-stockstatus-label]')).toHaveText("Disponible");
  await page.getByRole("button", { name: "Agregar al carrito", exact: true }).click();
  await expect(page.getByText("No hay existencias suficientes para esta cantidad en tu carrito.", { exact: true })).toBeVisible();
  await expect(page.locator('[data-stockstatus-label]')).toHaveText("Disponible");
});

test("StockStatus in production: enlarged text and keyboard navigation", async ({ page }) => {
  await install(page, "light");
  await page.setViewportSize({ width: 320, height: 1000 });
  await page.goto("/cart"); await check(page, 4);
  await page.evaluate(() => { document.documentElement.style.fontSize = "200%"; });
  for (const status of await page.locator('[data-stockstatus]').all()) {
    expect(await status.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
    expect(await status.evaluate((element) => [...element.querySelectorAll<HTMLElement>('[data-stockstatus-label], [data-stockstatus-explanation]')].every((text) => text.scrollHeight === text.clientHeight))).toBe(true);
  }
  const quantity = page.getByRole("button", { name: "Quitar una unidad de Cien años de soledad" });
  await quantity.focus(); await page.keyboard.press("Tab");
  await expect(page.getByRole("button", { name: "Agregar una unidad de Cien años de soledad" })).toBeFocused();
  expect(await page.locator('[data-stockstatus]').evaluateAll((elements) => elements.every((element) => !element.hasAttribute('tabindex')))).toBe(true);
});
