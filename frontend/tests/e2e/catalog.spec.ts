import { expect, test } from "@playwright/test";
import { storefrontNavigationFixture } from "../../src/test/storefrontFixture";

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

// The Home's popular row shows the projection's featured titles: one real edition gives the Home a product link.
const homeNavigation = { sections: storefrontNavigationFixture.sections.map((section) => section.key === "PHYSICAL" ? { ...section, featured: [{
  editionId: "42", bookId: "42", title: "Cien años de soledad", authors: "Gabriel García Márquez", coverUrl: null, format: "PAPERBACK", productType: "PHYSICAL", price: "20.00", offer: null, href: "/catalog/editions/42",
}] } : section) };

async function mockCatalogApi(
  page: import("@playwright/test").Page,
  detailOverrides: DetailOverrides = {},
  summaryOverrides: SummaryOverrides = {},
) {
  await page.route("**/api/v1/storefront/navigation", route => route.fulfill({ contentType: "application/json", body: JSON.stringify(homeNavigation) }));
  await page.route("**/api/v1/auth/refresh", (route) => route.fulfill({ status: 204 }));
  await page.route("**/api/v1/me/favorites/status**", (route) => {
    const url = new URL(route.request().url());
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(url.searchParams.getAll("editionIds").map((editionId) => ({ editionId, favorite: false }))),
    });
  });
  await page.route("**/api/v1/catalog/categories**", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({ items: [{ slug: "narrativa", name: "Narrativa", parentSlug: null }] }),
  }));
  await page.route("**/api/v1/catalog/filter-options**", (route) => route.fulfill({
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

async function openCatalogSearch(page: import("@playwright/test").Page) {
  await page.getByRole("button", { name: "Buscar libros en el catálogo" }).click();
  return page.getByRole("searchbox", { name: "Buscar en el catálogo" });
}

async function mockPaginatedCatalogApi(page: import("@playwright/test").Page) {
  const editions = Array.from({ length: 40 }, (_, index) => ({
    ...editionSummary,
    editionId: String(42 + index),
    title: index < 20 ? `Página 1 · Libro ${index + 1}` : `Página 2 · Libro ${index - 19}`,
  }));

  await page.route("**/api/v1/storefront/navigation", route => route.fulfill({ contentType: "application/json", body: JSON.stringify(storefrontNavigationFixture) }));
  await page.route("**/api/v1/auth/refresh", (route) => route.fulfill({ status: 204 }));
  await page.route("**/api/v1/catalog/categories**", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({ items: [{ slug: "narrativa", name: "Narrativa", parentSlug: null }] }),
  }));
  await page.route("**/api/v1/catalog/filter-options**", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({ languages: ["en", "es"], minimumPrice: "7.25", maximumPrice: "38.00" }),
  }));
  await page.route("**/api/v1/catalog/editions**", (route) => {
    const url = new URL(route.request().url());
    if (url.pathname.endsWith("/62")) {
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ ...editionDetail, editionId: "62", title: "Página 2 · Libro 1" }),
      });
    }

    const requestedPage = Number(url.searchParams.get("page") || "0");
    const pageSize = Number(url.searchParams.get("pageSize") || "20");
    const start = requestedPage * pageSize;
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        items: editions.slice(start, start + pageSize),
        page: requestedPage,
        pageSize,
        totalCount: "40",
      }),
    });
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
  await page.goto("/catalog");

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

  await page.locator("[data-bookcard-link]").filter({ has: page.getByRole("heading", { name: "El retrato de Dorian Gray", exact: true }) }).click();
  const detailFrame = page.locator(".book-cover--detail .cover-frame");
  await expect(detailFrame).toBeVisible();
  const detailBox = await detailFrame.boundingBox();
  expect(detailBox).not.toBeNull();
  expect(detailBox!.height / detailBox!.width).toBeCloseTo(1.5, 3);
  await expect(page.locator(".book-cover--detail img.cover-image")).toHaveAttribute("src", coverUrl);
});

test("renders representative source covers in identical, non-distorting frames", async ({ page }, testInfo) => {
  await page.route("**/api/v1/auth/refresh", (route) => route.fulfill({ status: 204 }));
  await page.setViewportSize({ width: 1440, height: 1200 });
  await page.route("**/api/v1/catalog/categories**", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({ items: [{ slug: "narrativa", name: "Narrativa", parentSlug: null }] }),
  }));
  await page.route("**/api/v1/catalog/filter-options**", (route) => route.fulfill({
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
  await page.goto("/catalog");

  for (const [index, cover] of representativeCovers.entries()) {
    const edition = page.locator(".edition-item").nth(index);
    const frame = edition.locator(".cover-frame");
    const image = edition.locator("img.cover-image");
    await frame.scrollIntoViewIfNeeded();
    await expect(image).toHaveAttribute("loading", "lazy");
    await expect(image).toHaveCSS("object-fit", "contain");
    await expect(edition.locator("[data-testid=cover-skeleton]")).toHaveCount(0);
    expect(await image.evaluate((element: HTMLImageElement) => [element.naturalWidth, element.naturalHeight]))
      .toEqual([cover.width, cover.height]);
    // Covers stand on a shared shelf line: letterboxed jackets anchor to the bottom of the frame.
    expect(await image.evaluate((element: HTMLImageElement) => getComputedStyle(element).objectPosition))
      .toBe("50% 100%");
    const box = await frame.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.height / box!.width).toBeCloseTo(1.5, 3);
    await expect(frame).toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
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

  const searchbox = await openCatalogSearch(page);
  await searchbox.fill("Cien años");
  await searchbox.press("Enter");
  await expect(page).toHaveURL(/\/catalog\?que=Cien\+a%C3%B1os/);
  await expect(page.getByRole("heading", { name: "Cien años de soledad" })).toBeVisible();

  const editionLink = page.locator("[data-bookcard-link]").filter({ has: page.getByRole("heading", { name: "Cien años de soledad", exact: true }) });
  await expect(editionLink).toHaveCount(1);
  await editionLink.click();
  await expect(page).toHaveURL(/\/catalog\/editions\/42\?/);
  await expect(page.getByRole("heading", { name: "Cien años de soledad" })).toBeVisible();
  await expect(page.getByRole("navigation", { name: "Ruta de navegación" })).toContainText("Cien años de soledad");

  await page.getByRole("link", { name: "Volver al catálogo" }).first().click();
  await expect(page).toHaveURL(/\/catalog\?que=Cien\+a%C3%B1os/);
  await expect(page.getByRole("heading", { name: "Cien años de soledad" })).toBeVisible();
});

test("moves focus to the page heading after route changes and from the skip link to main", async ({ page }) => {
  await mockCatalogApi(page);
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Descubre el mundo de PLIEGO." })).toBeVisible();

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

  await page.getByRole("main").getByRole("link", { name: "Cien años de soledad", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Consultando la edición" })).toBeFocused();
  releaseDetail();
  await expect(page.getByRole("heading", { name: "Cien años de soledad" })).toBeFocused();
});

test("keeps Home free of legacy catalog CTAs and its footer leads to the storefront's sections", async ({ page }) => {
  await mockCatalogApi(page); await page.goto("/");
  await expect(page.getByRole("heading", { name: "Descubre el mundo de PLIEGO." })).toBeVisible();
  const main = page.getByRole("main");
  await expect(main.getByRole("link", { name: "Explorar catálogo", exact: true })).toHaveCount(0);
  await expect(main.getByRole("link", { name: "Ver categorías" })).toHaveCount(0);
  await expect(main.getByRole("link", { name: "Explorar catálogo completo" })).toHaveCount(0);
  await expect(main.getByRole("heading", { name: "Tu próxima lectura." })).toHaveCount(0);
  await expect(main.getByRole("navigation", { name: "Explora por tema" })).toHaveCount(0);
  const footer = page.getByRole("navigation", { name: "Navegación del pie de página" });
  await expect(footer.getByRole("link", { name: "Narrativa", exact: true })).toHaveCount(0);
  await footer.getByRole("link", { name: "eBooks", exact: true }).click();
  await expect(page).toHaveURL("/catalog?productType=EBOOK");
  await page.goto("/?que=Cien+años&category=narrativa&sort=PRICE_DESC&page=2");
  await expect(page).toHaveURL(/\/catalog\?que=Cien/);
  await expect(await openCatalogSearch(page)).toHaveValue("Cien años");
});

test("paginates to the results and restores catalog context after an edition detail", async ({ page }) => {
  await mockPaginatedCatalogApi(page);
  await page.goto("/");

  await page.getByTestId("site-header").getByRole("link", { name: "Libros", exact: true }).click();
  await expect(page).toHaveURL("/catalog?productType=PHYSICAL");
  await expect(page.getByRole("navigation", { name: "Paginación del catálogo" })).toContainText("Página 1 de");
  await expect(page.getByRole("heading", { name: "Descubre el mundo de PLIEGO." })).toHaveCount(0);

  await page.getByRole("link", { name: "Siguiente" }).click();
  await expect(page).toHaveURL("/catalog?productType=PHYSICAL&page=1");
  await expect(page.getByRole("navigation", { name: "Paginación del catálogo" })).toContainText("Página 2 de");
  const results = page.getByRole("region", { name: "Resultados", exact: true });
  await expect(results).toBeFocused();
  expect(Math.abs(await results.evaluate((element) => element.getBoundingClientRect().top - 104))).toBeLessThanOrEqual(1);

  await page.goBack();
  await expect(page).toHaveURL("/catalog?productType=PHYSICAL");
  await expect(page.getByRole("navigation", { name: "Paginación del catálogo" })).toContainText("Página 1 de");
  await expect(results).toBeFocused();
  await expect.poll(() => results.evaluate((element) => element.getBoundingClientRect().top)).toBeCloseTo(104, 0);

  await page.goForward();
  await expect(page).toHaveURL("/catalog?productType=PHYSICAL&page=1");
  await expect(page.getByRole("navigation", { name: "Paginación del catálogo" })).toContainText("Página 2 de");
  await expect(results).toBeFocused();
  await expect.poll(() => results.evaluate((element) => element.getBoundingClientRect().top)).toBeCloseTo(104, 0);

  await page.getByRole("link", { name: "Anterior" }).click();
  await expect(page).toHaveURL("/catalog?productType=PHYSICAL");
  await expect(page.getByRole("navigation", { name: "Paginación del catálogo" })).toContainText("Página 1 de");
  await expect(results).toBeFocused();
  await expect.poll(() => results.evaluate((element) => element.getBoundingClientRect().top)).toBeCloseTo(104, 0);

  await page.getByRole("link", { name: "Siguiente" }).click();
  await expect(page).toHaveURL("/catalog?productType=PHYSICAL&page=1");
  await expect(page.getByRole("navigation", { name: "Paginación del catálogo" })).toContainText("Página 2 de");
  await expect(results).toBeFocused();
  await expect.poll(() => results.evaluate((element) => element.getBoundingClientRect().top)).toBeCloseTo(104, 0);

  await page.locator("[data-bookcard-link]").filter({ has: page.getByRole("heading", { name: "Página 2 · Libro 1", exact: true }) }).click();
  await expect(page).toHaveURL(/\/catalog\/editions\/62\?from=%2Fcatalog%3FproductType%3DPHYSICAL%26page%3D1/);
  await expect(page.getByRole("heading", { level: 1, name: "Página 2 · Libro 1" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Volver al catálogo" }).first()).toHaveAttribute("href", "/catalog?productType=PHYSICAL&page=1");
  await page.getByRole("link", { name: "Volver al catálogo" }).first().click();
  await expect(page).toHaveURL("/catalog?productType=PHYSICAL&page=1");
  await expect(page.getByRole("navigation", { name: "Paginación del catálogo" })).toContainText("Página 2 de");
  await expect(results).toBeFocused();
  expect(Math.abs(await results.evaluate((element) => element.getBoundingClientRect().top - 104))).toBeLessThanOrEqual(1);
});

test("keeps the editorial Home and Bricolage heading hierarchy at all target widths", async ({ page }) => {
  await mockCatalogApi(page); await page.goto("/");
  await expect(page.getByRole("heading", { name: "Popular en PLIEGO" })).toBeVisible();
  await page.evaluate(() => document.fonts.ready);
  for (const width of [320, 375, 768, 1024, 1440, 1920]) {
    await page.setViewportSize({ width, height: 900 });
    const title = page.getByRole("heading", { level: 1 });
    await expect(title).toBeVisible();
    // Libros has a featured title in this mock, so the header shows it as a section menu.
    await expect(page.getByTestId("site-header").getByRole("button", { name: width >= 960 ? "Libros" : "Abrir navegación", exact: true })).toBeVisible();
    expect(await title.evaluate((node) => getComputedStyle(node).fontFamily)).toContain("Bricolage Grotesque");
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth)).toBe(width);
  }
});

test("keeps card covers and metadata aligned at the requested viewport widths", async ({ page }) => {
  await mockCatalogApi(page);
  await page.goto("/catalog");
  await expect(page.locator("[data-bookcard]").first()).toBeVisible();
  await page.evaluate(() => document.fonts.ready);

  for (const width of [1440, 768, 390, 320]) {
    await page.setViewportSize({ width, height: 1000 });
    const cover = await page.locator(".edition-item .cover-frame").first().boundingBox();
    const metadata = await page.locator("[data-bookcard-title]").first().boundingBox();
    expect(cover, `cover at ${width}px`).not.toBeNull();
    expect(metadata, `metadata at ${width}px`).not.toBeNull();
    const productSurface = await page.locator("[data-bookcard-link] > div").first().boundingBox();
    expect(metadata!.x).toBeCloseTo(productSurface!.x, 0);
    expect(metadata!.width).toBeCloseTo(productSurface!.width, 0);
    // Covers stand on the shelf aligned to the text edge (no centered stage).
    expect(cover!.x).toBeGreaterThanOrEqual(productSurface!.x);
    expect(cover!.width).toBeLessThan(productSurface!.width);
    expect(await page.evaluate(() => document.documentElement.scrollWidth), `page width at ${width}px`).toBe(width);
  }
});

test("preserves search, sort, and price criteria from edition category links", async ({ page }) => {
  await mockCatalogApi(page);
  await page.goto("/catalog?que=Julio&minPrice=12.00&sort=PRICE_DESC&page=2");
  await page.locator("[data-bookcard-link]").filter({ has: page.getByRole("heading", { name: "Cien años de soledad", exact: true }) }).click();

  await page.locator("main").getByRole("link", { name: "Narrativa" }).click();
  await expect(page).toHaveURL(/que=Julio/);
  const url = new URL(page.url());
  expect(url.searchParams.get("category")).toBe("narrativa");
  expect(url.searchParams.get("minPrice")).toBe("12.00");
  expect(url.searchParams.get("sort")).toBe("PRICE_DESC");
  expect(url.searchParams.has("page")).toBe(false);
});

test("sets administrative and not-found titles and focuses their headings", async ({ page }) => {
  await mockCatalogApi(page);
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
  await page.getByRole("main").getByRole("link", { name: "Cien años de soledad", exact: true }).click();

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
  const reconciliationReads = cartReads - baselineCartReads;
  expect(reconciliationReads).toBeGreaterThanOrEqual(2);
  expect(reconciliationReads).toBeLessThanOrEqual(3);
});

test("shows the first row's prices on initial desktop load", async ({ page }) => {
  await mockCatalogApi(page);
  for (const [width, height] of [[1280, 720], [1440, 800]]) {
    await page.setViewportSize({ width, height });
    await page.goto("/catalog");
    const prices = page.locator(".edition-item [data-bookcard-price]");
    await expect(prices.first()).toBeVisible();
    const firstRow = Math.min(4, await prices.count());
    for (let index = 0; index < firstRow; index++) await expect(prices.nth(index), `${width}x${height}, book ${index + 1}`).toBeInViewport({ ratio: 1 });
  }
});

test("keeps mobile books visible while grouping filters in an accessible Drawer", async ({ page }) => {
  await mockCatalogApi(page); await page.setViewportSize({ width: 375, height: 844 }); await page.goto("/catalog");
  await expect(page.locator(".edition-item .cover-frame").first()).toBeInViewport({ ratio: 0.5 });
  const trigger = page.getByRole("button", { name: /^Filtros/ });
  await trigger.click();
  const drawer = page.getByRole("dialog", { name: "Filtros" });
  await expect(drawer).toBeVisible();
  // Price is browsed through the sort order: the drawer offers no typed range.
  await expect(drawer.getByText("Precio mínimo")).toHaveCount(0);
  await drawer.getByRole("button", { name: "Idioma" }).click();
  await drawer.getByRole("radio", { name: "Inglés", exact: true }).click();
  await expect(page).toHaveURL(/language=en/);
  // Criteria apply in place: the drawer stays open over the updated results until it is closed.
  await expect(drawer).toBeVisible();
  await expect(trigger).toHaveAccessibleName(/Filtros, 1 activo/);
  await drawer.getByRole("button", { name: /^Ver \d+ edici/ }).click();
  await expect(drawer).toHaveCount(0);
  await expect(trigger).toBeFocused();
  await expect(page.getByRole("list", { name: "Criterios aplicados" }).getByRole("button")).toHaveCount(1);
});

test("price is browsed by sorting; shared price-range URLs stay applied and removable", async ({ page }) => {
  await mockCatalogApi(page); await page.goto("/catalog?minPrice=9.25&maxPrice=30.50");
  await expect(page.getByText("Precio mínimo")).toHaveCount(0);
  await page.getByRole("button", { name: /^Quitar .*9,25/ }).click();
  await expect(page).not.toHaveURL(/minPrice=/);
  await page.getByRole("combobox", { name: "Ordenar por" }).click();
  await page.getByRole("option", { name: "Precio: menor a mayor" }).click();
  await expect(page).toHaveURL(/sort=PRICE_ASC/);
});

test("keeps catalog search usable at the minimum 320px viewport", async ({ page }) => {
  await mockCatalogApi(page);
  await page.setViewportSize({ width: 320, height: 740 });
  await page.goto("/");

  const searchTrigger = page.getByRole("button", { name: "Buscar libros en el catálogo" });
  const searchButtonBounds = await searchTrigger.boundingBox();
  const searchbox = await openCatalogSearch(page);
  const queryBounds = await searchbox.boundingBox();
  const closeButtonBounds = await page.getByRole("button", { name: "Cerrar búsqueda" }).boundingBox();
  expect(queryBounds).not.toBeNull();
  expect(searchButtonBounds).not.toBeNull();
  expect(closeButtonBounds).not.toBeNull();
  expect(queryBounds!.width).toBeGreaterThanOrEqual(130);
  expect(queryBounds!.height).toBeGreaterThanOrEqual(44);
  expect(searchButtonBounds!.height).toBeGreaterThanOrEqual(44);
  expect(closeButtonBounds!.height).toBeGreaterThanOrEqual(44);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(320);
});

test("keeps the global search in browser history and shared filters usable", async ({ page }) => {
  await mockCatalogApi(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");
  await page.evaluate(() => document.fonts.ready);

  let searchbox = await openCatalogSearch(page);
  await expect(page.getByRole("combobox", { name: "Buscar por" })).toHaveCount(0);
  await searchbox.fill("Cien años");
  await searchbox.press("Enter");
  await expect(page).toHaveURL(/\/catalog\?que=Cien\+a%C3%B1os/);
  searchbox = await openCatalogSearch(page);
  await searchbox.fill("Cervantes");
  await searchbox.press("Enter");
  await expect(page).toHaveURL(/\/catalog\?que=Cervantes/);
  await page.goBack();
  await expect(page).toHaveURL(/\/catalog\?que=Cien\+a%C3%B1os/);
  searchbox = await openCatalogSearch(page);
  await expect(searchbox).toHaveValue("Cien años");
  await page.keyboard.press("Escape");
  await page.goForward();
  await expect(page).toHaveURL(/\/catalog\?que=Cervantes/);
  searchbox = await openCatalogSearch(page);
  await expect(searchbox).toHaveValue("Cervantes");
  await page.keyboard.press("Escape");

  await page.setViewportSize({ width: 320, height: 740 });
  await page.goto("/");
  const compactButton = page.getByRole("button", { name: "Buscar libros en el catálogo" });
  expect((await compactButton.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  const compactSearch = await openCatalogSearch(page);
  await compactSearch.fill("978-0-306-40615-7");
  await compactSearch.press("Enter");
  await expect(page).toHaveURL(/\/catalog\?que=978-0-306-40615-7/);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(320);

  await page.setViewportSize({ width: 320, height: 500 });
  await page.goto("/catalog");
  await page.getByRole("button", { name: /^Filtros/ }).click();
  const drawer = page.getByRole("dialog", { name: "Filtros" });
  await drawer.getByRole("button", { name: "Idioma" }).click();
  await drawer.getByRole("group", { name: "Idioma" }).getByText("Inglés", { exact: true }).click();
  await expect(page).toHaveURL(/language=en/);
  await expect(drawer.getByRole("radio", { name: "Inglés", exact: true })).toBeChecked();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(320);

});

test("sign-in returns to the storefront without exposing the email in its header", async ({ page }) => {
  await mockCatalogApi(page);
  await page.route("**/api/v1/auth/register", (route) => route.fulfill({
    status: 201,
    contentType: "application/json",
    body: JSON.stringify({ userId: "100", customerId: "88", state: "PENDING_VERIFICATION" }),
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
  await page.getByRole("link", { name: "Iniciar sesión", exact: true }).click();
  await page.locator("main").getByRole("link", { name: "Crear cuenta", exact: true }).click();
  await expect(page).toHaveURL(/\/register\?/);
  await page.getByLabel("Nombres").fill("Ana María");
  await page.getByLabel("Apellidos").fill("Pérez López");
  await page.getByLabel("Correo electrónico").fill("ana@example.com");
  await page.getByLabel("Contraseña").fill("lectura-segura");
  await page.getByRole("button", { name: "Crear cuenta" }).click();
  await expect(page.getByRole("heading", { name: "Revisa tu correo" })).toBeVisible();

  await page.getByRole("link", { name: "Iniciar sesión" }).last().click();
  await expect(page).toHaveURL(/\/sign-in\?/);
  await page.getByLabel("Correo electrónico").fill("ana@example.com");
  await page.getByLabel("Contraseña").fill("lectura-segura");
  await page.getByRole("button", { name: "Iniciar sesión" }).click();
  await expect(page).toHaveURL("/");
  await expect(page.getByTestId("site-header").getByRole("button", { name: "Menú de cuenta" })).toBeVisible();
  await expect(page.getByTestId("site-header").getByText("ana@example.com")).toHaveCount(0);
});

test("keeps open subcategory menus inside a 320px viewport", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 740 });
  await page.route("**/api/v1/catalog/categories**", (route) => route.fulfill({
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
  await page.route("**/api/v1/catalog/filter-options**", (route) => route.fulfill({
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
