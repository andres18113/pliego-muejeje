import { expect, test, type Page } from "@playwright/test";
import { storefrontNavigationFixture } from "../../src/test/storefrontFixture";

async function mockDiscovery(page: Page, empty = false) {
  const requests: URL[] = [];
  await page.route("**/api/v1/**", route => {
    const url = new URL(route.request().url());
    if (url.pathname.endsWith("/auth/refresh")) return route.fulfill({ status: 204 });
    if (url.pathname.endsWith("/storefront/navigation")) return route.fulfill({ json: storefrontNavigationFixture });
    const scope = url.searchParams.get("scope") ?? "GLOBAL";
    if (url.pathname.endsWith("/catalog/categories")) {
      requests.push(url);
      return route.fulfill({ json: { items: empty ? [] : [{ slug: scope.toLowerCase(), name: `Tema ${scope}`, parentSlug: null }] } });
    }
    if (url.pathname.endsWith("/catalog/filter-options")) {
      requests.push(url);
      const formats = empty ? [] : scope === "GLOBAL" ? ["PAPERBACK", "EBOOK", "AUDIOBOOK"] : scope === "PHYSICAL" ? ["PAPERBACK", "HARDCOVER"] : [scope];
      return route.fulfill({ json: { formats, languages: empty ? [] : ["es"], minimumPrice: empty ? null : "10.00", maximumPrice: empty ? null : "40.00" } });
    }
    if (url.pathname.endsWith("/catalog/editions")) return route.fulfill({ json: { items: [], page: 0, pageSize: 20, totalCount: "0" } });
    return route.fulfill({ status: 404, json: {} });
  });
  return requests;
}

test("catalog navigation scopes both discovery reads and keeps cached scopes separate", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  const requests = await mockDiscovery(page);
  await page.goto("/catalog");
  await page.getByRole("button", { name: "Tema", exact: true }).click();
  for (const [scope, label] of [["GLOBAL", "Todos los libros"], ["PHYSICAL", "Libros"], ["EBOOK", "eBooks"], ["AUDIOBOOK", "Audiolibros"]] as const) {
    if (scope !== "GLOBAL") await page.getByTestId("site-header").getByRole("link", { name: label, exact: true }).click();
    await expect(page.getByRole("heading", { name: label, exact: true })).toBeVisible();
    await expect(page.getByRole("radio", { name: `Tema ${scope}`, exact: true })).toBeVisible();
    await expect.poll(() => ["categories", "filter-options"].every(endpoint => requests.some(url => url.pathname.endsWith(`/catalog/${endpoint}`) && url.searchParams.get("scope") === scope))).toBe(true);
    if (scope === "EBOOK" || scope === "AUDIOBOOK") await expect(page.getByRole("button", { name: "Formato", exact: true })).toHaveCount(0);
  }
  await page.goBack();
  await expect(page).toHaveURL(/productType=EBOOK/);
  await expect(page.getByRole("radio", { name: "Tema EBOOK", exact: true })).toBeVisible();
  await expect(page.getByRole("radio", { name: "Tema AUDIOBOOK", exact: true })).toHaveCount(0);
});

for (const width of [390, 1440]) test(`selected absent criteria recover after reload at ${width}px`, async ({ page }) => {
  await page.setViewportSize({ width, height: 1000 });
  await mockDiscovery(page, true);
  const destination = "/catalog?que=Libro&category=tema-antiguo&minPrice=10&maxPrice=40&language=en&format=HARDCOVER&productType=EBOOK&sort=BEST_SELLING";
  await page.goto(destination);
  await page.reload();
  const panel = width < 1024 ? page.getByRole("dialog", { name: "Filtros" }) : page.getByRole("complementary", { name: "Filtros" });
  if (width < 1024) await page.getByRole("button", { name: /^Filtros,/ }).click();
  await expect(panel.getByRole("radio", { name: "tema-antiguo", exact: true })).toBeChecked();
  await expect(panel.getByRole("radio", { name: "Tapa dura", exact: true })).toBeChecked();
  await expect(panel.getByRole("radio", { name: "Inglés", exact: true })).toBeChecked();
  await panel.getByText("Todos los temas", { exact: true }).click();
  await expect.poll(() => new URL(page.url()).searchParams.has("category")).toBe(false);
  const retained = new URL(page.url()).searchParams;
  expect(Object.fromEntries(retained)).toMatchObject({ que: "Libro", minPrice: "10.00", maxPrice: "40.00", language: "en", format: "HARDCOVER", productType: "EBOOK", sort: "BEST_SELLING" });
  if (width < 1024) await panel.getByRole("button", { name: "Cerrar filtros", exact: true }).click();
  await page.getByRole("link", { name: "Limpiar filtros", exact: true }).click();
  await expect(page).toHaveURL(/que=Libro&productType=EBOOK&sort=BEST_SELLING$/);
});
