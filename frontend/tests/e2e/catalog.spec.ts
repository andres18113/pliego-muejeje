import { expect, test } from "@playwright/test";

const editionSummary = {
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
};

const editionDetail = {
  editionId: "42",
  bookId: "17",
  title: "Cien años de soledad",
  subtitle: null,
  synopsis: "Una historia familiar en Macondo.",
  authors: [{ authorId: "9", name: "Gabriel García Márquez", order: 1 }],
  categories: [{ slug: "narrativa", name: "Narrativa", parentSlug: null }],
  publisher: { publisherId: "5", name: "Editorial Sur" },
  isbn13: "9780306406157",
  sku: "PLG-LIT-042",
  language: "es",
  format: "PAPERBACK",
  pageCount: 496,
  publicationDate: "1967-05-30",
  price: "18.50",
  coverUrl: null,
  coverLicense: null,
  coverSourceUrl: null,
  coverAttribution: null,
  available: true,
};

type DetailOverrides = Omit<Partial<typeof editionDetail>, "coverUrl"> & { coverUrl?: string | null };
type SummaryOverrides = Omit<Partial<typeof editionSummary>, "coverUrl"> & { coverUrl?: string | null };

const representativeCovers = [
  { title: "Análisis matemático", coverUrl: "https://covers.pliegolibros.com/covers/editions/v2/PLG-BK-000028-5c3053a00867.webp", source: "covers/Matemáticas/analisis-matematico-apostol.webp", width: 300, height: 450, fit: "cover" },
  { title: "Análisis matemático I", coverUrl: "https://covers.pliegolibros.com/covers/editions/v2/PLG-BK-000052-b80e012ee00e.webp", source: "covers/Matemáticas/analisis-matematico-i-calculo-diferencial-moises-lazaro-carrion.webp", width: 600, height: 800, fit: "contain" },
  { title: "Análisis matemático II", coverUrl: "https://covers.pliegolibros.com/covers/editions/v2/PLG-BK-000051-319fe6c039de.webp", source: "covers/Matemáticas/analisis-matematico-ii.webp", width: 270, height: 353, fit: "contain" },
  { title: "Anna Karénina", coverUrl: "https://covers.pliegolibros.com/covers/editions/v2/PLG-BK-000035-b62b28e2ae01.webp", source: "covers/Literatura/anna-karenina.webp", width: 777, height: 1200, fit: "cover" },
  { title: "Cien años de soledad", coverUrl: "https://covers.pliegolibros.com/covers/editions/v2/PLG-BK-000014-b456b439611b.webp", source: "covers/Literatura/cien-anos-de-soledad.webp", width: 381, height: 588, fit: "cover" },
  { title: "Don Quijote de la Mancha", coverUrl: "https://covers.pliegolibros.com/covers/editions/v2/PLG-BK-000029-37c3121f9eca.webp", source: "covers/Literatura/don-quijote.webp", width: 337, height: 500, fit: "cover" },
  { title: "La genealogía de la moral", coverUrl: "https://covers.pliegolibros.com/covers/editions/v2/PLG-BK-000026-26fcbd0dabe9.webp", source: "covers/Filosofia/genealogia-de-la-moral.webp", width: 656, height: 923, fit: "cover" },
  { title: "Los miserables", coverUrl: "https://covers.pliegolibros.com/covers/editions/v2/PLG-BK-000054-fe0fdb7fdd82.webp", source: "covers/Literatura/los-miserables.webp", width: 729, height: 1200, fit: "contain" },
  { title: "Moby Dick", coverUrl: "https://covers.pliegolibros.com/covers/editions/v2/PLG-BK-000021-86bb100040cb.webp", source: "covers/Literatura/moby-dick.webp", width: 359, height: 500, fit: "cover" },
] as const;

async function mockCatalogApi(
  page: import("@playwright/test").Page,
  detailOverrides: DetailOverrides = {},
  summaryOverrides: SummaryOverrides = {},
) {
  await page.route("**/api/v1/catalog/categories", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({ items: [{ slug: "narrativa", name: "Narrativa", parentSlug: null }] }),
  }));
  await page.route("**/api/v1/catalog/filter-options", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({ languages: ["en", "es"], minimumPrice: "7.25", maximumPrice: "38.00" }),
  }));
  await page.route("**/api/v1/catalog/editions**", (route) => {
    const url = new URL(route.request().url());
    const body = url.pathname.endsWith("/42")
      ? { ...editionDetail, ...detailOverrides }
      : { items: [{ ...editionSummary, ...summaryOverrides }], page: Number(url.searchParams.get("page") || "0"), pageSize: 20, totalCount: "1" };
    return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(body) });
  });
}

test("keeps the cover frame at 2:3 before and after load on catalog and detail", async ({ page }) => {
  const coverUrl = "https://covers.pliegolibros.com/covers/editions/v2/PLG-BK-000001-52ead14866be.webp";
  let releaseCover!: () => void;
  const responseGate = new Promise<void>((resolve) => { releaseCover = resolve; });
  await page.route(coverUrl, async (route) => {
    await responseGate;
    await route.fulfill({
      status: 200,
      contentType: "image/svg+xml",
      body: '<svg xmlns="http://www.w3.org/2000/svg" width="300" height="450" viewBox="0 0 300 450"><rect width="300" height="450" fill="#24513f"/><text x="24" y="90" fill="white">Dorian Gray</text></svg>',
    });
  });
  await mockCatalogApi(page, { title: "El retrato de Dorian Gray", coverUrl }, { title: "El retrato de Dorian Gray", coverUrl });
  await page.goto("/");

  const cardFrame = page.locator(".edition-grid .cover-frame");
  await cardFrame.scrollIntoViewIfNeeded();
  await expect(page.locator(".edition-grid img.cover-image")).toHaveAttribute("loading", "lazy");
  await expect(page.locator(".edition-grid img.cover-image")).toHaveAttribute("src", coverUrl);
  await expect(page.locator(".edition-grid [data-testid=cover-skeleton]")).toBeVisible();
  const frameBeforeLoad = await cardFrame.boundingBox();
  expect(frameBeforeLoad).not.toBeNull();
  expect(frameBeforeLoad!.height / frameBeforeLoad!.width).toBeCloseTo(1.5, 3);

  releaseCover();
  await expect(page.locator(".edition-grid [data-testid=cover-skeleton]")).toHaveCount(0);
  const frameAfterLoad = await cardFrame.boundingBox();
  expect(frameAfterLoad).toEqual(frameBeforeLoad);

  await page.setViewportSize({ width: 390, height: 844 });
  const mobileFrame = await cardFrame.boundingBox();
  expect(mobileFrame).not.toBeNull();
  expect(mobileFrame!.height / mobileFrame!.width).toBeCloseTo(1.5, 3);

  await page.getByRole("link", { name: "Ver edición: El retrato de Dorian Gray" }).click();
  const detailFrame = page.locator(".book-cover--detail .cover-frame");
  await expect(detailFrame).toBeVisible();
  const detailBox = await detailFrame.boundingBox();
  expect(detailBox).not.toBeNull();
  expect(detailBox!.height / detailBox!.width).toBeCloseTo(1.5, 3);
  await expect(page.locator(".book-cover--detail img.cover-image")).toHaveAttribute("src", coverUrl);
});

test("renders representative source covers in identical, non-distorting frames", async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1440, height: 1200 });
  await page.route("**/api/v1/catalog/categories", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({ items: [{ slug: "narrativa", name: "Narrativa", parentSlug: null }] }),
  }));
  await page.route("**/api/v1/catalog/filter-options", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({ languages: ["es"], minimumPrice: "7.25", maximumPrice: "38.00" }),
  }));
  await page.route("**/api/v1/catalog/editions**", (route) => {
    const url = new URL(route.request().url());
    const body = url.pathname.endsWith("/42")
      ? { ...editionDetail, title: representativeCovers[0].title, coverUrl: representativeCovers[0].coverUrl }
      : {
        items: representativeCovers.map((cover, index) => ({
          ...editionSummary,
          editionId: String(100 + index),
          bookId: String(17 + index),
          title: cover.title,
          coverUrl: cover.coverUrl,
        })),
        page: 0,
        pageSize: 20,
        totalCount: String(representativeCovers.length),
      };
    return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(body) });
  });
  await page.route("https://covers.pliegolibros.com/covers/editions/**", async (route) => {
    const cover = representativeCovers.find((item) => item.coverUrl === route.request().url());
    if (!cover) return route.abort();
    return route.fulfill({
      path: decodeURIComponent(new URL(`../../../${cover.source}`, import.meta.url).pathname),
      contentType: "image/webp",
      headers: { "Cache-Control": "public, max-age=31536000, immutable" },
    });
  });
  await page.goto("/");

  for (const [index, cover] of representativeCovers.entries()) {
    const edition = page.locator(".edition-item").nth(index);
    const frame = edition.locator(".cover-frame");
    const image = edition.locator("img.cover-image");
    await frame.scrollIntoViewIfNeeded();
    await expect(image).toHaveAttribute("loading", "lazy");
    await expect(image).toHaveCSS("object-fit", cover.fit);
    await expect(edition.locator("[data-testid=cover-skeleton]")).toHaveCount(0);
    expect(await image.evaluate((element: HTMLImageElement) => [element.naturalWidth, element.naturalHeight]))
      .toEqual([cover.width, cover.height]);
    expect(await image.evaluate((element: HTMLImageElement) => getComputedStyle(element).objectPosition))
      .toBe("50% 50%");
    const box = await frame.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.height / box!.width).toBeCloseTo(1.5, 3);
    if (cover.fit === "contain") await expect(frame).toHaveCSS("background-color", "rgb(250, 251, 248)");
  }

  await page.locator(".edition-grid").screenshot({ path: testInfo.outputPath("representative-covers.png") });
  await page.setViewportSize({ width: 390, height: 844 });
  const mobileColumns = await page.locator(".edition-grid").evaluate((element) => getComputedStyle(element).gridTemplateColumns.split(" ").length);
  expect(mobileColumns).toBe(2);
  for (const edition of await page.locator(".edition-item").all()) {
    const box = await edition.locator(".cover-frame").boundingBox();
    expect(box).not.toBeNull();
    expect(box!.height / box!.width).toBeCloseTo(1.5, 3);
  }
});

async function mockCustomerLogin(page: import("@playwright/test").Page, role: "CUSTOMER" | "ADMIN" = "CUSTOMER") {
  await page.route("**/api/v1/auth/login", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({
      accessToken: "test-token",
      tokenType: "Bearer",
      expiresInSeconds: 1800,
      user: { userId: "100", email: "ana@example.com", role },
    }),
  }));
}

async function signInFromEdition(page: import("@playwright/test").Page, role: "CUSTOMER" | "ADMIN" = "CUSTOMER") {
  await page.getByRole("link", { name: "Iniciar sesión para agregar" }).click();
  await page.getByLabel("Correo electrónico").fill("ana@example.com");
  await page.getByLabel("Contraseña").fill("lectura-segura");
  await page.getByRole("button", { name: "Iniciar sesión" }).click();
  await expect(page).toHaveURL(role === "ADMIN" ? /\/admin$/ : /\/catalog\/editions\/42/);
}

test("searches the public catalog, opens a real edition route, and returns to the same URL context", async ({ page }) => {
  await mockCatalogApi(page);
  await page.goto("/");

  await page.getByRole("searchbox").fill("Cien años");
  await page.getByRole("button", { name: "Buscar" }).click();
  await expect(page).toHaveURL(/\/catalog\?q=Cien\+a%C3%B1os/);
  await expect(page.getByRole("heading", { name: "Cien años de soledad" })).toBeVisible();

  const editionLink = page.getByRole("link", { name: "Ver edición: Cien años de soledad" });
  await expect(editionLink).toHaveCount(1);
  await editionLink.click();
  await expect(page).toHaveURL(/\/catalog\/editions\/42\?/);
  await expect(page.getByRole("heading", { name: "Cien años de soledad" })).toBeVisible();
  await expect(page.getByRole("navigation", { name: "Ruta de navegación" })).toContainText("Cien años de soledad");

  await page.getByRole("link", { name: "Volver al catálogo" }).first().click();
  await expect(page).toHaveURL(/\/catalog\?q=Cien\+a%C3%B1os/);
  await expect(page.getByRole("heading", { name: "Cien años de soledad" })).toBeVisible();
});

test("moves focus to the page heading after route changes and from the skip link to main", async ({ page }) => {
  await mockCatalogApi(page);
  await page.goto("/");

  let releaseDetail!: () => void;
  const detailResponseGate = new Promise<void>((resolve) => { releaseDetail = resolve; });
  await page.route("**/api/v1/catalog/editions/42", async (route) => {
    await detailResponseGate;
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(editionDetail) });
  });

  const skipLink = page.getByRole("link", { name: "Saltar al contenido" });
  await page.keyboard.press("Tab");
  await expect(skipLink).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.locator("#contenido-principal")).toBeFocused();

  await page.getByRole("link", { name: "Ver edición: Cien años de soledad" }).click();
  await expect(page.getByRole("heading", { name: "Consultando la edición" })).toBeFocused();
  releaseDetail();
  await expect(page.getByRole("heading", { name: "Cien años de soledad" })).toBeFocused();
});

test("makes the root a book-led discovery page and moves legacy criteria to the catalog route", async ({ page }) => {
  await mockCatalogApi(page);
  await page.goto("/");

  await expect(page.getByRole("heading", { name: "Una lectura empieza por una pista." })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Ediciones para descubrir" })).toBeVisible();
  await expect(page.locator(".catalog-controls")).toHaveCount(0);
  await expect(page.locator(".edition-item")).toHaveCount(1);
  await expect(page.getByRole("link", { name: "Explorar catálogo completo" })).toHaveAttribute("href", "/catalog");
  const categoryPosition = await page.locator(".edition-grid").evaluate((element) =>
    element.compareDocumentPosition(document.querySelector(".category-section")!) & Node.DOCUMENT_POSITION_FOLLOWING,
  );
  expect(categoryPosition).toBeTruthy();
  const narrativeCategory = page.locator(".category-section").getByRole("link", { name: "Narrativa" });
  await expect(narrativeCategory).toHaveAttribute("href", "/catalog?category=narrativa");
  await narrativeCategory.click();
  await expect(page).toHaveURL("/catalog?category=narrativa");

  await page.goto("/?q=Cien+años&category=narrativa&sort=PRICE_DESC&page=2");
  await expect(page).toHaveURL(/\/catalog\?q=Cien\+a%C3%B1os&category=narrativa&sort=PRICE_DESC&page=2/);
  await expect(page.getByRole("searchbox")).toHaveValue("Cien años");
});

test("keeps card covers and metadata aligned at the requested viewport widths", async ({ page }) => {
  await mockCatalogApi(page);
  await page.goto("/catalog");

  for (const width of [1440, 768, 390, 320]) {
    await page.setViewportSize({ width, height: 1000 });
    const cover = await page.locator(".edition-item .cover-frame").first().boundingBox();
    const metadata = await page.locator(".edition-item .edition-copy").first().boundingBox();
    expect(cover, `cover at ${width}px`).not.toBeNull();
    expect(metadata, `metadata at ${width}px`).not.toBeNull();
    expect(metadata!.x).toBeCloseTo(cover!.x, 0);
    expect(metadata!.width).toBeCloseTo(cover!.width, 0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth), `page width at ${width}px`).toBe(width);
  }
});

test("preserves search, sort, and price criteria from edition category links", async ({ page }) => {
  await mockCatalogApi(page);
  await page.goto("/catalog?q=Julio&minPrice=12.00&sort=PRICE_DESC&page=2");
  await page.getByRole("link", { name: "Ver edición: Cien años de soledad" }).click();

  await page.locator(".detail-categories").getByRole("link", { name: "Narrativa" }).click();
  await expect(page).toHaveURL(/q=Julio/);
  const url = new URL(page.url());
  expect(url.searchParams.get("category")).toBe("narrativa");
  expect(url.searchParams.get("minPrice")).toBe("12.00");
  expect(url.searchParams.get("sort")).toBe("PRICE_DESC");
  expect(url.searchParams.has("page")).toBe(false);
});

test("sets administrative and not-found titles and focuses their headings", async ({ page }) => {
  await page.goto("/admin");
  await expect(page).toHaveTitle("Área administrativa · PLIEGO");
  await expect(page.getByRole("heading", { name: "Inicia sesión para continuar." })).toBeFocused();

  await page.goto("/no-existe");
  await expect(page).toHaveTitle("Página no encontrada · PLIEGO");
  await expect(page.getByRole("heading", { name: "No encontramos esta página." })).toBeFocused();
});

test("returns a guest to the intended edition and confirms the server cart mutation", async ({ page }) => {
  await mockCatalogApi(page);
  await mockCustomerLogin(page);

  await page.route("**/api/v1/cart", (route) => {
    expect(route.request().headers().authorization).toBe("Bearer test-token");
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        cartId: "7",
        state: "ACTIVE",
        items: [{ editionId: "42", quantity: 1 }],
        totalCurrent: "18.50",
      }),
    });
  });

  let releaseAdd!: () => void;
  const addResponseGate = new Promise<void>((resolve) => { releaseAdd = resolve; });
  let addCount = 0;
  await page.route("**/api/v1/cart/items", async (route) => {
    addCount += 1;
    expect(route.request().postDataJSON()).toEqual({ editionId: "42", quantity: 1 });
    await addResponseGate;
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ cartId: "7", cartItemId: "13", quantity: 2 }),
    });
  });

  await page.goto("/catalog/editions/42?from=%2Fcatalog%3Fq%3DCien");
  await expect(page.getByRole("link", { name: "Iniciar sesión para agregar" })).toBeVisible();
  await signInFromEdition(page);

  const addButton = page.getByRole("button", { name: "Agregar al carrito" });
  await expect(addButton).toBeVisible();
  await addButton.click();
  const pendingAdd = page.getByRole("button", { name: "Agregando…" });
  await expect(pendingAdd).toHaveAttribute("aria-disabled", "true");
  expect(await pendingAdd.evaluate((button) => (button as HTMLButtonElement).disabled)).toBe(false);
  await expect(pendingAdd).toHaveAttribute("tabindex", "0");
  await pendingAdd.focus();
  await expect(pendingAdd).toBeFocused();
  await pendingAdd.press("Enter");
  await expect(page.getByText("Agregando esta edición al carrito…")).toBeVisible();
  await expect.poll(() => addCount).toBe(1);

  releaseAdd();
  await expect(page.getByText("Edición agregada al carrito. Ahora tienes 2 unidades de esta edición.")).toBeVisible();
  expect(addCount).toBe(1);
});

test("does not expose customer purchasing to an authenticated administrator", async ({ page }) => {
  await mockCatalogApi(page);
  await mockCustomerLogin(page, "ADMIN");
  await page.goto("/catalog/editions/42");
  await signInFromEdition(page, "ADMIN");
  await expect(page).toHaveURL(/\/admin$/);

  await page.getByRole("link", { name: "PLIEGO, ir al inicio" }).click();
  await page.getByRole("link", { name: "Ver edición: Cien años de soledad" }).click();

  await expect(page.getByText("El carrito está disponible únicamente para cuentas de cliente.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Agregar al carrito" })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Iniciar sesión para agregar" })).toHaveCount(0);
});

test("does not offer purchase actions for unavailable editions", async ({ page }) => {
  await mockCatalogApi(page, { available: false });
  await page.goto("/catalog/editions/42");

  await expect(page.getByText("Esta edición no está disponible para agregar al carrito.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Agregar al carrito" })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Iniciar sesión para agregar" })).toHaveCount(0);
});

test("announces cart validation errors and leaves a deliberate retry available", async ({ page }) => {
  await mockCatalogApi(page);
  await mockCustomerLogin(page);
  await page.route("**/api/v1/cart", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({ cartId: null, state: null, items: [], totalCurrent: "0.00" }),
  }));
  let addCount = 0;
  await page.route("**/api/v1/cart/items", async (route) => {
    addCount += 1;
    await route.fulfill({
      status: 400,
      contentType: "application/problem+json",
      body: JSON.stringify({
        title: "Cantidad inválida",
        detail: "La cantidad debe ser mayor que cero.",
        status: 400,
        code: "P4004",
      }),
    });
  });

  await page.goto("/catalog/editions/42");
  await signInFromEdition(page);
  await page.getByRole("button", { name: "Agregar al carrito" }).click();

  await expect(page.getByRole("alert")).toHaveText("Cantidad inválida. La cantidad debe ser mayor que cero.");
  await expect(page.getByRole("button", { name: "Agregar al carrito" })).toBeEnabled();
  expect(addCount).toBe(1);
});

test("reconciles a server failure against cart state before allowing another add", async ({ page }) => {
  await mockCatalogApi(page);
  await mockCustomerLogin(page);
  let addCount = 0;
  await page.route("**/api/v1/cart/items", async (route) => {
    addCount += 1;
    await route.fulfill({
      status: 503,
      contentType: "application/problem+json",
      body: JSON.stringify({
        title: "Servicio no disponible",
        detail: "No se pudo confirmar la solicitud.",
        status: 503,
        code: "INTERNAL_ERROR",
      }),
    });
  });
  let cartReads = 0;
  await page.route("**/api/v1/cart", (route) => {
    cartReads += 1;
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        cartId: "7",
        state: "ACTIVE",
        items: [{ editionId: "42", quantity: 1 }],
        totalCurrent: "18.50",
      }),
    });
  });

  await page.goto("/catalog/editions/42");
  await signInFromEdition(page);
  // The header's cart link reads the cart too; count only the reads this flow makes.
  await expect.poll(() => cartReads).toBeGreaterThan(0);
  await page.waitForLoadState("networkidle");
  const baselineCartReads = cartReads;
  await page.getByRole("button", { name: "Agregar al carrito" }).click();
  await expect(page.getByText("No pudimos confirmar si se agregó.")).toBeVisible();
  const blockedAdd = page.getByRole("button", { name: "Agregar al carrito" });
  await expect(blockedAdd).toHaveAttribute("aria-disabled", "true");
  expect(await blockedAdd.evaluate((button) => (button as HTMLButtonElement).disabled)).toBe(false);
  await expect(blockedAdd).toHaveAttribute("tabindex", "0");
  await blockedAdd.focus();
  await expect(blockedAdd).toBeFocused();
  await blockedAdd.press("Enter");
  expect(addCount).toBe(1);
  await page.getByRole("button", { name: "Comprobar el estado del carrito" }).click();
  await expect(page.getByText("El carrito no muestra una unidad nueva de esta edición. Puedes volver a intentarlo.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Agregar al carrito" })).toBeEnabled();
  expect(addCount).toBe(1);
  expect(cartReads - baselineCartReads).toBe(2);
});

test("keeps the first edition cover in reach on mobile and preserves access to filters", async ({ page }) => {
  await mockCatalogApi(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/catalog");

  const filters = page.locator("details.filter-disclosure");
  expect(await filters.evaluate((element) => (element as HTMLDetailsElement).open)).toBe(false);
  await expect(page.locator(".edition-item .cover-frame").first()).toBeInViewport({ ratio: 0.5 });
  const minimum = page.getByRole("slider", { name: "Precio mínimo" });
  await expect(minimum).toBeHidden();

  const filterSummary = page.locator(".filter-disclosure-summary");
  await filterSummary.focus();
  await page.keyboard.press("Enter");
  await expect(minimum).toBeVisible();
  await minimum.press("End");
  await page.getByRole("button", { name: "Aplicar filtros" }).click();
  await expect(page).toHaveURL(/minPrice=38(?:\.00)?/);
  await expect(page.locator('output[for="min-price"]')).toHaveText(/^\$\s38,00$/);
});

test("gives each price slider thumb a 24px pointer target", async ({ page }) => {
  await mockCatalogApi(page);
  await page.goto("/catalog");

  for (const slider of [page.getByRole("slider", { name: "Precio mínimo" }), page.getByRole("slider", { name: "Precio máximo" })]) {
    const thumbWidth = await slider.evaluate((input) =>
      Number.parseFloat(getComputedStyle(input, "::-webkit-slider-thumb").width),
    );
    const thumbHeight = await slider.evaluate((input) =>
      Number.parseFloat(getComputedStyle(input, "::-webkit-slider-thumb").height),
    );
    expect(thumbWidth).toBeGreaterThanOrEqual(24);
    expect(thumbHeight).toBeGreaterThanOrEqual(24);
  }
});

test("keeps catalog search usable at the minimum 320px viewport", async ({ page }) => {
  await mockCatalogApi(page);
  await page.setViewportSize({ width: 320, height: 740 });
  await page.goto("/");

  const queryBounds = await page.getByRole("searchbox").boundingBox();
  const searchButtonBounds = await page.getByRole("button", { name: "Buscar" }).boundingBox();
  expect(queryBounds).not.toBeNull();
  expect(searchButtonBounds).not.toBeNull();
  expect(queryBounds!.width).toBeGreaterThanOrEqual(160);
  expect(queryBounds!.height).toBeGreaterThanOrEqual(44);
  expect(searchButtonBounds!.height).toBeGreaterThanOrEqual(44);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(320);
});

test("sign-in returns to the storefront without exposing the email in its header", async ({ page }) => {
  await mockCatalogApi(page);
  await page.route("**/api/v1/auth/register", (route) => route.fulfill({
    status: 201,
    contentType: "application/json",
    body: JSON.stringify({ userId: "100", customerId: "88", state: "ACTIVE" }),
  }));
  await page.route("**/api/v1/auth/login", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({
      accessToken: "test-token",
      tokenType: "Bearer",
      expiresInSeconds: 1800,
      user: { userId: "100", email: "ana@example.com", role: "CUSTOMER" },
    }),
  }));

  await page.goto("/");
  await page.getByRole("link", { name: "Crear cuenta" }).click();
  await expect(page).toHaveURL(/\/register\?/);
  await page.getByLabel("Nombres").fill("Ana María");
  await page.getByLabel("Apellidos").fill("Pérez López");
  await page.getByLabel("Correo electrónico").fill("ana@example.com");
  await page.getByLabel("Contraseña").fill("lectura-segura");
  await page.getByRole("button", { name: "Crear cuenta" }).click();
  await expect(page.getByRole("heading", { name: "Cuenta creada" })).toBeVisible();

  await page.getByRole("link", { name: "Iniciar sesión" }).last().click();
  await expect(page).toHaveURL(/\/sign-in\?/);
  await page.getByLabel("Correo electrónico").fill("ana@example.com");
  await page.getByLabel("Contraseña").fill("lectura-segura");
  await page.getByRole("button", { name: "Iniciar sesión" }).click();
  await expect(page).toHaveURL("/");
  await expect(page.locator(".site-header").getByRole("button", { name: "Menú de cuenta" })).toBeVisible();
  await expect(page.locator(".site-header").getByText("ana@example.com")).toHaveCount(0);
});

test("keeps open subcategory menus inside a 320px viewport", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 740 });
  await page.route("**/api/v1/catalog/categories", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({ items: [
      { slug: "narrativa", name: "Narrativa", parentSlug: null },
      { slug: "novela", name: "Novela histórica", parentSlug: "narrativa" },
      { slug: "poesia", name: "Poesía", parentSlug: null },
      { slug: "verso", name: "Verso libre", parentSlug: "poesia" },
      { slug: "ciencia", name: "Ciencia", parentSlug: null },
      { slug: "astronomia", name: "Astronomía", parentSlug: "ciencia" },
      { slug: "ensayo", name: "Ensayo", parentSlug: null },
    ] }),
  }));
  await page.route("**/api/v1/catalog/filter-options", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({ languages: [], minimumPrice: null, maximumPrice: null }),
  }));
  await page.route("**/api/v1/catalog/editions**", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({ items: [], page: 0, pageSize: 20, totalCount: "0" }),
  }));
  await page.goto("/catalog");

  const disclosures = page.locator(".subcategory-disclosure");
  const count = await disclosures.count();
  for (let index = 0; index < count; index += 1) {
    const disclosure = disclosures.nth(index);
    await disclosure.locator("summary").click();
    const menu = disclosure.locator(".subcategory-list");
    await expect(menu).toBeVisible();
    await expect(disclosure).toHaveAttribute("data-menu-align", /left|right/);
    const bounds = await menu.boundingBox();
    expect(bounds).not.toBeNull();
    expect(bounds!.x).toBeGreaterThanOrEqual(0);
    expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(320);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(320);
    await disclosure.locator("summary").click();
  }
});
