import { expect, test, type Page } from "@playwright/test";
import { storefrontNavigationFixture } from "../../src/test/storefrontFixture";

async function install(page: Page, customer = false) {
  const commands: string[] = [];
  await page.route("**/api/v1/**", async route => {
    const request = route.request(), path = new URL(request.url()).pathname;
    if (path === "/api/v1/auth/refresh") return customer
      ? route.fulfill({ json: { accessToken: "synthetic-navigation", tokenType: "Bearer", expiresInSeconds: 1800, user: { userId: "1", email: "navigation@example.invalid", role: "CUSTOMER" } } })
      : route.fulfill({ status: 204 });
    if (request.method() !== "GET") commands.push(`${request.method()} ${path}`);
    if (path === "/api/v1/storefront/navigation") return route.fulfill({ json: storefrontNavigationFixture });
    if (path === "/api/v1/cart") return route.fulfill({ json: { cartId: "1", state: "ACTIVE", items: [], requiresPhysicalFulfillment: false, physicalItemCount: 0, digitalItemCount: 0, totalCurrent: "0.00", originalSubtotal: "0.00", savingsTotal: "0.00", currentSubtotal: "0.00", subtotal: "0.00", taxRate: "0.00", taxAmount: "0.00", shippingAmount: "0.00", total: "0.00" } });
    if (path.endsWith("/filter-options")) return route.fulfill({ json: { languages: [], minimumPrice: null, maximumPrice: null } });
    if (path.endsWith("/categories")) return route.fulfill({ json: { items: [] } });
    if (/\/help\/articles\//.test(path)) return route.fulfill({ status: 404, json: { title: "Artículo no encontrado", status: 404 } });
    return route.fulfill({ json: { items: [], page: 0, pageSize: 20, totalCount: "0" } });
  });
  return commands;
}

for (const width of [320, 375, 768, 1440]) {
  for (const theme of ["light", "dark"]) {
    test(`safe direct fallback in both headers at ${width}px ${theme}`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await page.addInitScript(value => localStorage.setItem("mantine-color-scheme-value", value), theme);
      const commands = await install(page, true);
      await page.goto("/cart");
      const back = page.getByRole("button", { name: "Volver atrás", exact: true });
      await expect(back).toHaveCount(1);
      await expect(back).toBeVisible();
      const bounds = await back.boundingBox();
      expect(bounds!.width).toBeGreaterThanOrEqual(44);
      await expect(page.locator("[data-purchase-header]")).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await back.click();
      await expect(page).toHaveURL(/\/catalog$/);
      await expect(page.getByTestId("site-header")).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await page.reload();
      await expect(page.getByRole("button", { name: "Volver atrás", exact: true })).toBeVisible();
      expect(commands).toEqual([]);
    });
  }
}

test("global arrow skips catalog filter entries and retains the internal screen", async ({ page }) => {
  const commands = await install(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/ayuda");
  await page.getByRole("link", { name: "eBooks", exact: true }).first().click();
  await expect(page).toHaveURL(/productType=EBOOK/);
  await page.getByRole("link", { name: "Audiolibros", exact: true }).first().click();
  await expect(page).toHaveURL(/productType=AUDIOBOOK/);
  await page.getByRole("button", { name: "Volver atrás", exact: true }).click();
  await expect(page).toHaveURL(/\/ayuda$/);
  expect(commands).toEqual([]);
});

test("unknown route fallback stays inside PLIEGO and root hides the arrow", async ({ page }) => {
  const commands = await install(page);
  await page.goto("/no-existe");
  await page.getByRole("button", { name: "Volver atrás", exact: true }).click();
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByRole("button", { name: "Volver atrás", exact: true })).toHaveCount(0);
  expect(commands).toEqual([]);
});
