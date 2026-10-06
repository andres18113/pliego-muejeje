import { expect, test } from "@playwright/test";

test("offers load, paginate and open an edition using authoritative prices", async ({ page }) => {
  const edition = { editionId: "42", bookId: "1", title: "Edición con oferta", authors: "Autora", publisher: "Editorial", isbn13: null, price: "8.00", coverUrl: null, coverLicense: null, coverAttribution: null, format: "EBOOK", language: "es", available: true, ebookFileFormat: "EPUB", audioDurationSeconds: null, narrators: [], offer: { offerId: "1", originalPrice: "10.00", discountAmount: "2.00", effectivePrice: "8.00", savingsAmount: "2.00", savingsPercent: "20.00", startsAt: "2026-10-01T00:00:00Z", endsAt: "2026-11-01T00:00:00Z", daysRemaining: 2, endingSoon: true } };
  await page.route("**/api/v1/**", route => {
    const url = new URL(route.request().url());
    if (url.pathname.endsWith("/auth/refresh")) return route.fulfill({ status: 204 });
    const body = url.pathname.endsWith("/catalog/editions/42")
      ? { ...edition, sku: "EBOOK-OFFER", authors: [{ name: "Autora", order: 1 }], categories: [], publisher: { name: "Editorial" }, pageCount: null, subtitle: null, synopsis: null, publicationDate: null, coverSourceUrl: null }
      : { items: [edition], page: Number(url.searchParams.get("page") ?? 0), pageSize: 20, totalCount: "21" };
    return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(body) });
  });
  await page.goto("/ofertas");
  await expect(page.getByRole("heading", { name: "Edición con oferta" })).toBeVisible();
  await expect(page.locator("[data-bookcard-price]")).toContainText(/8,00/);
  await expect(page.locator("s")).toContainText(/10,00/);
  await page.getByRole("link", { name: "Siguiente", exact: true }).click();
  await expect(page).toHaveURL(/\/ofertas\?page=1$/);
  await page.getByRole("link", { name: /^Ver edición: Edición con oferta/ }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Edición con oferta" })).toBeVisible();
  await expect(page.getByText("EPUB", { exact: true })).toBeVisible();
  await expect(page.locator("s")).toContainText(/10,00/);
  await page.getByRole("link", { name: /Volver/ }).click();
  await expect(page).toHaveURL(/\/ofertas\?page=1$/);
});

test("offers show recoverable errors and a real empty state", async ({ page }) => {
  let failed = true;
  await page.route("**/api/v1/**", route => {
    if (route.request().url().endsWith("/auth/refresh")) return route.fulfill({ status: 204 });
    return route.fulfill({ status: failed ? 503 : 200, contentType: "application/json", body: JSON.stringify(failed ? {} : { items: [], page: 0, pageSize: 20, totalCount: "0" }) });
  });
  await page.goto("/ofertas");
  await expect(page.getByRole("alert").filter({ hasText: "No pudimos consultar las ofertas." })).toBeVisible();
  failed = false;
  await page.getByRole("button", { name: "Volver a intentar" }).click();
  await expect(page.getByText("No hay ofertas disponibles por ahora.")).toBeVisible();
});
