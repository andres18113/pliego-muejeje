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
for (const width of [320, 390, 1280]) for (const surface of ["/favorites"]) {
  test(`Cart feedback ${surface} ${width}px: confirmed quantity, pending lock, failure retry, keyboard and one announcement`, async ({ page }) => {
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
    await expect(page.getByText("¡Agregado al carrito!")).toHaveCount(0); release();
    await expect(row.getByRole("alert")).toContainText("stock");
    state.fail = false; state.release = undefined;
    await add.focus(); await page.keyboard.press("Enter");
    const toast = page.locator("[data-cart-added-notification]");
    await expect(toast).toContainText("Añadiste 1 unidad. Ahora tienes 3 unidades de esta edición en tu carrito.");
    await expect(row.getByText("En el carrito: 3 unidades")).toBeVisible();
    await expect(row.getByRole("button", { name: "Quitar de favoritos: Cien años de soledad" })).toHaveAttribute("aria-pressed", "true");
    await expect(add).toHaveText("add_shopping_cartAgregar al carrito");
    await expect(page.getByRole("status").filter({ hasText: "¡Agregado al carrito!" })).toHaveCount(1);
    await expect(row.locator('[role="status"]')).toHaveCount(0);
    await expect(page.locator("header [aria-live]" )).toHaveCount(0);
    if (surface === "/favorites") await expect(page.getByRole("link", { name: "Carrito, 3 unidades" })).toBeVisible();
    else await expect(page.locator("[data-purchase-header]")).toContainText("3 artículos");
    const box = await toast.boundingBox(); expect(box!.x).toBeGreaterThanOrEqual(0); expect(box!.x + box!.width).toBeLessThanOrEqual(width);
    await page.screenshot({ path: test.info().outputPath(`cart-feedback-${surface.slice(1)}-${width}.png`), fullPage: true, animations: "disabled" });
    await toast.getByRole("link", { name: "Ver carrito" }).focus(); await page.keyboard.press("Tab");
    await expect(toast.getByRole("button", { name: "Cerrar aviso de carrito" })).toBeFocused();
    await page.keyboard.press("Escape"); await expect(toast).toHaveCount(0); await expect(add).toBeFocused();
    await page.keyboard.press("Enter"); await expect(row.getByText("En el carrito: 4 unidades")).toBeVisible();
    await expect(page.getByText("¡Agregado al carrito!")).toHaveCount(1); expect(state.posts).toBe(3);
    if (width === 320 && surface === "/favorites") await expect(toast).toHaveCount(0, { timeout: 6500 });
    else { await toast.getByRole("link", { name: "Ver carrito" }).click(); await expect(page).toHaveURL(/\/cart$/); }
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
  });
}
for (const format of ["EBOOK", "AUDIOBOOK"]) for (const surface of ["/favorites"]) {
  test(`Digital ${format} ${surface}: one copy and no false success`, async ({ page }) => {
    const state = { quantity: 1, format, posts: 0 }; await mockApi(page, state); await page.setViewportSize({ width: 390, height: 900 }); await page.goto(surface);
    const row = page.locator('[data-favorite-row][data-edition-id="42"]');
    await expect(row.getByText("En el carrito: 1 unidad")).toBeVisible(); await expect(row.getByRole("button", { name: /Ya está en el carrito/ })).toBeDisabled();
    expect(state.posts).toBe(0); await expect(page.getByText("¡Agregado al carrito!")).toHaveCount(0);
  });
}

for (const dismissal of ["close", "Escape"]) {
 test(`Favorites pagination restores focus after ${dismissal} when its original row disappeared`, async ({ page }) => {
  const state = { quantity: 2, format: "PAPERBACK", posts: 0, pagination: true };
  await mockApi(page, state); await page.goto("/favorites");
  await page.getByRole("button", { name: "Agregar al carrito: Cien años de soledad" }).click();
  const toast = page.locator("[data-cart-added-notification]"); await expect(toast).toBeVisible();
  await toast.getByRole("link", { name: "Ver carrito" }).focus();
  await page.getByRole("button", { name: "Siguiente", exact: true }).click();
  await expect(page.locator('[data-favorite-row][data-edition-id="62"]')).toBeVisible();
  await expect(page.locator('[data-favorite-row][data-edition-id="42"]')).toHaveCount(0);
  if (dismissal === "close") await toast.getByRole("button", { name: "Cerrar aviso de carrito" }).click();
  else { await toast.getByRole("link", { name: "Ver carrito" }).focus(); await page.keyboard.press("Escape"); }
  await expect(toast).toHaveCount(0); await expect(page.locator("#favorite-editions-heading")).toBeFocused();
 });
}
for (const width of [320, 390]) for (const format of ["EBOOK", "AUDIOBOOK"]) for (const surface of ["/favorites"]) {
 test(`First digital keyboard addition ${format} ${surface} ${width}px retains local focus`, async ({ page }) => {
  const state = { quantity: 0, format, posts: 0 }; await mockApi(page, state); await page.setViewportSize({ width, height: 900 }); await page.goto(surface);
  const row = page.locator('[data-favorite-row][data-edition-id="42"]');
  const add = row.getByRole("button", { name: "Agregar al carrito: Cien años de soledad" }); await add.focus(); await page.keyboard.press("Enter");
  await expect(row.getByText("En el carrito: 1 unidad")).toBeVisible();
  await expect(row.getByRole("button", { name: /Ya está en el carrito/ })).toBeDisabled();
  await expect(row.getByRole("button", { name: "Quitar de favoritos: Cien años de soledad" })).toBeFocused();
  await expect(page.getByRole("status").filter({ hasText: "¡Agregado al carrito!" })).toHaveCount(1);
  expect(state.posts).toBe(1);
  await page.screenshot({ path: test.info().outputPath(`first-digital-focus-${format}-${surface.slice(1)}-${width}.png`), fullPage: true, animations: "disabled" });
 });
}
test("Favorites does not announce the old zero after a confirmed addition and failed cart refresh", async ({ page }) => {
 const state = { quantity: 0, format: "EBOOK", posts: 0, readFail: true }; await mockApi(page, state); await page.setViewportSize({ width: 390, height: 900 }); await page.goto("/favorites");
 await expect(page.getByRole("link", { name: "Carrito, 0 unidades" })).toBeVisible();
 await page.getByRole("button", { name: "Agregar al carrito: Cien años de soledad" }).click();
 await expect(page.getByRole("link", { name: "Carrito, unidades no disponibles" })).toBeVisible();
 await expect(page.getByText("En el carrito: 1 unidad")).toBeVisible(); await expect(page.locator("[data-cart-added-notification]")).toContainText("Ahora tienes 1 unidad");
});
