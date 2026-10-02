import { expect, test } from "@playwright/test";

const customerEmail = "ana@example.com";
const publicCategories = [
  { slug: "literatura", name: "Literatura", parentSlug: null },
  { slug: "novela", name: "Novela", parentSlug: "literatura" },
  { slug: "poesia", name: "Poesía", parentSlug: "literatura" },
  { slug: "ciencia", name: "Ciencia", parentSlug: null },
  { slug: "matematicas", name: "Matemáticas", parentSlug: "ciencia" },
  { slug: "historia", name: "Historia", parentSlug: null },
  { slug: "filosofia", name: "Filosofía", parentSlug: null },
  { slug: "arte", name: "Arte", parentSlug: null },
  { slug: "biografias", name: "Biografías", parentSlug: null },
  { slug: "infantil", name: "Infantil", parentSlug: null },
  { slug: "tecnologia", name: "Tecnología", parentSlug: null },
  { slug: "economia", name: "Economía", parentSlug: null },
];

async function mockPublicCatalog(page: import("@playwright/test").Page, categories = publicCategories) {
  await page.route("**/api/v1/auth/refresh", (route) => route.fulfill({ status: 204 }));
  await page.route("**/api/v1/catalog/categories", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({ items: categories }),
  }));
  await page.route("**/api/v1/catalog/filter-options", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({ languages: ["es"], minimumPrice: null, maximumPrice: null }),
  }));
  await page.route("**/api/v1/catalog/editions**", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify(new URL(route.request().url()).pathname.endsWith("/editions/42") ? {
      editionId: "42", bookId: "17", title: "Cien años de soledad", subtitle: null,
      synopsis: "Una historia familiar en Macondo.",
      authors: [{ authorId: "9", name: "Gabriel García Márquez", order: 1 }],
      categories: [{ slug: "literatura", name: "Literatura", parentSlug: null }],
      publisher: { publisherId: "5", name: "Editorial Sur" }, isbn13: "9780306406157",
      sku: "PLG-LIT-042", language: "es", format: "PAPERBACK", pageCount: 496,
      publicationDate: "1967-05-30", price: "18.50", coverUrl: null,
      coverLicense: null, coverSourceUrl: null, coverAttribution: null, available: true,
    } : new URL(route.request().url()).searchParams.has("que") ? {
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

const widths = [320, 375, 768, 1024, 1440, 1920];
for (const colorScheme of ["light", "dark"] as const) for (const width of widths) {
  test(`shared Header entry, search and stable scroll at ${width}px / ${colorScheme}`, async ({ page }) => {
    await page.emulateMedia({ colorScheme }); await page.setViewportSize({ width, height: 900 });
    await mockPublicCatalog(page); await page.goto("/");
    const header = page.getByTestId("site-header"); await expect(header).toBeVisible();
    await expect(header.getByRole("link", { name: "Catálogo", exact: true })).toHaveAttribute("href", "/catalog");
    await expect(header.getByRole("button", { name: "Categorías" })).toHaveCount(0);
    const initial = (await header.boundingBox())!;
    await page.evaluate(() => { document.body.style.minHeight = "1800px"; scrollTo(0, 250); });
    await expect(header).toHaveAttribute("data-scrolled", "true");
    expect((await header.boundingBox())!.height).toBe(initial.height);
    expect((await header.boundingBox())!.y).toBe(0);
    const trigger = header.getByRole("button", { name: "Buscar en el catálogo" });
    await trigger.click();
    const dialog = page.getByRole("dialog", { name: "Buscar en el catálogo" });
    const field = dialog.getByRole("searchbox", { name: "Buscar en el catálogo" });
    await expect(field).toBeFocused(); await field.fill("Cien años");
    await expect(dialog.getByRole("link", { name: /Cien años de soledad/ })).toBeVisible();
    await page.keyboard.press("ArrowDown"); await expect(dialog.getByRole("link", { name: /Cien años de soledad/ })).toBeFocused();
    await page.keyboard.press("Escape"); await expect(trigger).toBeFocused();
    await header.evaluate((node) => { (window as unknown as { headerNode: Element }).headerNode = node; });
    await header.getByRole("link", { name: "Catálogo", exact: true }).click();
    await expect(page).toHaveURL(/\/catalog$/);
    expect(await header.evaluate((node) => node === (window as unknown as { headerNode: Element }).headerNode)).toBe(true);
    for (const route of ["/sign-in", "/register", "/account", "/cart", "/checkout", "/orders", "/favorites", "/missing"]) {
      await page.goto(route); await expect(page.getByTestId("site-header")).toHaveCount(1);
      await expect(page.getByTestId("site-header").getByRole("link", { name: "Catálogo", exact: true })).toBeVisible();
    }
  });
}
test("account keyboard menu and cart remain coherent after navigation and logout", async ({ page }) => {
  await mockPublicCatalog(page); await mockCustomerLogin(page); await signIn(page);
  const header = page.getByTestId("site-header");
  await expect(header.getByRole("link", { name: "Carrito, 3 unidades" })).toBeVisible();
  const account = header.getByRole("button", { name: "Menú de cuenta" });
  await account.focus(); await page.keyboard.press("ArrowDown");
  await expect(page.getByRole("menuitem", { name: "Mi cuenta" })).toBeFocused();
  await page.keyboard.press("Escape"); await expect(account).toBeFocused();
  await account.click(); await page.getByRole("menuitem", { name: "Cerrar sesión" }).click();
  await expect(header.getByRole("link", { name: "Iniciar sesión" })).toBeVisible();
});
test("global suggestions carry the unfiltered search destination", async ({ page }) => {
  await mockPublicCatalog(page); await page.goto("/catalog?category=historia&minPrice=50.00");
  await page.getByRole("button", { name: "Buscar en el catálogo" }).click();
  await page.getByRole("searchbox", { name: "Buscar en el catálogo" }).fill("Cien años");
  await page.getByRole("dialog").getByRole("link", { name: /Cien años de soledad/ }).click();
  await expect(page).toHaveURL(/\/catalog\/editions\/42\?/);
  expect(new URL(page.url()).searchParams.get("from")).toBe("/catalog?que=Cien+a%C3%B1os");
});
