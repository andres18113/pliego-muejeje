import { expect, test } from "@playwright/test";
import { storefrontNavigationFixture } from "../../src/test/storefrontFixture";

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
  await page.route("**/api/v1/storefront/navigation", route => route.fulfill({ contentType: "application/json", body: JSON.stringify(storefrontNavigationFixture) }));
  await page.route("**/api/v1/auth/refresh", (route) => route.fulfill({ status: 204 }));
  await page.route("**/api/v1/help/categories", route => route.fulfill({ contentType: "application/json", body: JSON.stringify({ items: [] }) }));
  await page.route("**/api/v1/help/articles**", route => route.fulfill({ contentType: "application/json", body: JSON.stringify({ items: [], page: 0, pageSize: 20, totalCount: "0" }) }));
  await page.route("**/api/v1/catalog/categories**", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({ items: categories }),
  }));
  await page.route("**/api/v1/catalog/filter-options**", (route) => route.fulfill({
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
      requiresPhysicalFulfillment: true,
      physicalItemCount: 1,
      digitalItemCount: 0,
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
        requiresPhysicalFulfillment: true,
        quantityEditable: true,
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
      state: "ACTIVE", version: "0",
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
    if (width >= 960) await expect(header.getByRole("link", { name: "Libros", exact: true })).toHaveAttribute("href", "/catalog?productType=PHYSICAL");
    else await expect(header.getByRole("button", { name: "Abrir navegación" })).toBeVisible();
    await expect(header.getByRole("button", { name: "Categorías" })).toHaveCount(0);
    const initial = (await header.boundingBox())!;
    const contentTop = () => page.evaluate(() => document.querySelector("main")!.getBoundingClientRect().top + window.scrollY);
    const contentBefore = await contentTop();
    await page.evaluate(() => { document.body.style.minHeight = "1800px"; scrollTo(0, 250); });
    await expect(header).toHaveAttribute("data-scrolled", "true");
    // The scrolled bar compacts, but the page content never shifts underneath it.
    await expect.poll(async () => (await header.boundingBox())!.height).toBeLessThan(initial.height);
    await expect.poll(contentTop).toBe(contentBefore);
    expect((await header.boundingBox())!.y).toBe(0);
    const trigger = header.getByRole("button", { name: "Buscar libros en el catálogo" });
    await trigger.click();
    const dialog = page.getByRole("dialog", { name: "Buscar en el catálogo" });
    const field = dialog.getByRole("searchbox", { name: "Buscar en el catálogo" });
    await expect(field).toBeFocused(); await field.fill("Cien años");
    await expect(dialog.getByRole("link", { name: /Cien años de soledad/ })).toBeVisible();
    await page.keyboard.press("ArrowDown"); await expect(dialog.getByRole("link", { name: /Cien años de soledad/ })).toBeFocused();
    await page.keyboard.press("Escape"); await expect(trigger).toBeFocused();
    await header.evaluate((node) => { (window as unknown as { headerNode: Element }).headerNode = node; });
    if (width < 960) {
      await header.getByRole("button", { name: "Abrir navegación" }).click();
      await page.getByRole("dialog", { name: "Navegación", exact: true }).getByRole("link", { name: "Libros", exact: true }).click();
    } else await header.getByRole("link", { name: "Libros", exact: true }).click();
    await expect(page).toHaveURL("/catalog?productType=PHYSICAL");
    expect(await header.evaluate((node) => node === (window as unknown as { headerNode: Element }).headerNode)).toBe(true);
    for (const route of ["/sign-in", "/register", "/account", "/cart", "/checkout", "/orders", "/favorites", "/missing"]) {
      await page.goto(route);
      // The approved purchase flow replaces catalog navigation with the focused PurchaseHeader.
      if (route === "/cart" || route === "/checkout") {
        await expect(page.getByTestId("site-header")).toHaveCount(0);
        await expect(page.getByRole("banner")).toHaveCount(1);
        await expect(page.getByRole("banner")).toContainText(route === "/cart" ? "Carrito" : "Finalizar Compra");
        await expect(page.getByRole("banner").getByRole("button", { name: /Buscar libros/ })).toHaveCount(0);
        continue;
      }
      await expect(page.getByTestId("site-header")).toHaveCount(1);
      await expect(page.getByTestId("site-header").getByRole(width >= 960 ? "link" : "button", { name: width >= 960 ? "Libros" : "Abrir navegación", exact: true })).toBeVisible();
    }
  });
}
test("account keyboard menu and cart remain coherent after navigation and logout", async ({ page }) => {
  await mockPublicCatalog(page); await mockCustomerLogin(page); await signIn(page);
  const header = page.getByTestId("site-header");
  await expect(header.getByRole("link", { name: "Carrito, 3 unidades" })).toBeVisible();
  const account = header.getByRole("button", { name: "Menú de cuenta" });
  await account.focus(); await page.keyboard.press("ArrowDown");
  await expect(page.getByRole("menuitem", { name: "Perfil", exact: true })).toBeFocused();
  await page.keyboard.press("Escape"); await expect(account).toBeFocused();
  await account.click(); await page.getByRole("menuitem", { name: "Cerrar sesión" }).click();
  await expect(header.getByRole("link", { name: "Iniciar sesión" })).toBeVisible();
});
test("global suggestions carry the unfiltered search destination", async ({ page }) => {
  await mockPublicCatalog(page); await page.goto("/catalog?category=historia&minPrice=50.00");
  await page.getByRole("button", { name: "Buscar libros en el catálogo" }).click();
  await page.getByRole("searchbox", { name: "Buscar en el catálogo" }).fill("Cien años");
  await page.getByRole("dialog").getByRole("link", { name: /Cien años de soledad/ }).click();
  await expect(page).toHaveURL(/\/catalog\/editions\/42\?/);
  expect(new URL(page.url()).searchParams.get("from")).toBe("/catalog?que=Cien+a%C3%B1os");
});

test("desktop navigation is centered and contains the server destinations including Help", async ({ page }) => {
  await mockPublicCatalog(page);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto("/");
  const header = page.getByTestId("site-header");
  const navigation = header.getByRole("navigation", { name: "Navegación principal" });
  await expect(navigation.getByRole("link")).toHaveText(["Libros", "eBooks", "Audiolibros", "Ofertas", "Ayuda"]);
  await expect(navigation.getByRole("button", { name: "Literatura" })).toHaveCount(0);
  await expect(navigation.getByRole("link", { name: "Ayuda" })).toHaveAttribute("href", "/ayuda");
  const box = (await navigation.boundingBox())!;
  expect(Math.abs(box.x + box.width / 2 - 720)).toBeLessThan(2);
  await navigation.getByRole("link", { name: "Ofertas" }).click();
  await expect(page).toHaveURL(/\/ofertas$/);
  await expect(page.getByText("No hay ofertas disponibles por ahora.")).toBeVisible();
  await navigation.getByRole("link", { name: "Ayuda" }).click();
  await expect(page).toHaveURL(/\/ayuda$/);
  await expect(page.getByRole("heading", { name: "Ayuda", exact: true })).toBeVisible();
});

test("compact navigation keeps the same server destinations with keyboard recovery", async ({ page }) => {
  await mockPublicCatalog(page);
  await page.setViewportSize({ width: 320, height: 844 });
  await page.goto("/");
  const trigger = page.getByRole("button", { name: "Abrir navegación" });
  await trigger.click();
  const menu = page.getByRole("dialog", { name: "Navegación", exact: true });
  await expect(menu.getByRole("link")).toHaveText(["Libros", "eBooks", "Audiolibros", "Ofertas", "Ayuda"]);
  await expect(menu.getByRole("link", { name: "Ayuda" })).toHaveAttribute("href", "/ayuda");
  await page.keyboard.press("Escape");
  await expect(trigger).toBeFocused();
  await trigger.click();
  await menu.getByRole("link", { name: "eBooks" }).click();
  await expect(page).toHaveURL(/productType=EBOOK/);
  await expect(menu).toHaveCount(0);
  await expect(page.getByTestId("site-header").getByRole("button", { name: "Buscar libros en el catálogo" })).toBeVisible();
  await trigger.click();
  await menu.getByRole("link", { name: "Ayuda" }).click();
  await expect(page).toHaveURL(/\/ayuda$/);
  await expect(page.getByRole("heading", { name: "Ayuda", exact: true })).toBeVisible();
});
