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
    body: JSON.stringify({ items: [], page: 0, pageSize: 20, totalCount: "0" }),
  }));
}

async function mockCustomerLogin(page: import("@playwright/test").Page) {
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

test("guest header keeps search and sign-in actions available without overflow", async ({ page }) => {
  await mockPublicCatalog(page);
  await page.goto("/");

  const header = page.locator(".site-header");
  await expect(header.getByRole("link", { name: "PLIEGO, ir al inicio" })).toBeVisible();
  await expect(header.getByRole("search")).toBeVisible();
  await expect(header.getByRole("link", { name: "Iniciar sesión" })).toBeVisible();
  await expect(header.getByRole("link", { name: "Crear cuenta" })).toBeVisible();
  await expect(header.getByRole("button", { name: "Menú de cuenta" })).toHaveCount(0);

  for (const width of [1440, 768, 390, 320]) {
    await page.setViewportSize({ width, height: 900 });
    await expect(header.getByRole("search")).toBeVisible();
    const sizes = await header.evaluate((element) => ({
      scroll: element.scrollWidth,
      client: element.clientWidth,
      documentScroll: document.documentElement.scrollWidth,
      viewport: window.innerWidth,
    }));
    expect(sizes.scroll, `guest header overflows at ${width}px`).toBeLessThanOrEqual(sizes.client);
    expect(sizes.documentScroll, `guest page overflows at ${width}px`).toBeLessThanOrEqual(sizes.viewport);
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
  await expect(trigger).toBeVisible();
  await expect(header.getByText(customerEmail)).toHaveCount(0);

  for (const width of [1440, 768, 390, 320]) {
    await page.setViewportSize({ width, height: 900 });
    await expect(header.getByRole("search")).toBeVisible();
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
