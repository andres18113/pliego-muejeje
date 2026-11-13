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

// Primary sections are reached from the header (which marks the current one) or the account menu: no back arrow.
const primary = ["/", "/catalog", "/catalog?productType=EBOOK", "/catalog?productType=AUDIOBOOK", "/ofertas", "/ayuda", "/account", "/account/addresses", "/favorites", "/orders", "/biblioteca"];

for (const width of [320, 1440]) {
  for (const theme of ["light", "dark"]) {
    test(`primary sections carry no back control at ${width}px ${theme}`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await page.addInitScript(value => localStorage.setItem("mantine-color-scheme-value", value), theme);
      const commands = await install(page, true);
      for (const path of primary) {
        await page.goto(path);
        await expect(page.getByRole("heading", { level: 1 }).first()).toBeAttached();
        await expect(page.getByTestId("site-header").getByRole("link", { name: "PLIEGO, ir al inicio" })).toHaveAttribute("href", "/");
        await expect(page.getByRole("button", { name: "Volver atrás", exact: true }), path).toHaveCount(0);
        await expect(page.getByRole("main").getByRole("link", { name: /^Volver a/ }), path).toHaveCount(0);
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), path).toBe(true);
      }
      await page.goto("/cart");
      await expect(page.locator("[data-purchase-header]").getByRole("button", { name: "Volver atrás", exact: true })).toHaveCount(0);
      expect(commands).toEqual([]);
    });

    test(`a child page names its parent 8px under the header, on the content edge, at ${width}px ${theme}`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await page.addInitScript(value => localStorage.setItem("mantine-color-scheme-value", value), theme);
      const commands = await install(page);
      await page.goto("/ayuda/no-existe");
      const parent = page.getByRole("main").getByRole("link", { name: "Volver a Ayuda" });
      await expect(parent).toBeVisible();
      const link = (await parent.boundingBox())!, bar = (await page.getByTestId("site-header").boundingBox())!;
      expect(link.height).toBeGreaterThanOrEqual(44);
      expect(Math.abs(link.y - (bar.y + bar.height) - 8)).toBeLessThanOrEqual(1);
      const contentStart = await page.getByRole("main").evaluate(main => main.getBoundingClientRect().left + parseFloat(getComputedStyle(main).paddingLeft));
      expect(Math.abs(link.x - contentStart)).toBeLessThanOrEqual(1);
      await parent.click();
      await expect(page).toHaveURL(/\/ayuda$/);
      expect(commands).toEqual([]);
    });
  }
}

test("unknown route recovers home through its own link and no arrow is drawn there or on the root", async ({ page }) => {
  const commands = await install(page);
  await page.goto("/no-existe");
  await expect(page.getByRole("button", { name: "Volver atrás", exact: true })).toHaveCount(0);
  await page.getByRole("link", { name: /Ir al inicio/ }).click();
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByRole("button", { name: "Volver atrás", exact: true })).toHaveCount(0);
  expect(commands).toEqual([]);
});
