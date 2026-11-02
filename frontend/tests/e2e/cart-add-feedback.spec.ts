import { expect, test, type Page } from "@playwright/test";
import { storefrontNavigationFixture } from "../../src/test/storefrontFixture";

const edition = { editionId: "42", bookId: "9", title: "Cien años de soledad", authors: "Gabriel García Márquez", publisher: "Editorial", format: "PAPERBACK", language: "es", price: "18.50", available: true, coverUrl: null, coverLicense: null, coverAttribution: null, favoritedAt: "2026-10-10T12:00:00Z" };
async function mockApi(page: Page, state: { quantity: number; format: string; posts: number; fail?: boolean; release?: Promise<void>; pagination?: boolean; readRelease?: Promise<void>; readFail?: boolean }) {
  await page.route("**/api/v1/**", async route => {
    const path = new URL(route.request().url()).pathname;
    const json = (body: unknown) => route.fulfill({ json: body });
    if (path.endsWith("/auth/refresh")) return json({ accessToken: "test-token", tokenType: "Bearer", expiresInSeconds: 1800, user: { userId: "100", email: "controlled@example.invalid", role: "CUSTOMER" } });
    if (path.endsWith("/storefront/navigation")) return json(storefrontNavigationFixture);
    if (path.endsWith("/me")) return json({ customerId: "100", email: "controlled@example.invalid", firstNames: "Ana", lastNames: "Lectora", phone: null, state: "ACTIVE", version: "0", emailVerified: true });
    if (path.endsWith("/me/favorites")) {
      const currentPage = Number(new URL(route.request().url()).searchParams.get("page") ?? 0);
      return json({ items: [{ ...edition, ...(currentPage ? { editionId: "62", title: "Otra edición guardada" } : {}), format: state.format }], totalCount: state.pagination ? "21" : "1", page: currentPage, pageSize: 20 });
    }
    if (path.endsWith("/cart/items") && route.request().method() === "POST") {
      state.posts++;
      await state.release;
      if (state.fail) return route.fulfill({ status: 409, json: { type: "urn:pliego:problem:P2050", code: "P2050", status: 409, title: "No pudimos agregar la edición", detail: "No queda stock suficiente para esa cantidad." } });
      state.quantity += route.request().postDataJSON().quantity;
      return json({ cartItemId: "100", quantity: state.quantity });
    }
    if (path.endsWith("/cart")) { if (state.quantity > 0) { await state.readRelease; if (state.readFail) return route.fulfill({ status: 503, json: { type: "urn:pliego:problem:Unavailable", code: "Unavailable", status: 503, title: "Servicio no disponible", detail: "Inténtalo de nuevo." } }); } return json({ cartId: "40", state: "ACTIVE", requiresPhysicalFulfillment: state.format === "PAPERBACK", physicalItemCount: state.format === "PAPERBACK" ? 1 : 0, digitalItemCount: state.format === "PAPERBACK" ? 0 : 1, totalCurrent: (state.quantity * 18.5).toFixed(2), items: state.quantity ? [{ cartItemId: "100", editionId: "42", title: edition.title, authors: edition.authors, sku: "PLG-42", coverUrl: null, quantity: state.quantity, currentPrice: "18.50", currentSubtotal: (state.quantity * 18.5).toFixed(2), available: true, requiresPhysicalFulfillment: state.format === "PAPERBACK", quantityEditable: state.format === "PAPERBACK", format: state.format, unavailabilityReason: null }] : [] }); }
    return route.fulfill({ status: 404, json: {} });
  });
}
const cartDrawer = (page: Page) => page.getByRole("dialog", { name: "Tu carrito" });

for (const width of [320, 390, 1280]) for (const surface of ["/favorites"]) {
  test(`Cart feedback ${surface} ${width}px: confirmed add opens Tu carrito; pending lock, failure retry and keyboard`, async ({ page }) => {
    const state = { quantity: 2, format: "PAPERBACK", posts: 0, fail: true, release: undefined as Promise<void> | undefined };
    await mockApi(page, state); await page.setViewportSize({ width, height: 900 }); await page.goto(surface);
    const row = page.locator('[data-favorite-row][data-edition-id="42"]');
    const add = row.getByRole("button", { name: "Agregar al carrito: Cien años de soledad" });
    await expect(row.getByText("En el carrito: 2 unidades")).toBeVisible();
    let release!: () => void; state.release = new Promise<void>(resolve => { release = resolve; });
    await add.focus(); await page.keyboard.press("Enter");
    await expect(row.getByRole("button", { name: "Agregando…: Cien años de soledad" })).toHaveAttribute("aria-disabled", "true");
    await expect.poll(() => state.posts).toBe(1);
    await page.keyboard.press("Enter"); expect(state.posts).toBe(1);
    release();
    // A refused add explains itself on the row and never opens the cart.
    await expect(row.getByRole("alert")).toContainText("stock");
    await expect(cartDrawer(page)).toHaveCount(0);
    state.fail = false; state.release = undefined;
    await add.focus(); await page.keyboard.press("Enter");
    const drawer = cartDrawer(page);
    await expect(drawer).toBeVisible();
    await expect(drawer.getByRole("status").first()).toContainText("Agregaste Cien años de soledad");
    await expect(page.getByText("¡Agregado al carrito!")).toHaveCount(0);
    await expect(row.getByText("En el carrito: 3 unidades")).toBeVisible();
    await expect(row.getByRole("button", { name: "Quitar de favoritos: Cien años de soledad" })).toHaveAttribute("aria-pressed", "true");
    // Once its slide-in settles, the drawer sits fully inside the viewport (full width on phones).
    await expect.poll(async () => { const box = await drawer.boundingBox(); return box ? Math.round(box.x + box.width) : Infinity; }).toBeLessThanOrEqual(width);
    expect((await drawer.boundingBox())!.x).toBeGreaterThanOrEqual(0);
    await page.screenshot({ path: test.info().outputPath(`cart-feedback-${surface.slice(1)}-${width}.png`), fullPage: false, animations: "disabled" });
    // Escape closes the drawer and the keyboard is back on the control that added.
    await page.keyboard.press("Escape"); await expect(drawer).toHaveCount(0); await expect(add).toBeFocused();
    await expect(page.getByRole("link", { name: "Carrito, 3 unidades" })).toBeVisible();
    await page.keyboard.press("Enter"); await expect(row.getByText("En el carrito: 4 unidades")).toBeVisible();
    await expect(cartDrawer(page)).toBeVisible(); expect(state.posts).toBe(3);
    await cartDrawer(page).getByRole("link", { name: "Ver carrito" }).click(); await expect(page).toHaveURL(/\/cart$/);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
  });
}
for (const format of ["EBOOK", "AUDIOBOOK"]) for (const surface of ["/favorites"]) {
  test(`Digital ${format} ${surface}: one copy and no false success`, async ({ page }) => {
    const state = { quantity: 1, format, posts: 0 }; await mockApi(page, state); await page.setViewportSize({ width: 390, height: 900 }); await page.goto(surface);
    const row = page.locator('[data-favorite-row][data-edition-id="42"]');
    await expect(row.getByText("En el carrito: 1 unidad")).toBeVisible(); await expect(row.getByRole("button", { name: /Ya está en el carrito/ })).toBeDisabled();
    expect(state.posts).toBe(0); await expect(cartDrawer(page)).toHaveCount(0);
  });
}
for (const width of [320, 390]) for (const format of ["EBOOK", "AUDIOBOOK"]) for (const surface of ["/favorites"]) {
 test(`First digital keyboard addition ${format} ${surface} ${width}px opens the drawer and closes back onto the row`, async ({ page }) => {
  const state = { quantity: 0, format, posts: 0 }; await mockApi(page, state); await page.setViewportSize({ width, height: 900 }); await page.goto(surface);
  const row = page.locator('[data-favorite-row][data-edition-id="42"]');
  const add = row.getByRole("button", { name: "Agregar al carrito: Cien años de soledad" }); await add.focus(); await page.keyboard.press("Enter");
  await expect(cartDrawer(page)).toBeVisible();
  await expect(row.getByText("En el carrito: 1 unidad")).toBeVisible();
  await expect(row.getByRole("button", { name: /Ya está en el carrito/ })).toBeDisabled();
  expect(state.posts).toBe(1);
  await page.screenshot({ path: test.info().outputPath(`first-digital-drawer-${format}-${surface.slice(1)}-${width}.png`), fullPage: false, animations: "disabled" });
  await page.keyboard.press("Escape"); await expect(cartDrawer(page)).toHaveCount(0);
  // Its add button is now disabled, so focus lands on the row's heart rather than falling to the page.
  await expect(row.getByRole("button", { name: "Quitar de favoritos: Cien años de soledad" })).toBeFocused();
 });
}
test("Favorites does not announce the old zero after a confirmed addition and failed cart refresh", async ({ page }) => {
 const state = { quantity: 0, format: "EBOOK", posts: 0, readFail: true }; await mockApi(page, state); await page.setViewportSize({ width: 390, height: 900 }); await page.goto("/favorites");
 await expect(page.getByRole("link", { name: "Carrito, 0 unidades" })).toBeVisible();
 await page.getByRole("button", { name: "Agregar al carrito: Cien años de soledad" }).click();
 await expect(page.getByRole("link", { name: "Carrito, unidades no disponibles" })).toBeVisible();
 await expect(page.getByText("En el carrito: 1 unidad")).toBeVisible();
 // The add is confirmed: the drawer opens and says plainly that what it shows may be out of date.
 await expect(cartDrawer(page)).toBeVisible();
 await expect(cartDrawer(page).getByRole("alert")).toContainText("No pudimos");
});
