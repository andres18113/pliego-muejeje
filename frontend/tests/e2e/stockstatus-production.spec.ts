import { expect, test, type Page } from "@playwright/test";

const summary = { editionId: "42", bookId: "17", title: "Cien años de soledad", authors: "Gabriel García Márquez", publisher: "Debolsillo", isbn13: "9786287745131", price: "20.00", coverUrl: null, coverLicense: null, coverAttribution: null, format: "HARDCOVER", language: "es", available: true };
const unavailable = { ...summary, editionId: "43", bookId: "18", title: "Introducción al álgebra lineal", authors: "José Alfredo Collazos Sánchez, Carlos Alberto Ramírez Vanegas, Óscar Danilo Montoya Giraldo", publisher: "Ecoe Ediciones", isbn13: "9789585082656", format: "PAPERBACK", available: false };

async function install(page: Page, scheme: "light" | "dark", quantityConflict = false) {
  let stockOverride: boolean | undefined;
  let writes = 0;
  let withdrawn = false;
  const editionRead = (edition: typeof summary) => ({ ...edition, available: stockOverride ?? edition.available });
  await page.addInitScript((scheme) => localStorage.setItem("mantine-color-scheme-value", scheme), scheme);
  await page.route("**/api/v1/**", (route) => {
    const url = new URL(route.request().url()), path = url.pathname.replace("/api/v1", "");
    const ok = (data: unknown) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(data) });
    if (path === "/auth/refresh") return ok({ accessToken: "test-stock-token", tokenType: "Bearer", expiresInSeconds: 3600, user: { userId: "100", email: "stock@example.test", role: "CUSTOMER" } });
    if (path === "/catalog/categories") return ok({ items: [{ slug: "literatura", name: "Literatura", parentSlug: null }] });
    if (path === "/catalog/filter-options") return ok({ languages: ["es"], minimumPrice: "20.00", maximumPrice: "20.00" });
    if (path === "/catalog/editions") return ok({ items: [editionRead(summary), editionRead(unavailable)], page: 0, pageSize: 20, totalCount: "2" });
    if (/^\/catalog\/editions\/\d+$/.test(path)) {
      if (withdrawn) return route.fulfill({ status: 404, contentType: "application/problem+json", body: JSON.stringify({ code: "P2041", status: 404, title: "Edición no encontrada", detail: "La edición ya no está publicada." }) });
      const book = editionRead(path.endsWith("43") ? unavailable : summary);
      return ok({ ...book, authors: [{ authorId: "9", name: book.authors, order: 1 }], publisher: { publisherId: "5", name: book.publisher }, categories: [], pageCount: 496, publicationDate: "1967-05-30", sku: "PLG-BK-000014", synopsis: "La historia de la familia Buendía.", subtitle: null, coverSourceUrl: null });
    }
    if (path === "/me/favorites/status") return ok(url.searchParams.getAll("editionIds").map((editionId) => ({ editionId, favorite: false })));
    if (path === "/me/favorites") return ok({ items: [{ ...editionRead(unavailable), favoritedAt: "2026-10-01T12:00:00Z" }], page: 0, pageSize: 20, totalCount: "1" });
    if (path === "/cart") return ok({ cartId: "40", state: "ACTIVE", requiresPhysicalFulfillment: true, physicalItemCount: 4, digitalItemCount: 0, items: [null, "P3002", "P2042", "P2043"].map((reason, index) => ({
      cartItemId: String(100 + index), editionId: String(42 + index), title: index === 0 ? summary.title : `${unavailable.title} ${index}`, authors: summary.authors, sku: `PLG-BK-${index}`, coverUrl: null, requiresPhysicalFulfillment: true, quantityEditable: true, quantity: 2, currentPrice: "20.00", currentSubtotal: "40.00", available: stockOverride ?? (reason === null), unavailabilityReason: stockOverride === true ? null : stockOverride === false ? "P3002" : reason,
    })), totalCurrent: "160.00" });
    if (route.request().method() !== "GET" && path.startsWith("/cart/items")) writes++;
    if (path === "/cart/items" && quantityConflict) return route.fulfill({ status: 409, contentType: "application/problem+json", body: JSON.stringify({ type: "urn:pliego:problem:P3002", code: "P3002", status: 409, title: "Existencias insuficientes", detail: "La cantidad solicitada no está cubierta." }) });
    if (path === "/me/addresses") return ok([{ addressId: "15", alias: "Casa", recipient: "Lector de prueba", line1: "Av. Principal 100", line2: null, city: "Quito", province: "Pichincha", countryCode: "EC", postalCode: null, reference: null, phone: "+593991234567", primary: true }]);
    if (path === "/reference/countries") return ok([{ code: "EC", name: "Ecuador" }]);
    if (path === "/reference/transfer-details") return ok({ bank: "Banco de prueba", beneficiary: "PLIEGO", accountType: "Ahorros", accountNumber: "000000", identification: "0000000000" });
    if (path === "/me") return ok({ customerId: "100", email: "stock@example.test", firstNames: "Lector", lastNames: "Prueba", phone: null, state: "ACTIVE", version: "0" });
    return route.fulfill({ status: 404, contentType: "application/json", body: "{}" });
  });
  return { setStock: (available: boolean) => { stockOverride = available; }, writes: () => writes, setWithdrawn: (value: boolean) => { withdrawn = value; } };
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
      const surface = element.closest('[data-bookcard], .detail-copy, main.detail-route, [data-purchase="line-copy"], [data-purchase="summary-lines"]');
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
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth ? Array.from(document.querySelectorAll<HTMLElement>("main *")).filter(el => el.getBoundingClientRect().right > innerWidth + 1).slice(0, 6).map(el => ({ tag: el.tagName, classes: el.className, width: el.getBoundingClientRect().width, right: el.getBoundingClientRect().right })) : []);
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth - innerWidth), JSON.stringify(overflow)).toBe(0);
}

for (const scheme of ["light", "dark"] as const) {
  test(`StockStatus in production routes: ${scheme}, desktop/mobile and real API states`, async ({ page }) => {
    test.setTimeout(120_000);
    await install(page, scheme);
    for (const width of [320, 390, 768, 1440, 1920]) {
      await page.setViewportSize({ width, height: 1000 });
      await page.goto("/catalog"); await expect(page.locator("[data-bookcard]")).toHaveCount(2); await check(page, 2);
      await expect(page.locator("html")).toHaveAttribute("data-mantine-color-scheme", scheme);
      // Catalog cards are browse cards: availability lives in the stock line; buying happens on the edition page.
      await expect(page.locator('.edition-item [data-bookcard-cart]')).toHaveCount(0);
      await expect(page.locator('.edition-item [data-stockstatus]')).toHaveCount(2);
      // The Home identifies titles and sells none: it has no stock status of its own.
      await page.goto("/"); await expect(page.getByRole("heading", { level: 1 })).toBeVisible(); await expect(page.locator("main [data-stockstatus]")).toHaveCount(0);
      await page.goto("/favorites"); await expect(page.locator("[data-favorite-row]")).toHaveCount(1); await check(page, 1);
      await page.goto("/catalog/editions/42"); await check(page, 1);
      await page.goto("/catalog/editions/43"); await check(page, 1);
      await expect(page.locator('[data-stockstatus-label]')).toHaveText("No disponible");
      await expect(page.locator('main.detail-route').getByRole('button', { name: 'Agregar al carrito' })).toHaveCount(0);
      await page.goto("/cart"); await check(page, 4);
      await page.locator('[data-purchase="line-copy"] h2 a').first().hover();
      await check(page, 4);
      await expect(page.locator('[data-stockstatus-explanation]')).toHaveText(["No hay existencias suficientes para esta cantidad.", "Esta edición ya no está a la venta.", "Este libro ya no está a la venta."]);
      await expect(page.getByRole('combobox', { name: 'Cantidad de Introducción al álgebra lineal 1' })).toHaveAccessibleDescription(/No disponible.*No hay existencias suficientes para esta cantidad/);
      await page.goto("/checkout");
      await check(page, 3); // One summary sheet at every width.
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
  const quantity = page.getByRole("combobox", { name: "Cantidad de Cien años de soledad" });
  await quantity.focus(); await page.keyboard.press("Tab");
  await expect(page.getByRole("button", { name: "Guardar Cien años de soledad para después" })).toBeFocused();
  expect(await page.locator('[data-stockstatus]').evaluateAll((elements) => elements.every((element) => !element.hasAttribute('tabindex')))).toBe(true);
});

async function refreshStock(page: Page) {
  await page.clock.fastForward(61_000);
  await page.evaluate(() => window.dispatchEvent(new Event("visibilitychange")));
}

for (const route of ["/catalog", "/favorites", "/catalog/editions/42", "/cart", "/checkout"] as const) {
  test(`StockStatus authoritative read transitions preserve semantics and keyboard focus in ${route}`, async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.clock.install();
    const api = await install(page, "light");
    for (const width of [320, 1280]) {
      await page.setViewportSize({ width, height: 800 });
    api.setStock(true);
    await page.goto(route);
    // The catalog's browse card has no cart action: its product link carries the stock description.
    const action = route === "/catalog" ? page.locator('[data-bookcard-link]').first()
      : route === "/favorites" ? page.locator('[data-favorite-row] [data-bookcard-cart]').first()
      : route === "/cart" ? page.getByRole("combobox", { name: "Cantidad de Cien años de soledad" })
      : route === "/checkout" ? page.getByRole("button", { name: "Hacer pedido" })
      : page.getByRole("button", { name: "Agregar al carrito", exact: true });
    await expect(action).toBeEnabled();
    // The cart states availability only when it fails, so its selector has no stock description while available.
    if (route !== "/checkout" && route !== "/cart") await expect(action).toHaveAccessibleDescription(/Disponible/);
    await action.focus();
    api.setStock(false); await refreshStock(page);
    if (route === "/catalog/editions/42") await expect(action).toHaveCount(0);
    // The browse card's link stays where it is, so the reader keeps their place.
    else if (route === "/catalog") await expect(action).toBeFocused();
    // The cart selector stays usable so the quantity can still be lowered; it stops offering more than the line holds.
    else if (route === "/cart") {
      await page.keyboard.press("ArrowDown");
      await expect(page.getByRole("option")).toHaveCount(2);
      await page.keyboard.press("Escape");
    }
    else {
      await expect(action).toBeDisabled();
      expect(await action.evaluate((element: HTMLButtonElement) => element.disabled)).toBe(true);
    }
    if (route !== "/checkout") await expect(page.locator('main [data-stockstatus][data-state="unavailable"]').first()).toBeVisible();
    const recoveredFocus = route === "/catalog" ? action
      : route === "/favorites" ? page.locator('[data-bookcard-favorite]').first()
      : route === "/cart" ? action
      : route === "/checkout" ? page.locator('#checkout-stock-blocker')
      : page.getByRole("heading", { level: 1, name: summary.title });
    await expect(recoveredFocus).toBeFocused();
    await expect(recoveredFocus).toBeInViewport();
    await expect.poll(() => page.locator('main [data-stockstatus]').evaluateAll(elements => elements.length > 0 && elements.every(el => el.getAttribute("data-state") === "unavailable"))).toBe(true);
    const writes = api.writes();
    if (route !== "/catalog/editions/42" && route !== "/catalog") await action.evaluate((element: HTMLElement) => element.click());
    expect(api.writes()).toBe(writes);
    if (route === "/cart") await page.keyboard.press("Escape");
    api.setStock(true); await refreshStock(page);
    await expect(action).toBeEnabled();
    // The cart states availability only when it fails, so its selector has no stock description while available.
    if (route !== "/checkout" && route !== "/cart") await expect(action).toHaveAccessibleDescription(/Disponible/);
    await expect(route === "/checkout" ? action : recoveredFocus).toBeFocused();
    }
  });
}

for (const scheme of ["light", "dark"] as const) {
  test(`all real StockStatus consumers retain full status and disabled semantics at 200% text in ${scheme}`, async ({ page }, testInfo) => {
    test.setTimeout(120_000);
    await install(page, scheme);
    await page.emulateMedia({ reducedMotion: "reduce" });
    for (const width of [320, 1280]) {
      await page.setViewportSize({ width, height: 1000 });
      for (const [route, count] of [["/catalog", 2], ["/favorites", 1], ["/catalog/editions/42", 1], ["/catalog/editions/43", 1], ["/cart", 4], ["/checkout", 3]] as const) {
        await page.goto(route);
        await expect(page.locator("main [data-stockstatus]")).toHaveCount(count);
        await page.evaluate(() => { document.documentElement.style.fontSize = "200%"; });
        await check(page, count);
        const unavailableActions = page.locator('[data-bookcard-cart][data-unavailable]');
        for (const action of await unavailableActions.all()) {
          await expect(action).toBeDisabled();
          expect(await action.evaluate((element: HTMLButtonElement) => element.disabled)).toBe(true);
          await expect(action).toHaveAccessibleDescription(/No disponible/);
        }
        await expect(page.locator('[data-stockstatus] .material-symbol:not([aria-hidden="true"]), [data-stockstatus-mark]:not([aria-hidden="true"])')).toHaveCount(0);
        if (route === "/catalog" || route === "/favorites") {
          const favorite = page.locator('main [data-bookcard-favorite]').first();
          await favorite.focus(); await expect(favorite).toBeFocused();
        }
        if (route === "/favorites" || route === "/catalog/editions/43") await page.screenshot({ path: testInfo.outputPath(`${width}-${route.includes("favorites") ? "favorites" : "pdp"}.png`), fullPage: true });
      }
    }
  });
}

test("stock refresh keeps focus when the reader has moved to another control", async ({ page }) => {
  await page.clock.install();
  const api = await install(page, "light"); api.setStock(true);
  // The shared cart control now lives on Favoritos rows (catalog cards are browse cards).
  await page.goto("/favorites");
  const cart = page.locator('[data-favorite-row] [data-bookcard-cart]').first();
  await cart.focus();
  const search = page.getByRole("button", { name: "Buscar libros en el catálogo", exact: true });
  await search.focus();
  api.setStock(false); await refreshStock(page);
  await expect(cart).toBeDisabled(); await expect(search).toBeFocused();
});

test("PDP withdrawal and restoration recover focus without claiming stock or repeating a command", async ({ page }) => {
  await page.clock.install(); const api = await install(page, "light");
  await page.goto("/catalog/editions/42");
  const action = page.getByRole("button", { name: "Agregar al carrito", exact: true });
  await action.focus();
  api.setWithdrawn(true); await refreshStock(page);
  const missing = page.getByRole("heading", { name: "No encontramos esta edición.", exact: true });
  await expect(missing).toBeFocused();
  await expect(action).toHaveCount(0); await expect(page.locator('main [data-stockstatus]')).toHaveCount(0);
  api.setWithdrawn(false); await refreshStock(page);
  await expect(page.getByRole("heading", { level: 1, name: summary.title })).toBeFocused();
  await expect(action).toBeEnabled(); expect(api.writes()).toBe(0);
});
