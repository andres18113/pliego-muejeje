import { expect, test, type Page } from "@playwright/test";
import { storefrontNavigationFixture } from "../../src/test/storefrontFixture";

/**
 * Guardado para después (ADR 0045), Google Store style: a move between the cart and the saved list happens in
 * the page — the book leaves its section only after the server confirms, the page travels to where it went and
 * keeps the keyboard on it — and Favoritos is never written.
 */
type Line = { editionId: string; title: string; quantity: number; price: string };
const books: Line[] = [
  { editionId: "42", title: "Cien años de soledad", quantity: 2, price: "18.50" },
  { editionId: "43", title: "Rayuela", quantity: 1, price: "21.00" },
  { editionId: "44", title: "Pedro Páramo", quantity: 1, price: "12.00" },
  { editionId: "45", title: "La tregua", quantity: 1, price: "14.00" },
];

function projection(book: Line) {
  const subtotal = (Number(book.price) * book.quantity).toFixed(2);
  return { editionId: book.editionId, title: book.title, authors: "Autor de prueba", sku: `PLG-${book.editionId}`, coverUrl: null, quantity: book.quantity,
    currentPrice: book.price, currentSubtotal: subtotal, available: true, unavailabilityReason: null, requiresPhysicalFulfillment: true,
    quantityEditable: true, format: "PAPERBACK" };
}

async function mockApi(page: Page, options: { refuseMove?: boolean } = {}) {
  const state = { cart: books.map(book => ({ ...book })), saved: [] as Line[], favoriteWrites: 0, moves: 0 };
  const cartBody = () => {
    const items = state.cart.map(book => ({ ...projection(book), cartItemId: `1${book.editionId}` }));
    const total = items.reduce((sum, item) => sum + Number(item.currentSubtotal), 0).toFixed(2);
    return { cartId: "40", state: "ACTIVE", requiresPhysicalFulfillment: items.length > 0, physicalItemCount: items.length, digitalItemCount: 0, items,
      totalCurrent: total, subtotal: total, taxRate: "0.00", taxAmount: "0.00", shippingAmount: "0.00", total };
  };
  const savedBody = () => ({ items: state.saved.map(book => ({ ...projection(book), savedItemId: `5${book.editionId}` })), totalCount: state.saved.length });
  await page.route("**/api/v1/**", async route => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    const method = request.method();
    const json = (body: unknown, status = 200) => route.fulfill({ status, json: body });
    if (path.endsWith("/auth/refresh")) return json({ accessToken: "test-token", tokenType: "Bearer", expiresInSeconds: 1800, user: { userId: "100", email: "controlled@example.invalid", role: "CUSTOMER" } });
    if (path.endsWith("/storefront/navigation")) return json(storefrontNavigationFixture);
    if (path.endsWith("/me")) return json({ customerId: "100", email: "controlled@example.invalid", firstNames: "Ana", lastNames: "Lectora", phone: null, state: "ACTIVE", version: "0", emailVerified: true });
    if (path.includes("/me/favorites")) { if (method !== "GET") state.favoriteWrites++; return json({ items: [], page: 0, pageSize: 20, totalCount: "0" }); }
    if (path === "/api/v1/cart") return json(cartBody());
    if (path === "/api/v1/cart/saved") return json(savedBody());
    const save = /^\/api\/v1\/cart\/items\/1(\d+)\/save-for-later$/.exec(path);
    if (save && method === "POST") {
      state.moves++;
      const book = state.cart.find(line => line.editionId === save[1])!;
      state.cart = state.cart.filter(line => line !== book); state.saved = [book, ...state.saved];
      return json({ cart: cartBody(), saved: savedBody() });
    }
    const back = /^\/api\/v1\/cart\/saved\/5(\d+)\/move-to-cart$/.exec(path);
    if (back && method === "POST") {
      state.moves++;
      if (options.refuseMove) return json({ type: "urn:pliego:problem:P3002", code: "P3002", status: 409, title: "Existencias insuficientes", detail: "No hay existencias suficientes para la cantidad solicitada." }, 409);
      const book = state.saved.find(line => line.editionId === back[1])!;
      state.saved = state.saved.filter(line => line !== book); state.cart = [...state.cart, book];
      return json({ cart: cartBody(), saved: savedBody() });
    }
    return json({ items: [], page: 0, pageSize: 20, totalCount: "0" });
  });
  return state;
}

const inViewport = (page: Page, selector: string) => page.locator(selector).evaluate(node => {
  const rect = node.getBoundingClientRect();
  return rect.top >= 0 && rect.bottom <= window.innerHeight;
});

for (const width of [390, 1280]) {
  test(`moves a book to Guardado para después and back in the page at ${width}px`, async ({ page }) => {
    const state = await mockApi(page);
    await page.setViewportSize({ width, height: 800 });
    await page.goto("/cart");
    await expect(page.locator("[data-cart-line]")).toHaveCount(4);

    // Cart → saved: the line leaves, the page travels to the saved row, which keeps the keyboard.
    await page.getByRole("button", { name: "Guardar Cien años de soledad para después" }).click();
    const savedRow = page.locator('[data-saved-item][data-edition-id="42"]');
    await expect(savedRow).toBeVisible();
    await expect(savedRow.getByRole("link", { name: "Cien años de soledad" })).toBeFocused();
    await expect.poll(() => inViewport(page, '[data-saved-item][data-edition-id="42"]')).toBe(true);
    await expect(savedRow.getByText("Cantidad: 2")).toBeAttached();
    await expect(page.locator('[data-cart-line][data-edition-id="42"]')).toHaveCount(0);
    await expect(page.getByRole("complementary", { name: "Resumen del pedido" })).toContainText("$ 47,00");
    await expect(page.getByRole("button", { name: "Deshacer" })).toHaveCount(0);

    // Saved → cart: "Mover al carrito", then back to the line with its quantity.
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await savedRow.getByRole("button", { name: "Mover Cien años de soledad al carrito" }).click();
    const line = page.locator('[data-cart-line][data-edition-id="42"]');
    await expect(line).toBeVisible();
    await expect(line.getByRole("link", { name: "Cien años de soledad" })).toBeFocused();
    await expect.poll(() => inViewport(page, '[data-cart-line][data-edition-id="42"]')).toBe(true);
    await expect(line.getByRole("combobox", { name: "Cantidad de Cien años de soledad" })).toContainText("2");
    await expect(page.locator("[data-saved-item]")).toHaveCount(0);
    await expect(page.getByRole("complementary", { name: "Resumen del pedido" })).toContainText("$ 84,00");

    expect(state.moves).toBe(2);
    expect(state.favoriteWrites).toBe(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  });
}

test("a refused move keeps the book saved and explains why", async ({ page }) => {
  const state = await mockApi(page, { refuseMove: true });
  await page.goto("/cart");
  await page.getByRole("button", { name: "Guardar Rayuela para después" }).click();
  const savedRow = page.locator('[data-saved-item][data-edition-id="43"]');
  await savedRow.getByRole("button", { name: "Mover Rayuela al carrito" }).click();
  await expect(savedRow.getByRole("alert")).toHaveText("No hay existencias suficientes para esta cantidad. Sigue guardado.");
  await expect(savedRow).toBeVisible();
  await expect(page.locator('[data-cart-line][data-edition-id="43"]')).toHaveCount(0);
  expect(state.favoriteWrites).toBe(0);
});

test("with reduced motion the page jumps to the moved book instead of gliding", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await mockApi(page);
  await page.setViewportSize({ width: 390, height: 700 });
  await page.goto("/cart");
  await page.getByRole("button", { name: "Guardar Cien años de soledad para después" }).click();
  const savedRow = '[data-saved-item][data-edition-id="42"]';
  await expect(page.locator(savedRow)).toBeVisible();
  // No smooth scroll: the row is already in place on the next frame.
  await page.evaluate(() => new Promise(requestAnimationFrame));
  expect(await inViewport(page, savedRow)).toBe(true);
});
