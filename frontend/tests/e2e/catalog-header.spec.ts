import { expect, test } from "@playwright/test";

const customerEmail = "ana@example.com";

async function mockPublicCatalog(page: import("@playwright/test").Page) {
  await page.route("**/api/v1/catalog/categories", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({ items: [] }),
  }));
  await page.route("**/api/v1/catalog/filter-options", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({ languages: ["es"], minimumPrice: null, maximumPrice: null }),
  }));
  await page.route("**/api/v1/catalog/editions**", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify(new URL(route.request().url()).searchParams.has("que") ? {
      items: [{
        editionId: "42",
        bookId: "17",
        title: "Cien años de soledad",
        authors: "Gabriel García Márquez",
        publisher: "Editorial Sur",
        isbn13: "9780306406157",
        price: "18.50",
        coverUrl: null,
        coverLicense: null,
        coverAttribution: null,
        format: "PAPERBACK",
        language: "es",
        available: true,
      }], page: 0, pageSize: 6, totalCount: "1",
    } : { items: [], page: 0, pageSize: 20, totalCount: "0" }),
  }));
}

async function mockCustomerLogin(page: import("@playwright/test").Page) {
  await page.route("**/api/v1/auth/refresh", (route) => route.fulfill({ status: 204 }));
  await page.route("**/api/v1/auth/logout", (route) => route.fulfill({ status: 204 }));
  await page.route("**/api/v1/auth/login", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({
      accessToken: "header-test-token",
      tokenType: "Bearer",
      expiresInSeconds: 1800,
      user: { userId: "100", email: customerEmail, role: "CUSTOMER" },
    }),
  }));
  await page.route("**/api/v1/cart", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({
      cartId: "200",
      state: "ACTIVE",
      items: [{
        cartItemId: "300",
        editionId: "42",
        title: "Cien años de soledad",
        authors: "Gabriel García Márquez",
        sku: "PLG-BK-000014",
        coverUrl: null,
        quantity: 3,
        currentPrice: "20.00",
        currentSubtotal: "60.00",
        available: true,
        unavailabilityReason: null,
      }],
      totalCurrent: "60.00",
    }),
  }));
  await page.route("**/api/v1/me", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({
      customerId: "101",
      email: customerEmail,
      firstNames: "Ana María",
      lastNames: "López",
      phone: null,
      state: "ACTIVE",
    }),
  }));
}

async function signIn(page: import("@playwright/test").Page) {
  await page.goto("/sign-in?from=%2Fcatalog");
  await page.getByLabel("Correo electrónico").fill(customerEmail);
  await page.getByLabel("Contraseña").fill("lectura-segura");
  await page.getByRole("button", { name: "Iniciar sesión" }).click();
  await expect(page).toHaveURL(/\/catalog$/);
}

test("guest header keeps compact actions and responsive search dialog available", async ({ page }) => {
  await mockPublicCatalog(page);
  await page.goto("/");

  const header = page.locator(".site-header");
  await expect(header.getByRole("link", { name: "PLIEGO, ir al inicio" })).toBeVisible();
  await expect(header.getByRole("search")).toHaveCount(0);
  const searchTrigger = header.getByRole("button", { name: "Buscar en el catálogo" });
  await expect(searchTrigger).toBeVisible();
  await expect(header.getByRole("link", { name: "Iniciar sesión" })).toBeVisible();
  await expect(header.getByRole("button", { name: "Menú de cuenta" })).toHaveCount(0);

  for (const width of [1920, 1440, 768, 390, 320]) {
    await page.setViewportSize({ width, height: 900 });
    const searchTarget = await searchTrigger.boundingBox();
    expect(searchTarget?.width).toBe(44);
    expect(searchTarget?.height).toBe(44);
    const sizes = await header.evaluate((element) => ({
      scroll: element.scrollWidth,
      client: element.clientWidth,
      documentScroll: document.documentElement.scrollWidth,
      viewport: window.innerWidth,
    }));
    expect(sizes.scroll, `guest header overflows at ${width}px`).toBeLessThanOrEqual(sizes.client);
    expect(sizes.documentScroll, `guest page overflows at ${width}px`).toBeLessThanOrEqual(sizes.viewport);

    await searchTrigger.click();
    const dialog = page.getByRole("dialog", { name: "Buscar en el catálogo" });
    const searchbox = dialog.getByRole("searchbox", { name: "Buscar en el catálogo" });
    await expect(dialog).toBeVisible();
    await expect(searchbox).toBeFocused();
    expect((await searchbox.boundingBox())?.width).toBeGreaterThanOrEqual(130);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
    await expect(searchTrigger).toBeFocused();
  }

  await searchTrigger.click();
  await page.getByRole("button", { name: "Cerrar búsqueda" }).click();
  await expect(searchTrigger).toBeFocused();
  await searchTrigger.click();
  const populatedSearch = page.getByRole("searchbox", { name: "Buscar en el catálogo" });
  await populatedSearch.fill("Cien años");
  await expect(page.locator(".search-suggestion-link")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(searchTrigger).toBeFocused();
});

test("global suggestions return real editions that can be opened by keyboard", async ({ page }) => {
  await mockPublicCatalog(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");

  const trigger = page.getByRole("button", { name: "Buscar en el catálogo" });
  await trigger.click();
  const searchbox = page.getByRole("searchbox", { name: "Buscar en el catálogo" });
  await searchbox.fill("Cien años");
  const result = page.getByRole("link", { name: /Cien años de soledad.*Gabriel García Márquez/ });
  await expect(result).toBeVisible();
  const desktopBounds = await page.evaluate(() => {
    const field = document.querySelector(".search-dialog-form")!.getBoundingClientRect();
    const panel = document.querySelector(".search-suggestions")!.getBoundingClientRect();
    return { fieldX: field.x, fieldWidth: field.width, panelX: panel.x, panelWidth: panel.width };
  });
  expect(Math.abs(desktopBounds.fieldX - desktopBounds.panelX)).toBeLessThanOrEqual(1);
  expect(Math.abs(desktopBounds.fieldWidth - desktopBounds.panelWidth)).toBeLessThanOrEqual(1);
  await page.keyboard.press("ArrowDown");
  await expect(result).toBeFocused();
  await page.keyboard.press("ArrowUp");
  await expect(searchbox).toBeFocused();
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("Enter");

  await expect(page).toHaveURL(/\/catalog\/editions\/42\?/);
  expect(new URL(page.url()).searchParams.get("from")).toBe("/catalog?que=Cien+a%C3%B1os");

  for (const width of [390, 320]) {
    await page.setViewportSize({ width, height: 844 });
    await page.goto("/");
    const mobileTrigger = page.getByRole("button", { name: "Buscar en el catálogo" });
    await mobileTrigger.click();
    await page.getByRole("searchbox", { name: "Buscar en el catálogo" }).fill("Cien años");
    await expect(page.locator(".search-suggestion-link")).toBeVisible();
    const mobileBounds = await page.evaluate(() => {
      const field = document.querySelector(".search-dialog-form")!.getBoundingClientRect();
      const panel = document.querySelector(".search-suggestions")!.getBoundingClientRect();
      return { fieldX: field.x, fieldWidth: field.width, panelX: panel.x, panelWidth: panel.width };
    });
    expect(Math.abs(mobileBounds.fieldX - mobileBounds.panelX), `suggestions align at ${width}px`).toBeLessThanOrEqual(1);
    expect(Math.abs(mobileBounds.fieldWidth - mobileBounds.panelWidth), `suggestions match field width at ${width}px`).toBeLessThanOrEqual(1);
    await page.getByRole("button", { name: "Cerrar búsqueda" }).click();
    await expect(mobileTrigger).toBeFocused();
  }
});

test("customer header keeps Cart direct and groups profile, orders, and sign-out in an accessible menu", async ({ page }) => {
  await mockPublicCatalog(page);
  await mockCustomerLogin(page);
  await signIn(page);

  const header = page.locator(".site-header");
  const cart = header.getByRole("link", { name: /Carrito.*3 unidades/ });
  const trigger = header.getByRole("button", { name: "Menú de cuenta" });
  await expect(cart).toBeVisible();
  await expect(cart).toHaveAttribute("aria-label", "Carrito, 3 unidades");
  await expect(cart.getByText("Carrito", { exact: true })).toHaveCount(0);
  await expect(cart.locator(".account-cart-count")).toHaveCSS("background-color", "rgb(36, 81, 63)");
  await expect(trigger).toBeVisible();
  await expect(header.getByText(customerEmail)).toHaveCount(0);

  for (const width of [1920, 1440, 768, 390, 320]) {
    await page.setViewportSize({ width, height: 900 });
    await expect(cart).toBeVisible();
    await expect(trigger).toBeVisible();
    const sizes = await header.evaluate((element) => ({
      scroll: element.scrollWidth,
      client: element.clientWidth,
      documentScroll: document.documentElement.scrollWidth,
      viewport: window.innerWidth,
    }));
    expect(sizes.scroll, `customer header overflows at ${width}px`).toBeLessThanOrEqual(sizes.client);
    expect(sizes.documentScroll, `customer page overflows at ${width}px`).toBeLessThanOrEqual(sizes.viewport);

    const proportions = await header.evaluate((element) => {
      const rect = (selector: string) => element.querySelector<HTMLElement>(selector)?.getBoundingClientRect();
      const search = rect(".search-trigger");
      const cartTarget = rect(".account-cart");
      const accountTarget = rect(".account-menu-trigger");
      const glyphs = [...element.querySelectorAll<HTMLElement>(".masthead .material-symbol--header")].map((glyph) => ({
        size: getComputedStyle(glyph).fontSize,
        weight: getComputedStyle(glyph).fontWeight,
        top: glyph.getBoundingClientRect().top,
      }));
      return {
        searchWidth: search?.width ?? 0,
        cartHeight: cartTarget?.height ?? 0,
        accountHeight: accountTarget?.height ?? 0,
        glyphs,
      };
    });
    expect(proportions.searchWidth).toBe(44);
    expect(proportions.cartHeight).toBeGreaterThanOrEqual(44);
    expect(proportions.accountHeight).toBeGreaterThanOrEqual(44);
    expect(new Set(proportions.glyphs.map((glyph) => `${glyph.size}/${glyph.weight}`)).size).toBe(1);
    if (width > 740) {
      const glyphY = proportions.glyphs.map((glyph) => glyph.top);
      expect(Math.max(...glyphY) - Math.min(...glyphY)).toBeLessThanOrEqual(1);
    }
  }

  await trigger.focus();
  await page.keyboard.press("ArrowDown");
  const accountLink = page.getByRole("menuitem", { name: "Mi cuenta" });
  await expect(accountLink).toBeFocused();
  await expect(page.getByRole("menuitem", { name: "Mis pedidos" })).toBeVisible();
  await expect(page.getByRole("menuitem", { name: "Cerrar sesión" })).toBeVisible();
  await expect(page.getByText("Ana María López")).toBeVisible();
  await expect(page.getByText(customerEmail)).toBeVisible();
  await expect(cart).toBeVisible();

  await page.keyboard.press("ArrowDown");
  await expect(page.getByRole("menuitem", { name: "Mis pedidos" })).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("menu")).toHaveCount(0);
  await expect(trigger).toBeFocused();

  await trigger.click();
  await page.getByRole("menuitem", { name: "Cerrar sesión" }).click();
  await expect(header.getByRole("link", { name: "Iniciar sesión" })).toBeVisible();
  await expect(header.getByRole("button", { name: "Menú de cuenta" })).toHaveCount(0);
  await expect(header.getByRole("link", { name: /Carrito/ })).toHaveCount(0);
});
