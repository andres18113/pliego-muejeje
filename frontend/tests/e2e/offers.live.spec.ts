import { expect, test } from "@playwright/test";

test.skip(!process.env.PLIEGO_E2E_LIVE, "Set PLIEGO_E2E_LIVE=1 against a disposable backend with active offers.");
test("live offer filters, sorting, validity and prices match the backend", async ({ page }) => {
  const response = await page.request.get("/api/v1/catalog/offers?productType=EBOOK&sort=ENDING_SOON&pageSize=50");
  expect(response.ok()).toBeTruthy();
  const result = await response.json();
  expect(result.items.length).toBeGreaterThan(0);
  const first = result.items[0];
  expect(first.price).toBe(first.offer.effectivePrice);
  expect(first.offer.savingsAmount).toBe(first.offer.discountAmount);
  expect(first.offer.daysRemaining).toBeGreaterThanOrEqual(0);
  await page.goto("/ofertas");
  await page.getByRole("button", { name: /^eBooks \(/ }).click();
  await page.getByRole("combobox", { name: "Ordenar por" }).click();
  await page.getByRole("option", { name: "Próximas a terminar" }).click();
  await expect(page).toHaveURL(/productType=EBOOK&sort=ENDING_SOON$/);
  // The whole set on one shelf: as many cards as the server counts, with no pages.
  await expect(page.locator("[data-offer-card]")).toHaveCount(Number(result.totalCount));
  await expect(page.getByText(/Página|Siguiente|Anterior/)).toHaveCount(0);
  const card = page.locator("[data-offer-card]").first();
  await expect(card).toHaveAttribute("data-edition-id", first.editionId);
  await expect(card.locator("[data-bookcard-price]")).toContainText(first.price.replace(".", ","));
  await expect(card.locator("s")).toContainText(first.offer.originalPrice.replace(".", ","));
  const days = first.offer.daysRemaining;
  if (days <= 5) await expect(card.locator("[data-offer-urgency]")).toHaveText(days === 0 ? "Termina hoy" : days === 1 ? "Queda 1 día" : `Quedan ${days} días`);
  else await expect(card.locator("[data-offer-urgency]")).toHaveCount(0);
  await card.getByRole("link", { name: /^Ver edición:/ }).click();
  await expect(page.getByRole("heading", { level: 1, name: first.title, exact: true })).toBeVisible();
  await expect(page.locator("s")).toContainText(first.offer.originalPrice.replace(".", ","));
});
