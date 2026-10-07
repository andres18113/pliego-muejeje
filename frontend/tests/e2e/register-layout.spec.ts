import { expect, test, type Page } from "@playwright/test";

async function guest(page: Page) {
  await page.addInitScript(() => localStorage.setItem("mantine-color-scheme-value", "light"));
  await page.route("**/api/v1/**", (route) => new URL(route.request().url()).pathname === "/api/v1/auth/refresh"
    ? route.fulfill({ status: 204 })
    : route.fulfill({ json: { items: [], page: 0, pageSize: 20, totalCount: "0" } }));
}

for (const [width, height] of [[1280, 720], [1366, 650]]) {
  test(`Crear cuenta shows the form, its action and the sign-in alternative in the first viewport (${width}×${height})`, async ({ page }) => {
    await guest(page);
    await page.setViewportSize({ width, height });
    await page.goto("/register");
    await expect(page.getByRole("heading", { level: 1, name: "Crear cuenta" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Crear cuenta" })).toBeInViewport({ ratio: 1 });
    await expect(page.getByRole("main").getByRole("link", { name: "Iniciar sesión" })).toBeInViewport({ ratio: 1 });
    // Names share a row; controls keep a comfortable height.
    const [first, last] = await Promise.all([page.getByLabel("Nombres").boundingBox(), page.getByLabel("Apellidos").boundingBox()]);
    expect(Math.abs(first!.y - last!.y)).toBeLessThan(2);
    expect(first!.height).toBeGreaterThanOrEqual(44);
    // Nothing is marked wrong before it is touched; a visited field is checked, and corrected as it is typed.
    await expect(page.locator(".field-error")).toHaveCount(0);
    await page.getByLabel("Correo electrónico").focus();
    await page.keyboard.press("Tab");
    await expect(page.locator("#register-email-error")).toBeVisible();
    await expect(page.locator(".field-error")).toHaveCount(1);
    await page.getByLabel("Correo electrónico").fill("ana@example.com");
    await expect(page.locator("#register-email-error")).toHaveCount(0);
  });
}

test("Crear cuenta stacks on a phone without horizontal overflow", async ({ page }) => {
  await guest(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/register");
  const [first, last] = await Promise.all([page.getByLabel("Nombres").boundingBox(), page.getByLabel("Apellidos").boundingBox()]);
  expect(last!.y).toBeGreaterThan(first!.y + first!.height - 1);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

test("the Catalog closes on the storefront footer, not a blue field", async ({ page }) => {
  await guest(page);
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto("/catalog");
  const footer = page.getByRole("contentinfo");
  await expect(footer).toHaveCount(1);
  await expect(footer.getByRole("heading", { name: "Métodos de pago" })).toBeVisible();
  await expect(footer).toContainText("© 2026");
  await expect(footer).not.toHaveCSS("background-color", "rgb(40, 61, 168)");
});
