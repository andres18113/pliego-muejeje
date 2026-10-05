import { expect, test, type Browser, type Page } from "@playwright/test";

/** Account pages are reached from the header's account menu. */
async function openAccountSection(page: import("@playwright/test").Page, name: "Perfil" | "Direcciones" | "Favoritos" | "Pedidos") {
  await page.getByRole("button", { name: "Menú de cuenta" }).click();
  await page.getByRole("menuitem", { name, exact: true }).click();
}

const env = (globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env ?? {};
test.skip(!env.PLIEGO_E2E_LIVE, "Set PLIEGO_E2E_LIVE=1 to run against PostgreSQL and the live API.");
const origin = (env.PLIEGO_API_BASE_URL || "http://127.0.0.1:8080").replace(/\/$/, "");
const api = `${origin}/api/v1`;

type Edition = { editionId: string; title: string; authors: string; price: string; available: boolean };

function cardFor(page: Page, editionId: string) {
  return page.locator(`:is(.edition-item, [data-favorite-row]):has(a[href*="/catalog/editions/${editionId}?"])`).first();
}

async function signInWithIntent(page: Page, email: string, password: string) {
  await page.getByLabel("Correo electrónico").fill(email);
  await page.getByLabel("Contraseña").fill(password);
  await page.getByRole("button", { name: "Iniciar sesión" }).click();
}

async function openFavorites(page: Page) {
  await openAccountSection(page, "Favoritos");
  await expect(page.getByRole("heading", { level: 1, name: "Favoritos" })).toBeVisible();
}

async function saveStateFor(browser: Browser, page: Page) {
  return browser.newContext({
    baseURL: "http://127.0.0.1:5173",
    storageState: await page.context().storageState(),
    viewport: { width: 1280, height: 900 },
  });
}

test("persists favorites through catalog, detail, reload, and a new customer session; touch can toggle and add to cart", async ({ browser, page, request }) => {
  const email = `favorites-${Date.now()}@example.invalid`;
  const password = "Favorites-safe-2026";
  const registration = await request.post(`${api}/auth/register`, {
    data: { email, password, firstNames: "Lectora", lastNames: "Favoritos" },
  });
  expect(registration.status()).toBe(201);

  const publicCatalogResponse = await request.get(`${api}/catalog/editions?page=0&pageSize=50`);
  expect(publicCatalogResponse.ok()).toBeTruthy();
  const publicCatalog = await publicCatalogResponse.json() as { items: Edition[] };
  const selected = publicCatalog.items.filter((edition) => edition.available).slice(0, 2);
  const unavailableEdition = publicCatalog.items.find((edition) => !edition.available);
  test.skip(selected.length < 2, "The development catalog needs two available editions for this live flow.");
  const [catalogEdition, detailEdition] = selected;
  let accessToken = "";

  try {
    await page.goto("/catalog");
    const firstCard = cardFor(page, catalogEdition.editionId);
    const favoriteResponse = page.waitForResponse((response) => response.url().includes("/auth/login"));
    await firstCard.getByRole("button", { name: `Agregar a favoritos: ${catalogEdition.title}` }).click();
    await expect(page).toHaveURL(/\/sign-in\?/);
    await signInWithIntent(page, email, password);
    const login = await favoriteResponse;
    accessToken = (await login.json() as { accessToken: string }).accessToken;
    await expect(cardFor(page, catalogEdition.editionId)
      .getByRole("button", { name: `Quitar de favoritos: ${catalogEdition.title}` })).toHaveAttribute("aria-pressed", "true");

    await page.goto(`/catalog/editions/${detailEdition.editionId}?from=%2Fcatalog`);
    const detailFavorite = page.getByRole("button", { name: `Agregar a favoritos: ${detailEdition.title}` });
    await detailFavorite.click();
    await expect(page.getByRole("button", { name: `Quitar de favoritos: ${detailEdition.title}` })).toHaveAttribute("aria-pressed", "true");

    if (unavailableEdition) {
      await page.goto(`/catalog?que=${encodeURIComponent(unavailableEdition.title)}`);
      const unavailableCard = cardFor(page, unavailableEdition.editionId);
      await expect(unavailableCard).toBeVisible();
      await unavailableCard.getByRole("button", { name: `Agregar a favoritos: ${unavailableEdition.title}` }).click();
      await expect(unavailableCard.getByRole("button", { name: `Quitar de favoritos: ${unavailableEdition.title}` })).toHaveAttribute("aria-pressed", "true");
    }

    await page.goto("/catalog");
    const cartButton = cardFor(page, catalogEdition.editionId).getByRole("button", { name: `Agregar al carrito: ${catalogEdition.title}` });
    await cartButton.click();
    await expect(cardFor(page, catalogEdition.editionId).locator("[data-bookcard-feedback]")).toContainText("Agregado al carrito.");

    await openFavorites(page);
    const favoriteCount = unavailableEdition ? 3 : 2;
    await expect(page.locator("[data-favorite-row]")).toHaveCount(favoriteCount);
    const favoriteTitles = await page.locator("[data-bookcard-title]").allTextContents();
    expect(favoriteTitles).toContain(catalogEdition.title);
    expect(favoriteTitles).toContain(detailEdition.title);
    if (unavailableEdition) {
      expect(favoriteTitles).toContain(unavailableEdition.title);
      await expect(cardFor(page, unavailableEdition.editionId).locator("[data-stockstatus]")).toContainText("No disponible");
    }
    const listedFavorite = cardFor(page, catalogEdition.editionId);
    await expect(listedFavorite).toContainText(catalogEdition.authors);
    const expectedPrice = new Intl.NumberFormat("es-EC", { minimumFractionDigits: 2, maximumFractionDigits: 2 })
      .format(Number(catalogEdition.price));
    await expect(listedFavorite.locator("[data-bookcard-price]")).toContainText(expectedPrice);
    await expect(listedFavorite).toContainText("Disponible");
    await expect(listedFavorite.locator("[data-bookcard-link]")).toHaveAttribute("href", new RegExp(`/catalog/editions/${catalogEdition.editionId}\\?`));

    await page.reload();
    await expect(page.locator("[data-favorite-row]")).toHaveCount(favoriteCount);
    await expect(page.locator("[data-bookcard-title]", { hasText: catalogEdition.title })).toBeVisible();

    const reopened = await saveStateFor(browser, page);
    const reopenedPage = await reopened.newPage();
    try {
      await reopenedPage.goto("/favorites");
      await expect(reopenedPage.locator("[data-favorite-row]")).toHaveCount(favoriteCount);
      await expect(reopenedPage.locator("[data-bookcard-title]", { hasText: detailEdition.title })).toBeVisible();
    } finally {
      await reopened.close();
    }

    const mobileContext = await browser.newContext({
      baseURL: "http://127.0.0.1:5173",
      storageState: await page.context().storageState(),
      viewport: { width: 390, height: 844 },
      isMobile: true,
      hasTouch: true,
    });
    const mobile = await mobileContext.newPage();
    try {
      await mobile.goto("/catalog");
      const mobileCard = cardFor(mobile, detailEdition.editionId);
      const mobileActions = mobileCard.locator("[data-bookcard-actions]");
      await expect(mobileActions).toBeVisible();
      expect(await mobileActions.evaluate((element) => getComputedStyle(element).position)).toBe("static");
      await mobileCard.getByRole("button", { name: `Quitar de favoritos: ${detailEdition.title}` }).tap();
      await expect(mobileCard.getByRole("button", { name: `Agregar a favoritos: ${detailEdition.title}` })).toHaveAttribute("aria-pressed", "false");
      await mobileCard.getByRole("button", { name: `Agregar a favoritos: ${detailEdition.title}` }).tap();
      await expect(mobileCard.getByRole("button", { name: `Quitar de favoritos: ${detailEdition.title}` })).toHaveAttribute("aria-pressed", "true");
      await mobileCard.getByRole("button", { name: `Agregar al carrito: ${detailEdition.title}` }).tap();
      await expect(mobileCard.locator("[data-bookcard-feedback]")).toContainText("Agregado al carrito.");
      await expect(mobileCard.getByRole("button", { name: `Agregar al carrito: ${detailEdition.title}` })).toBeEnabled();
      await expect.poll(() => mobile.evaluate(() => document.documentElement.scrollWidth)).toBe(390);
    } finally {
      await mobileContext.close();
    }

  } finally {
    if (accessToken) {
      const headers = { Authorization: `Bearer ${accessToken}` };
      const cart = await request.get(`${api}/cart`, { headers });
      if (cart.ok()) {
        const cartBody = await cart.json() as { items: { cartItemId: string }[] };
        for (const item of cartBody.items) await request.delete(`${api}/cart/items/${item.cartItemId}`, { headers });
      }
      await request.delete(`${api}/me/favorites/${catalogEdition.editionId}`, { headers });
      await request.delete(`${api}/me/favorites/${detailEdition.editionId}`, { headers });
      if (unavailableEdition) await request.delete(`${api}/me/favorites/${unavailableEdition.editionId}`, { headers });
    }
  }
});

test("reconciles a lost successful DELETE using the real authoritative favorite status", async ({ page, request }) => {
  const email = `favorite-loss-${Date.now()}@pliego.local`, password = "Lectura-segura-2026";
  expect((await request.post(`${api}/auth/register`, { data: { email, password, firstNames: "Lectora", lastNames: "Prueba" } })).status()).toBe(201);
  const catalog = await (await request.get(`${api}/catalog/editions?page=0&pageSize=20`)).json();
  const edition = catalog.items[0] as Edition;
  expect(edition).toBeTruthy();
  await page.goto("/sign-in?from=%2Fcatalog");
  const loginResponse = page.waitForResponse(response => response.url().endsWith("/auth/login") && response.request().method() === "POST");
  await signInWithIntent(page, email, password);
  const login = await (await loginResponse).json();
  await expect(page).toHaveURL(/\/catalog$/);
  const card = cardFor(page, edition.editionId);
  await card.getByRole("button", { name: `Agregar a favoritos: ${edition.title}` }).click();
  const remove = card.getByRole("button", { name: `Quitar de favoritos: ${edition.title}` });
  await expect(remove).toHaveAttribute("aria-pressed", "true");
  let deletes = 0;
  await page.route(`**/api/v1/me/favorites/${edition.editionId}`, async route => {
    deletes++;
    expect((await route.fetch()).status()).toBe(204);
    await route.abort("failed");
  });
  await remove.focus(); await page.keyboard.press("Enter");
  await expect(card.getByRole("button", { name: `Agregar a favoritos: ${edition.title}` })).toHaveAttribute("aria-pressed", "false");
  await expect(card.locator("[data-bookcard-feedback]")).toContainText("Quitado de favoritos.");
  const state = await (await request.get(`${api}/me/favorites/status?editionIds=${edition.editionId}`, { headers: { Authorization: `Bearer ${login.accessToken}` } })).json();
  expect(state).toEqual([{ editionId: edition.editionId, favorite: false }]);
  expect(deletes).toBe(1);
});
