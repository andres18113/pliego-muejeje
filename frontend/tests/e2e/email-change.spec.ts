// Pending email change: Mi perfil states and the two link pages stay accessible (WCAG 2.2 AA) and fit at phone and desktop widths.
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
const json = (body: unknown, status = 200) => ({ status, contentType: "application/json", body: JSON.stringify(body) });
const token = "c".repeat(43);
async function signedIn(page: Page, pendingDelivery: "OK" | "UNDELIVERABLE") {
  await page.route("**/api/v1/auth/refresh", (r) => r.fulfill(json({ accessToken: "probe", tokenType: "Bearer", expiresInSeconds: 3600, user: { userId: "2", email: "ana.perez@example.com", role: "CUSTOMER" } })));
  await page.route("**/api/v1/me", (r) => r.fulfill(json({ customerId: "2", email: "ana.perez@example.com", emailVerified: true, emailDelivery: { status: "OK", since: null }, pendingEmail: { address: "ana.perez.nueva@gmail.com", expiresAt: "2026-11-02T15:00:00Z", delivery: pendingDelivery }, firstNames: "Ana", lastNames: "Pérez", phone: null, state: "ACTIVE", version: "0" })));
  await page.route("**/api/v1/me/billing-identity**", (r) => r.fulfill(json({ code: "NOT_FOUND" }, 404)));
  await page.route("**/api/v1/cart", (r) => r.fulfill(json({ cartId: "c", state: "ACTIVE", requiresPhysicalFulfillment: false, physicalItemCount: 0, digitalItemCount: 0, totalCurrent: "0.00", items: [] })));
}
async function audit(page: Page) {
  const result = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"]).analyze();
  expect(result.violations.map(({ id, nodes }) => ({ id, targets: nodes.map((n) => n.target) }))).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(page.viewportSize()!.width);
}
for (const width of [375, 1280]) {
  test(`account pending states ${width}`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    for (const delivery of ["OK", "UNDELIVERABLE"] as const) {
      await page.unrouteAll(); await signedIn(page, delivery);
      await page.goto("/account"); await expect(page.getByText(delivery === "OK" ? "Por confirmar" : "No recibe correos")).toBeVisible();
      await audit(page);
    }
  });
  test(`email change link pages ${width}`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.route("**/api/v1/auth/refresh", (r) => r.fulfill({ status: 204 }));
    await page.route("**/api/v1/auth/email-change/confirm", (r) => r.fulfill(json({ email: "ana.perez.nueva@gmail.com" })));
    await page.goto(`/confirmar-correo#token=${token}`);
    await expect(page.getByRole("heading", { name: "Correo confirmado" })).toBeVisible(); await audit(page);
    await page.route("**/api/v1/auth/email-change/cancel", (r) => r.fulfill(json({})));
    await page.goto(`/cancelar-cambio-correo#token=${token}`);
    await expect(page.getByRole("button", { name: "Cancelar el cambio" })).toBeVisible(); await audit(page);
    await page.getByRole("button", { name: "Cancelar el cambio" }).click();
    await expect(page.getByRole("heading", { name: "Cambio cancelado" })).toBeVisible(); await audit(page);
  });
}
