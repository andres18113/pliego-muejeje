import { expect, test, type Page, type Route } from "@playwright/test";
import { storefrontNavigationFixture } from "../../src/test/storefrontFixture";

async function publicReads(page: Page) {
  await page.route("**/api/v1/**", route => {
    const path = new URL(route.request().url()).pathname;
    if (path === "/api/v1/storefront/navigation") return route.fulfill({ json: storefrontNavigationFixture });
    return route.fulfill({ json: { items: [], page: 0, pageSize: 20, totalCount: "0" } });
  });
}

test("a stalled session restore leaves the spinner and recovers through retry", async ({ page }) => {
  await publicReads(page);
  let calls = 0;
  let stalled: Route | undefined;
  await page.route("**/api/v1/auth/refresh", route => {
    calls++;
    if (calls === 1) { stalled = route; return; }
    return route.fulfill({ status: 204 });
  });
  await page.goto("/");
  await expect(page.getByRole("status")).toContainText("Comprobando tu sesión");
  await expect(page.getByRole("alert")).toContainText("No pudimos comprobar tu sesión", { timeout: 15_000 });
  await expect(page.getByRole("link", { name: "Iniciar sesión", exact: true })).toHaveCount(0);
  await stalled?.abort().catch(() => undefined);
  await page.getByRole("button", { name: "Reintentar", exact: true }).click();
  await expect(page.getByTestId("site-header").getByRole("link", { name: "Libros", exact: true })).toBeVisible();
  expect(calls).toBe(2);
});

test("a session lock held by another tab times out without bypassing it", async ({ page, context }) => {
  const holder = await context.newPage();
  await holder.goto("/");
  await holder.evaluate(async () => {
    let acquired!: () => void;
    const ready = new Promise<void>(resolve => { acquired = resolve; });
    void navigator.locks.request("pliego-auth-session", () => {
      acquired();
      return new Promise<void>(resolve => {
        (window as unknown as { releaseSessionLock: () => void }).releaseSessionLock = resolve;
      });
    });
    await ready;
  });
  await publicReads(page);
  let refreshCalls = 0;
  await page.route("**/api/v1/auth/refresh", route => { refreshCalls++; return route.fulfill({ status: 204 }); });
  await page.goto("/");
  await expect(page.getByRole("alert")).toContainText("No pudimos comprobar tu sesión", { timeout: 15_000 });
  expect(refreshCalls).toBe(0);
  await holder.evaluate(() => (window as unknown as { releaseSessionLock: () => void }).releaseSessionLock());
  await page.getByRole("button", { name: "Reintentar", exact: true }).click();
  await expect(page.getByTestId("site-header").getByRole("link", { name: "Libros", exact: true })).toBeVisible();
  expect(refreshCalls).toBe(1);
});
