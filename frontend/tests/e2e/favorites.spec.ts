import { expect, test, type Page } from "@playwright/test";

const editions = [
  {
    editionId: "42", bookId: "17", title: "Cien años de soledad", authors: "Gabriel García Márquez",
    publisher: "Editorial Sur", isbn13: "9780306406157", price: "18.50", coverUrl: null,
    coverLicense: null, coverAttribution: null, format: "PAPERBACK", language: "es", available: true,
  },
  {
    editionId: "43", bookId: "18", title: "La casa de los espíritus", authors: "Isabel Allende",
    publisher: "Editorial Sur", isbn13: "9780306406158", price: "22.00", coverUrl: null,
    coverLicense: null, coverAttribution: null, format: "HARDCOVER", language: "es", available: false,
  },
];

async function mockFavoritesApi(page: Page) {
  const saved = new Set<string>();
  let cartQuantity = 0;

  await page.route("**/api/v1/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname.replace(/^.*\/api\/v1/, "");
    const json = (body: unknown, status = 200) => route.fulfill({
      status,
      contentType: "application/json",
      body: JSON.stringify(body),
    });

    if (path === "/auth/refresh" && request.method() === "POST") return route.fulfill({ status: 204 });
    if (path === "/auth/login" && request.method() === "POST") return json({
      accessToken: "test-token", tokenType: "Bearer", expiresInSeconds: 1800,
      user: { userId: "100", email: "lectora@example.invalid", role: "CUSTOMER" },
    });
    if (path === "/catalog/categories") return json({ items: [{ slug: "narrativa", name: "Narrativa", parentSlug: null }] });
    if (path === "/catalog/filter-options") return json({ languages: ["es"], minimumPrice: "18.50", maximumPrice: "22.00" });
    if (path === "/catalog/editions") return json({ items: editions, page: 0, pageSize: 20, totalCount: "2" });
    if (path === "/catalog/editions/42") return json({
      ...editions[0], subtitle: null, synopsis: "Una familia en Macondo.",
      authors: [{ authorId: "9", name: editions[0].authors, order: 1 }],
      categories: [], publisher: { publisherId: "5", name: editions[0].publisher }, sku: "PLG-LIT-042",
      pageCount: 496, publicationDate: "1967-05-30", coverSourceUrl: null,
    });
    if (path === "/me/favorites/status") return json(url.searchParams.getAll("editionIds").map((editionId) => ({
      editionId,
      favorite: saved.has(editionId),
    })));
    if (path === "/me/favorites" && request.method() === "GET") {
      const items = editions.filter((edition) => saved.has(edition.editionId)).map((edition) => ({
        ...edition,
        favoritedAt: "2026-09-29T12:00:00Z",
      }));
      return json({ items, page: Number(url.searchParams.get("page") || 0), pageSize: 20, totalCount: String(items.length) });
    }
    if (path.startsWith("/me/favorites/") && request.method() === "PUT") {
      saved.add(path.split("/").at(-1) ?? "");
      return route.fulfill({ status: 204 });
    }
    if (path.startsWith("/me/favorites/") && request.method() === "DELETE") {
      saved.delete(path.split("/").at(-1) ?? "");
      return route.fulfill({ status: 204 });
    }
    if (path === "/me" && request.method() === "GET") return json({
      customerId: "87", email: "lectora@example.invalid", firstNames: "Ana", lastNames: "Lectora",
      phone: null, state: "ACTIVE",
    });
    if (path === "/cart" && request.method() === "GET") return json({
      cartId: "7", state: "ACTIVE",
      items: cartQuantity ? [{
        cartItemId: "501", editionId: "42", title: editions[0].title, authors: editions[0].authors,
        sku: "PLG-LIT-042", coverUrl: null, quantity: cartQuantity, currentPrice: "18.50",
        currentSubtotal: `${(18.5 * cartQuantity).toFixed(2)}`, available: true, unavailabilityReason: null,
      }] : [],
      totalCurrent: (18.5 * cartQuantity).toFixed(2),
    });
    if (path === "/cart/items" && request.method() === "POST") {
      cartQuantity += 1;
      return json({ cartId: "7", cartItemId: "501", quantity: cartQuantity });
    }
    return json({ code: "NOT_FOUND", title: "No encontrado", detail: path }, 404);
  });
}

test("guests retain the favorite action through sign-in; customers can browse, toggle, and add from a card", async ({ page }) => {
  await mockFavoritesApi(page);
  await page.goto("/catalog");

  await page.evaluate(() => document.fonts.ready);

  const firstCard = page.locator(".edition-item").first();
  const cover = firstCard.locator("[data-bookcard-link]");
  await cover.focus();
  const addFavorite = firstCard.getByRole("button", { name: "Agregar a favoritos: Cien años de soledad" });
  await expect(addFavorite).toBeVisible();
  // Focus follows the card's visual order: link → cart → favorite.
  await page.keyboard.press("Tab");
  await expect(firstCard.locator("[data-bookcard-cart]")).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(addFavorite).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/sign-in\?/);

  await page.getByLabel("Correo electrónico").fill("lectora@example.invalid");
  await page.getByLabel("Contraseña").fill("Lectura-segura-2026");
  await page.getByRole("button", { name: "Iniciar sesión" }).click();
  await expect(page).toHaveURL("http://127.0.0.1:5173/catalog");
  await expect(firstCard.getByRole("button", { name: "Quitar de favoritos: Cien años de soledad" })).toHaveAttribute("aria-pressed", "true");
  await expect(firstCard.locator("[data-bookcard-feedback]")).toContainText("Agregado a favoritos.");

  await firstCard.getByRole("button", { name: "Agregar al carrito: Cien años de soledad" }).click();
  await expect(firstCard.locator("[data-bookcard-feedback]")).toContainText("Agregado al carrito.");

  await page.getByRole("button", { name: "Menú de cuenta" }).click();
  await page.getByRole("menuitem", { name: "Mi cuenta" }).click();
  await page.getByRole("link", { name: "Favoritos" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Favoritos" })).toBeVisible();
  await expect(page.locator(".edition-item")).toHaveCount(1);
  const favorite = page.locator(".edition-item").first();
  await expect(favorite).toContainText("Cien años de soledad");
  await expect(favorite).toContainText("Gabriel García Márquez");
  await expect(favorite).toContainText("$\u00a018,50");
  await expect(favorite).toContainText("Disponible");
  await expect(favorite.locator("[data-bookcard-link]")).toHaveAttribute("href", /\/catalog\/editions\/42\?/);
  await favorite.getByRole("button", { name: "Quitar de favoritos: Cien años de soledad" }).click();
  await expect(page.getByRole("heading", { name: "Aún no guardaste favoritos." })).toBeVisible();
});

test("touch layouts keep both cover actions visible without hover and without horizontal overflow", async ({ browser }) => {
  const context = await browser.newContext({
    baseURL: "http://127.0.0.1:5173",
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
  });
  const page = await context.newPage();
  await mockFavoritesApi(page);
  await page.goto("/catalog");

  const firstCard = page.locator(".edition-item").first();
  const actions = firstCard.locator("[data-bookcard-actions]");
  await expect(firstCard).toBeVisible();
  await page.evaluate(() => document.fonts.ready);
  await expect(actions).toBeVisible();
  await expect(firstCard.getByRole("button", { name: "Agregar a favoritos: Cien años de soledad" })).toBeVisible();
  await expect(firstCard.getByRole("button", { name: "Agregar al carrito: Cien años de soledad" })).toBeVisible();
  expect(await actions.evaluate((element) => getComputedStyle(element).position)).not.toBe("absolute");
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(390);
  await context.close();
});

test("rolls back the heart when saving a favorite fails", async ({ page }) => {
  await mockFavoritesApi(page);
  await page.route("**/api/v1/me/favorites/42", (route) => route.fulfill({
    status: 503,
    contentType: "application/problem+json",
    body: JSON.stringify({
      type: "urn:pliego:problem:INTERNAL_SERVER_ERROR",
      title: "Servicio no disponible",
      detail: "No pudimos guardar el cambio.",
      status: 503,
      code: "INTERNAL_SERVER_ERROR",
    }),
  }));
  await page.goto("/catalog");
  await page.locator(".edition-item").first()
    .getByRole("button", { name: "Agregar a favoritos: Cien años de soledad" }).click();
  await page.getByLabel("Correo electrónico").fill("lectora@example.invalid");
  await page.getByLabel("Contraseña").fill("Lectura-segura-2026");
  await page.getByRole("button", { name: "Iniciar sesión" }).click();

  const firstCard = page.locator(".edition-item").first();
  const favoriteButton = firstCard.getByRole("button", { name: "Agregar a favoritos: Cien años de soledad" });
  await expect(firstCard.getByRole("alert")).toContainText("No pudimos guardar el cambio.");
  await expect(favoriteButton).toHaveAttribute("aria-pressed", "false");
});
