import { expect, test } from "@playwright/test";

const env = (globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env ?? {};
test.skip(!env.PLIEGO_E2E_LIVE, "Set PLIEGO_E2E_LIVE=1 to run against PostgreSQL and the live API.");
const api = (env.PLIEGO_API_BASE_URL || "http://127.0.0.1:18080").replace(/\/$/, "") + "/api/v1";

test("restores CUSTOMER across reload and reopen, then keeps logout through reload", async ({ page, context, request }) => {
  const email = `session-${Date.now()}@example.invalid`;
  const password = "Session-safe-2026";
  const registration = await request.post(`${api}/auth/register`, {
    data: { email, password, firstNames: "Ana", lastNames: "Sesión" },
  });
  expect(registration.status()).toBe(201);

  await page.goto(`/sign-in?from=${encodeURIComponent("/account")}`);
  await page.getByLabel("Correo electrónico").fill(email);
  await page.getByLabel("Contraseña").fill(password);
  await page.getByRole("button", { name: "Iniciar sesión" }).click();
  await expect(page).toHaveURL(/\/account$/);
  await expect(page.getByRole("heading", { level: 1, name: "Mi cuenta" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Menú de cuenta" })).toBeVisible();
  expect(await page.evaluate(() => [localStorage.length, sessionStorage.length])).toEqual([0, 0]);

  await page.reload();
  await expect(page.getByRole("heading", { level: 1, name: "Mi cuenta" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Menú de cuenta" })).toBeVisible();

  const reopened = await context.newPage();
  await reopened.goto("/account");
  await expect(reopened.getByRole("heading", { level: 1, name: "Mi cuenta" })).toBeVisible();
  await reopened.getByRole("button", { name: "Menú de cuenta" }).click();
  await reopened.getByRole("menuitem", { name: "Cerrar sesión" }).click();
  await expect(reopened.getByRole("navigation", { name: "Cuenta y carrito" })
    .getByRole("link", { name: "Iniciar sesión" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Inicia sesión para ver tu cuenta." })).toBeVisible();

  await page.reload();
  await expect(page.getByRole("heading", { name: "Inicia sesión para ver tu cuenta." })).toBeVisible();
  await expect(page.getByRole("button", { name: "Menú de cuenta" })).toHaveCount(0);
});
