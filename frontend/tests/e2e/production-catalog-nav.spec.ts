import { expect, test, type Page } from "@playwright/test";
import { storefrontNavigationFixture } from "../../src/test/storefrontFixture";

const editions = [
  { editionId: "250", title: "Manual de medicina basada en evidencias", format: "PAPERBACK", label: "Libro" },
  { editionId: "251", title: "Administración de proyectos de informática", format: "EBOOK", label: "eBook" },
  { editionId: "252", title: "Anatomía y fisiología básicas en el niño", format: "AUDIOBOOK", label: "Audiolibro" },
].map(edition => ({ ...edition, bookId: edition.editionId, authors: "Autora Prueba", publisher: "Editorial Prueba", isbn13: null,
  price: "18.50", coverUrl: null, coverLicense: null, coverAttribution: null, language: "es", available: true,
  ebookFileFormat: edition.format === "EBOOK" ? "EPUB" : null, audioDurationSeconds: edition.format === "AUDIOBOOK" ? 3600 : null,
  narrators: edition.format === "AUDIOBOOK" ? ["Ana Voz"] : [],
}));

async function mockCatalog(page: Page) {
  await page.route("**/api/v1/**", route => {
    const url = new URL(route.request().url());
    if (url.pathname.endsWith("/auth/refresh")) return route.fulfill({ status: 204 });
    if (url.pathname.endsWith("/storefront/navigation")) return route.fulfill({ json: storefrontNavigationFixture });
    if (url.pathname.endsWith("/catalog/categories")) return route.fulfill({ json: { items: [] } });
    if (url.pathname.endsWith("/catalog/filter-options")) return route.fulfill({ json: {
      formats: ["PAPERBACK", "EBOOK", "AUDIOBOOK"], languages: ["es"], minimumPrice: "18.50", maximumPrice: "18.50",
    } });
    const edition = editions.find(item => url.pathname.endsWith(`/catalog/editions/${item.editionId}`));
    if (edition) return route.fulfill({ json: { ...edition, sku: `ED-${edition.editionId}`, subtitle: null, synopsis: null,
      authors: [{ authorId: "9", name: edition.authors, order: 1 }], publisher: { publisherId: "5", name: edition.publisher },
      categories: [], pageCount: null, publicationDate: null, coverSourceUrl: null,
    } });
    if (url.pathname.endsWith("/catalog/editions")) return route.fulfill({ json: {
      items: editions, page: Number(url.searchParams.get("page") ?? 0),
      pageSize: Number(url.searchParams.get("pageSize") ?? url.searchParams.get("size") ?? 20), totalCount: "3",
    } });
    return route.fulfill({ status: 404, json: {} });
  });
}

for (const width of [320, 390, 768, 1280]) {
  test(`PUB-01 formats remain visible on mixed cards, search, and PDP at ${width}px`, async ({ page }) => {
    await mockCatalog(page);
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/catalog");
    const cards = page.locator("[data-bookcard]");
    await expect(cards).toHaveCount(3);
    for (const edition of editions) {
      const card = cards.filter({ has: page.getByRole("heading", { name: edition.title, exact: true }) });
      await expect(card.getByText(edition.label, { exact: true })).toBeVisible();
      await expect(card.locator("[data-bookcard-link]")).toHaveAccessibleName(new RegExp(edition.label));
      expect(await card.locator("[data-bookcard-format]").evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true);
    }
    await page.getByRole("button", { name: "Buscar libros en el catálogo" }).click();
    const search = page.getByRole("dialog", { name: "Buscar en el catálogo" });
    await search.getByRole("searchbox").fill("de");
    for (const edition of editions) {
      const result = search.getByRole("link", { name: new RegExp(edition.title) });
      await expect(result.getByText(edition.label, { exact: true })).toBeVisible();
      await expect(result).toHaveAccessibleName(new RegExp(edition.label));
    }
    await page.keyboard.press("Escape");
    for (const edition of editions) {
      await page.goto(`/catalog/editions/${edition.editionId}?from=%2Fcatalog`);
      const heading = page.getByRole("heading", { level: 1, name: edition.title });
      await expect(heading).toBeVisible();
      await expect(heading.locator("..").getByText(edition.label)).toBeVisible();
    }
    await page.screenshot({ path: test.info().outputPath(`formats-${width}.png`), fullPage: true });
  });

  test(`MOB-02 original offers/sign-in/edition sequence labels each destination at ${width}px`, async ({ page }) => {
    await mockCatalog(page);
    await page.setViewportSize({ width, height: 900 });
    const editionHref = "/catalog/editions/250?from=%2Fofertas";
    await page.goto(editionHref);
    await page.getByRole("link", { name: "Iniciar sesión para agregar", exact: true }).click();
    const back = page.getByRole("main").getByRole("link", { name: "Volver a la edición", exact: true });
    await expect(back).toHaveAttribute("href", editionHref);
    await back.click();
    await expect(page).toHaveURL(new RegExp(`${editionHref.replace("?", "\\?")}$`));
    const trail = page.getByRole("navigation", { name: "Ruta de navegación" });
    await expect(trail.getByRole("link", { name: "Catálogo", exact: true })).toHaveAttribute("href", "/catalog");
    await expect(page.getByRole("contentinfo").getByRole("link", { name: "Volver a Ofertas", exact: true })).toHaveAttribute("href", "/ofertas");
    await trail.getByRole("link", { name: "Catálogo", exact: true }).click();
    await expect(page).toHaveURL(/\/catalog$/);

    const filteredCatalog = "/catalog?que=medicina&productType=PHYSICAL&sort=PRICE_DESC";
    await page.goto(filteredCatalog);
    await page.locator('[data-edition-id="250"] [data-bookcard-link]').click();
    await expect(page.getByRole("contentinfo").getByRole("link", { name: "Volver al catálogo", exact: true })).toHaveAttribute("href", filteredCatalog);
    await page.getByRole("contentinfo").getByRole("link", { name: "Volver al catálogo", exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`${filteredCatalog.replace("?", "\\?")}$`));
  });
}
