import { readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";

const fixturePath = process.env.PLIEGO_LIBRARY_FIXTURE_PATH;
test.skip(!fixturePath, "Requires the verified disposable library checkout HTTP fixture.");
const apiOrigin = process.env.PLIEGO_API_BASE_URL ?? "http://127.0.0.1:18080";

interface LibraryFixture {
  email: string;
  password: string;
  ebookOwnedItemId: string;
  audioOwnedItemId: string;
  mixedOrderId: string;
}

test("real purchase ownership supports list, media filters, detail, purchase and Help", async ({ page }) => {
  const fixture = JSON.parse(readFileSync(fixturePath!, "utf8")) as LibraryFixture;
  for (const id of [fixture.ebookOwnedItemId, fixture.audioOwnedItemId, fixture.mixedOrderId]) {
    expect(id).toMatch(/^[1-9]\d*$/);
  }
  await page.route("**/api/v1/**", route => {
    const url = new URL(route.request().url());
    return route.continue({ url: `${apiOrigin}${url.pathname}${url.search}` });
  });
  await page.goto("/sign-in?from=%2Fbiblioteca");
  await page.getByLabel("Correo electrónico").fill(fixture.email);
  await page.getByLabel("Contraseña", { exact: true }).fill(fixture.password);
  await page.getByRole("button", { name: "Iniciar sesión", exact: true }).click();
  await expect(page).toHaveURL(/\/biblioteca$/);
  await expect(page.getByRole("heading", { name: "Mi biblioteca", exact: true })).toBeVisible();
  await page.getByRole("group", { name: "Mostrar" }).getByRole("button", { name: "eBooks" }).click();
  await expect(page.locator(`a[href="/biblioteca/${fixture.ebookOwnedItemId}"]`)).toBeVisible();
  await expect(page.locator(`a[href="/biblioteca/${fixture.audioOwnedItemId}"]`)).toHaveCount(0);
  await page.locator(`a[href="/biblioteca/${fixture.ebookOwnedItemId}"]`).click();
  await expect(page.getByText("Pertenece a tu cuenta", { exact: true })).toBeVisible();
  await expect(page.getByText("EPUB", { exact: true })).toBeVisible();
  await expect(page.getByRole("region", { name: "Información de compra" })).toContainText(fixture.mixedOrderId);
  await expect(page.getByRole("link", { name: /^(Leer|Escuchar|Continuar leyendo|Continuar escuchando|Descargar)$/ })).toHaveCount(0);
  await page.getByRole("link", { name: "Volver a Mi biblioteca" }).click();
  await page.getByRole("group", { name: "Mostrar" }).getByRole("button", { name: "Audiolibros" }).click();
  await page.locator(`a[href="/biblioteca/${fixture.audioOwnedItemId}"]`).click();
  await expect(page.getByText("Voz Biblioteca", { exact: true })).toBeVisible();
  await expect(page.getByText("Pertenece a tu cuenta", { exact: true })).toBeVisible();
  const actions = page.getByRole("navigation", { name: "Acciones de la adquisición" });
  await expect(actions.getByRole("link", { name: "Ver pedido" })).toHaveAttribute("href", `/orders/${fixture.mixedOrderId}`);
  await actions.getByRole("link", { name: "Ayuda" }).click();
  await expect(page).toHaveURL(/\/ayuda\/audiolibros$/);
  await expect(page.getByRole("heading", { name: "Audiolibros", exact: true })).toBeVisible();
  await page.goto("/ayuda");
  // The approved resource index exposes articles directly; search is an API capability.
  await expect(page.getByRole("link", { name: "Cancelaciones y reembolsos", exact: true })).toBeVisible();
  await page.getByRole("link", { name: "Cancelaciones y reembolsos", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Cancelaciones y reembolsos", exact: true })).toBeVisible();
});

test("real public navigation and catalog expose media-scoped bestseller contracts", async ({ request }) => {
  const response = await request.get(`${apiOrigin}/api/v1/storefront/navigation`);
  expect(response.status()).toBe(200);
  const navigation = await response.json();
  expect(navigation.sections.map((section: { key: string }) => section.key)).toEqual(["PHYSICAL", "EBOOK", "AUDIOBOOK", "OFFERS", "HELP"]);
  for (const section of navigation.sections.slice(0, 3)) {
    expect(section.featured.length).toBeLessThanOrEqual(3);
    expect(section.bestSellingHref).toContain("sort=BEST_SELLING");
    const catalog = await request.get(`${apiOrigin}/api/v1/catalog/editions?productType=${section.key}&sort=BEST_SELLING`);
    expect(catalog.status()).toBe(200);
    const editions = await catalog.json();
    for (const edition of editions.items) {
      expect(section.key === "PHYSICAL" ? ["PAPERBACK", "HARDCOVER"] : [section.key]).toContain(edition.format);
    }
  }
});
