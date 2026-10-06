import { expect, test, type Page, type Route } from "@playwright/test";
import { storefrontNavigationFixture } from "../../src/test/storefrontFixture";

/**
 * The Libros commerce shelf: neutral paper identity, persistent filters on desktop (drawer below),
 * three columns, sort above the results, no typed price range, and the cart preview after an add.
 */
const editions = Array.from({ length: 6 }, (_, index) => ({
  editionId: String(42 + index), bookId: String(17 + index), title: index === 0 ? "Cien años de soledad" : `Libro ${index}`,
  authors: "Gabriel García Márquez", publisher: "Editorial Sur", isbn13: "9780306406157", price: (18.5 + index).toFixed(2),
  coverUrl: null, coverLicense: null, coverAttribution: null, format: index % 2 ? "HARDCOVER" : "PAPERBACK", language: "es", available: true,
}));

class FakeStore {
  lines: { cartItemId: string; editionId: string; quantity: number }[] = [];
  stock = 1;
  sorts: string[] = [];
  favorites = new Set<string>();
  cartPosts = 0;
  filterScopes: string[] = [];

  async install(page: Page) {
    await page.route("**/api/v1/**", (route) => this.handle(route));
  }

  private cart() {
    const items = this.lines.map((line) => {
      const edition = editions.find((candidate) => candidate.editionId === line.editionId)!;
      return { cartItemId: line.cartItemId, editionId: line.editionId, title: edition.title, authors: edition.authors, sku: "PLG", coverUrl: null,
        quantity: line.quantity, currentPrice: edition.price, currentSubtotal: (Number(edition.price) * line.quantity).toFixed(2), available: true,
        requiresPhysicalFulfillment: true, quantityEditable: true, format: edition.format, unavailabilityReason: null };
    });
    const total = items.reduce((sum, item) => sum + Number(item.currentSubtotal), 0).toFixed(2);
    return { cartId: items.length ? "40" : null, requiresPhysicalFulfillment: items.length > 0, physicalItemCount: items.length, digitalItemCount: 0,
      state: items.length ? "ACTIVE" : null, items, totalCurrent: total, total };
  }

  private async handle(route: Route) {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname.replace("/api/v1", "");
    const method = request.method();
    const ok = (payload: unknown) => route.fulfill({ contentType: "application/json", body: JSON.stringify(payload) });
    if (path === "/storefront/navigation") return ok(storefrontNavigationFixture);
    if (path === "/auth/refresh") return route.fulfill({ status: 204 });
    if (path === "/auth/login") return ok({ accessToken: "e2e-token", tokenType: "Bearer", expiresInSeconds: 1800, user: { userId: "100", email: "ana@example.com", role: "CUSTOMER" } });
    if (path === "/me") return ok({ customerId: "100", email: "ana@example.com", firstNames: "Ana", lastNames: "Pérez", phone: null, state: "ACTIVE", version: "0" });
    if (path === "/catalog/categories") return ok({ items: [{ slug: "narrativa", name: "Narrativa", parentSlug: null }, { slug: "ensayo", name: "Ensayo", parentSlug: null }] });
    if (path === "/catalog/filter-options") {
      this.filterScopes.push(url.searchParams.get("scope") ?? "");
      return ok({ languages: ["es", "en"], formats: ["PAPERBACK", "HARDCOVER"], minimumPrice: "18.50", maximumPrice: "23.50" });
    }
    if (path === "/catalog/editions") {
      const sort = url.searchParams.get("sort") ?? "TITLE_ASC";
      this.sorts.push(sort);
      const items = [...editions].sort((a, b) => sort === "PRICE_DESC" ? Number(b.price) - Number(a.price) : Number(a.price) - Number(b.price));
      return ok({ items, page: 0, pageSize: 20, totalCount: String(items.length) });
    }
    if (path === "/me/favorites/status") return ok(url.searchParams.getAll("editionIds").map((editionId) => ({ editionId, favorite: this.favorites.has(editionId) })));
    const favorite = /^\/me\/favorites\/(\d+)$/.exec(path);
    if (favorite && method === "PUT") { this.favorites.add(favorite[1]); return route.fulfill({ status: 204 }); }
    if (favorite && method === "DELETE") { this.favorites.delete(favorite[1]); return route.fulfill({ status: 204 }); }
    if (path === "/me/favorites") return ok({ items: [], page: 0, pageSize: 20, totalCount: "0" });
    if (path === "/cart" && method === "GET") return ok(this.cart());
    if (path === "/cart/items" && method === "POST") {
      this.cartPosts += 1;
      const body = JSON.parse(request.postData()!);
      const existing = this.lines.find((line) => line.editionId === body.editionId);
      const quantity = (existing?.quantity ?? 0) + body.quantity;
      if (quantity > this.stock) {
        return route.fulfill({ status: 409, contentType: "application/problem+json", body: JSON.stringify({ type: "urn:pliego:problem:P3002", title: "Existencias insuficientes", status: 409, detail: "No hay existencias suficientes.", code: "P3002", traceId: "e2e" }) });
      }
      if (existing) existing.quantity = quantity;
      else this.lines.push({ cartItemId: String(100 + this.lines.length), editionId: body.editionId, quantity });
      const line = this.lines.find((candidate) => candidate.editionId === body.editionId)!;
      return ok({ cartId: "40", cartItemId: line.cartItemId, quantity: line.quantity });
    }
    return route.fulfill({ status: 404, contentType: "application/problem+json", body: JSON.stringify({ title: "Sin ruta", status: 404, detail: path, code: "E2E" }) });
  }
}

async function noHorizontalOverflow(page: Page) {
  // Icon ligatures are text until the symbol font arrives; measure the settled page.
  await page.evaluate(() => document.fonts.ready);
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
}

test("desktop Libros: heading, persistent filters, three columns, sort and no price form", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const store = new FakeStore();
  await store.install(page);
  await page.goto("/catalog?productType=PHYSICAL");

  await expect(page.getByRole("heading", { level: 1, name: "Libros" })).toBeVisible();
  await expect(page.getByText("6 ediciones", { exact: true })).toBeVisible();
  const sidebar = page.getByRole("complementary", { name: "Filtros" });
  await expect(sidebar).toBeVisible();
  await expect(page.getByRole("button", { name: /^Filtros/ })).toHaveCount(0);
  await expect(page.getByText("Precio mínimo")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Aplicar precio" })).toHaveCount(0);
  await expect(sidebar.getByText(/^Ebook$|^Audiolibro$/)).toHaveCount(0);

  const grid = page.locator(".edition-grid");
  expect(await grid.evaluate((element) => getComputedStyle(element).gridTemplateColumns.split(" ").length)).toBe(3);
  // Libros identity: the cover stage is warm paper gray, never the eBook lavender.
  const stage = page.locator("[data-bookcard][data-media='physical'] [data-bookcard-shelf]").first();
  await expect(stage).toHaveCSS("background-color", "rgb(236, 235, 228)");

  // Filters expand in place and apply immediately through the URL.
  await sidebar.getByRole("button", { name: "Formato" }).click();
  await sidebar.getByRole("radio", { name: "Tapa dura" }).click();
  await expect(page).toHaveURL(/format=HARDCOVER/);
  await expect(page.getByRole("button", { name: "Quitar Tapa dura" })).toBeVisible();
  // Reset sits under the groups at all times and acts only while something is applied; it keeps Libros.
  const reset = sidebar.getByRole("button", { name: "Restablecer filtros" });
  const documentId = await page.evaluate(() => (window as unknown as { marker: number }).marker = Math.random());
  await reset.click();
  await expect(page).not.toHaveURL(/format=/);
  await expect(page).toHaveURL(/productType=PHYSICAL/);
  await expect(reset).toBeDisabled();
  expect(await page.evaluate(() => (window as unknown as { marker: number }).marker)).toBe(documentId);

  // Price is browsed through the real sort contract.
  // A PLIEGO picker (no native menu): keyboard opens it, arrows move, Enter chooses, focus stays on the trigger.
  const sort = page.getByRole("combobox", { name: "Ordenar por" });
  await expect(sort).toContainText("Título: A–Z");
  await sort.focus();
  await page.keyboard.press("Enter");
  const list = page.getByRole("listbox", { name: "Ordenar por" });
  await expect(list.getByRole("option")).toHaveText([/^Más vendidos/, /^Título: A–Z/, /^Precio: menor a mayor/, /^Precio: mayor a menor/]);
  await expect(list.getByRole("option", { name: "Título: A–Z" })).toHaveAttribute("aria-selected", "true");
  await page.screenshot({ path: test.info().outputPath("sort-open.png") });
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/sort=PRICE_DESC/);
  await expect(list).toBeHidden();
  await expect(sort).toBeFocused();
  await expect(sort).toContainText("Precio: mayor a menor");
  await expect(page.locator("[data-bookcard-title]").first()).toHaveText("Libro 5");
  expect(store.sorts).toContain("PRICE_DESC");
  await noHorizontalOverflow(page);
});

test("narrow widths: filters move into a drawer with the same URL state", async ({ page }) => {
  const store = new FakeStore();
  await store.install(page);
  for (const width of [1024, 768, 390, 320]) {
    await page.setViewportSize({ width, height: 800 });
    await page.goto("/catalog?productType=PHYSICAL");
    await expect(page.locator("[data-bookcard]").first()).toBeVisible();
    await noHorizontalOverflow(page);
    const columns = await page.locator(".edition-grid").evaluate((element) => getComputedStyle(element).gridTemplateColumns.split(" ").length);
    expect(columns).toBe(width >= 600 ? 3 : 2);
    if (width >= 1024) { await expect(page.getByRole("complementary", { name: "Filtros" })).toBeVisible(); continue; }
    await expect(page.getByRole("complementary", { name: "Filtros" })).toHaveCount(0);
    await page.getByRole("button", { name: /^Filtros/ }).click();
    const drawer = page.getByRole("dialog", { name: "Filtros" });
    await drawer.getByRole("button", { name: "Idioma" }).click();
    await drawer.getByRole("radio", { name: "Inglés" }).click();
    await expect(page).toHaveURL(/language=en/);
    await page.keyboard.press("Escape");
    await expect(drawer).toBeHidden();
    await expect(page.getByRole("button", { name: /Filtros, 1 activo/ })).toBeFocused();
  }
});

test("browse cards: the product opens its edition, the favorite on the cover stage acts alone, no cart action", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  const store = new FakeStore();
  await store.install(page);
  await page.goto("/catalog?productType=PHYSICAL");
  const card = page.locator("[data-bookcard]").first();
  await expect(card).toBeVisible();
  // Buying happens on the edition page: no catalog card carries an add action.
  await expect(page.locator("[data-bookcard-cart]")).toHaveCount(0);
  await expect(page.getByRole("button", { name: /^Agregar al carrito/ })).toHaveCount(0);

  // The favorite is a sibling of the product link, set in the stage's top-right corner.
  const link = card.locator("[data-bookcard-link]");
  const heart = card.getByRole("button", { name: "Agregar a favoritos: Cien años de soledad" });
  await expect(link.locator("button")).toHaveCount(0);
  const stage = (await card.locator("[data-bookcard-shelf]").boundingBox())!;
  const heartBox = (await heart.boundingBox())!;
  expect(heartBox.width).toBeGreaterThanOrEqual(44);
  expect(stage.x + stage.width - (heartBox.x + heartBox.width)).toBeLessThanOrEqual(12);
  expect(heartBox.y - stage.y).toBeLessThanOrEqual(12);

  // Keyboard: product link, then its favorite.
  await link.focus();
  await page.keyboard.press("Tab");
  await expect(heart).toBeFocused();

  // A guest is asked to sign in; the saved favorite comes back on the shelf without opening the edition.
  await heart.click();
  await page.getByLabel("Correo electrónico").fill("ana@example.com");
  await page.getByLabel("Contraseña").fill("lectura-segura");
  await page.getByRole("button", { name: "Iniciar sesión" }).click();
  const saved = page.locator("[data-bookcard]").first().getByRole("button", { name: /favoritos: Cien años de soledad/ });
  await expect(saved).toHaveAttribute("aria-pressed", "true");
  await expect(page).toHaveURL(/\/catalog\?productType=PHYSICAL$/);
  expect(store.favorites.has("42")).toBe(true);
  await saved.click();
  await expect(saved).toHaveAttribute("aria-pressed", "false");
  await expect(page).toHaveURL(/\/catalog\?productType=PHYSICAL$/);
  await expect(page.getByRole("dialog", { name: "Tu carrito" })).toHaveCount(0);
  expect(store.cartPosts).toBe(0);

  // The cover/title area opens the edition.
  await page.locator("[data-bookcard]").first().locator("[data-bookcard-title]").click();
  await expect(page).toHaveURL(/\/catalog\/editions\/42\?from=/);
});
