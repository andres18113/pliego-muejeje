import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { storefrontNavigationFixture } from "../../src/test/storefrontFixture";

test.use({ reducedMotion: "reduce" });

/**
 * /account/identity after a review (ADR 0055): the decision is the page's one step — outcome, reason, dates — and
 * never shares the page with a new correction form; a new request starts only after the outcome is acknowledged.
 */
const base = { id: "17", proposedType: "EC_CEDULA", proposedNumber: "1751550656", reasonCode: "DOCUMENT_TYPO",
  createdAt: "2026-11-03T17:00:00Z", dueAt: "2026-11-18T17:00:00Z" };
const rejected = { ...base, status: "REJECTED", decidedAt: "2026-11-03T22:10:00Z", decisionReason: "No pudimos verificarlo." };
const approved = { ...base, status: "APPROVED", decidedAt: "2026-11-03T22:10:00Z", decisionReason: null };

async function stub(page: Page, request: object, number: string) {
  let correction: object | null = request;
  const profile = { customerId: "2", firstNames: "Andrés", lastNames: "Ramírez", email: "lector@example.invalid", phone: null, state: "ACTIVE", version: "0", emailVerified: true };
  await page.route("**/api/v1/**", async route => {
    const path = new URL(route.request().url()).pathname.replace("/api/v1", "");
    if (path === "/auth/refresh") return route.fulfill({ json: { accessToken: "synthetic", tokenType: "Bearer", expiresInSeconds: 1800, user: { userId: "2", email: profile.email, role: "CUSTOMER" } } });
    if (path === "/storefront/navigation") return route.fulfill({ json: storefrontNavigationFixture });
    if (path === "/me/billing-identity") return route.fulfill({ json: { type: "EC_CEDULA", number, used: true, correctionMode: "REQUEST", correctionRequest: correction } });
    if (path === "/me/billing-identity/correction-requests/17/acknowledgment") { correction = null; return route.fulfill({ status: 204 }); }
    if (path === "/me") return route.fulfill({ json: profile });
    return route.fulfill({ json: { items: [], page: 0, pageSize: 20, totalCount: "0" } });
  });
}

const fits = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);
async function accessible(page: Page) {
  const result = await new AxeBuilder({ page }).include("main").withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"]).analyze();
  expect(result.violations.map(({ id, nodes }) => ({ id, nodes: nodes.map(({ target }) => target) }))).toEqual([]);
}

for (const width of [320, 1280]) {
  test(`a rejection reads as its own outcome, then opens a fresh request only on demand at ${width}px`, async ({ page }, testInfo) => {
    await stub(page, rejected, "1751550664");
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/account/identity");
    const sheet = page.locator("section").filter({ has: page.getByRole("heading", { name: "Revisamos tu solicitud" }) });
    await expect(sheet.getByText("No aplicada")).toBeVisible();
    await expect(sheet.getByText("No pudimos verificarlo.")).toBeVisible();
    await expect(page.getByRole("heading", { name: "Corregir identificación" })).toHaveCount(0);
    expect(await fits(page)).toBe(true);
    await accessible(page);
    await page.screenshot({ path: testInfo.outputPath(`identity-rejected-${width}.png`), fullPage: true });
    await page.getByRole("button", { name: "Enviar otra solicitud" }).click();
    await expect(page.getByRole("heading", { name: "Corregir identificación" })).toBeFocused();
    await expect(page.getByRole("heading", { name: "Revisamos tu solicitud" })).toHaveCount(0);
    await page.screenshot({ path: testInfo.outputPath(`identity-after-another-${width}.png`), fullPage: true });
  });

  test(`an approval reads as applied and closes with Entendido at ${width}px, also at 200% text`, async ({ page }, testInfo) => {
    await stub(page, approved, "1751550656");
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/account/identity");
    await expect(page.getByText("Corrección aplicada")).toBeVisible();
    await expect(page.getByRole("button", { name: "Enviar otra solicitud" })).toHaveCount(0);
    await accessible(page);
    await page.screenshot({ path: testInfo.outputPath(`identity-approved-${width}.png`), fullPage: true });
    await page.evaluate(() => { document.documentElement.style.fontSize = "200%"; });
    expect(await fits(page)).toBe(true);
    await page.getByRole("button", { name: "Entendido" }).click();
    await expect(page).toHaveURL(/\/account$/);
  });
}
