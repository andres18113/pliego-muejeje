import { expect, test } from "@playwright/test";

test.skip(!process.env.PLIEGO_E2E_LIVE, "Set PLIEGO_E2E_LIVE=1 against a disposable backend with active offers.");
test("live offer filters, sorting, validity and prices match the backend", async ({ page }) => {
  const response = await page.request.get("/api/v1/catalog/offers?productType=EBOOK&sort=ENDING_SOON&pageSize=20");
  expect(response.ok()).toBeTruthy();
  const result = await response.json();
  expect(result.items.length).toBeGreaterThan(0);
  const first = result.items[0];
  expect(first.price).toBe(first.offer.effectivePrice);
  expect(first.offer.savingsAmount).toBe(first.offer.discountAmount);
  expect(first.offer.daysRemaining).toBeGreaterThanOrEqual(0);
  await page.goto("/ofertas");
  await page.getByRole("button", { name: /^eBooks \(/ }).click();
  await page.getByLabel("Ordenar ofertas").selectOption("ENDING_SOON");
  await expect(page).toHaveURL(/productType=EBOOK&sort=ENDING_SOON$/);
  const card = page.locator("[data-bookcard]").first();
  await expect(card).toHaveAttribute("data-edition-id", first.editionId);
  await expect(card.locator("[data-bookcard-price]")).toContainText(first.price.replace(".", ","));
  await expect(card.locator("s")).toContainText(first.offer.originalPrice.replace(".", ","));
  await expect(card.getByText(`Quedan ${first.offer.daysRemaining} ${first.offer.daysRemaining === 1 ? "día" : "días"}`, { exact: true })).toBeVisible();
  await expect(card.locator("time")).toHaveAttribute("datetime", first.offer.endsAt);
  if (first.offer.offerCopy) await expect(card.getByText(first.offer.offerCopy, { exact: true })).toBeVisible();
  if (first.offer.terms) {
    await card.getByText("Términos de la oferta", { exact: true }).click();
    await expect(card.getByText(first.offer.terms, { exact: true })).toBeVisible();
  }
  await card.getByRole("link", { name: /^Ver edición:/ }).click();
  await expect(page.getByRole("heading", { level: 1, name: first.title, exact: true })).toBeVisible();
  await expect(page.locator("s")).toContainText(first.offer.originalPrice.replace(".", ","));
});
