import { expect, test, type Page } from "@playwright/test";

const token = "x".repeat(43);
async function installApi(page: Page) {
  const calls: { path: string; body: unknown }[] = [];
  await page.route("**/api/v1/**", async route => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    if (path === "/api/v1/auth/refresh") return route.fulfill({ status: 204 });
    if (path.startsWith("/api/v1/auth/")) {
      calls.push({ path, body: request.postDataJSON() });
      if (path.endsWith("resend-verification") || path.endsWith("forgot-password")) {
        return route.fulfill({ status: 202, contentType: "application/json", body: JSON.stringify({ message: "Si la cuenta cumple los requisitos, recibirás un correo con los pasos a seguir." }) });
      }
      return route.fulfill({ status: 204 });
    }
    return route.fulfill({ status: 200, contentType: "application/json", body: "[]" });
  });
  return calls;
}

test("verification mail fragment is scrubbed and consumed only after customer confirmation", async ({ page }) => {
  const calls = await installApi(page);
  await page.goto(`/verificar-correo#token=${token}`);
  await expect(page.getByRole("heading", { name: "Verificar correo", exact: true })).toBeVisible();
  await expect(page).toHaveURL(/\/verificar-correo$/);
  expect(calls).toHaveLength(0);
  await page.getByRole("button", { name: "Verificar correo" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Tu correo está verificado" })).toBeVisible();
  expect(calls).toEqual([{ path: "/api/v1/auth/verify-email", body: { token } }]);
});

test("sign-in exposes neutral resend and password recovery flows", async ({ page }) => {
  const calls = await installApi(page);
  await page.goto("/sign-in");
  await page.getByRole("link", { name: "Reenviar verificación", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Reenviar verificación", exact: true })).toBeVisible();
  await page.getByLabel("Correo electrónico").fill("ana@example.com");
  await page.getByRole("button", { name: "Solicitar enlace de verificación" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Si la cuenta cumple los requisitos" })).toBeVisible();
  await page.getByRole("link", { name: "Iniciar sesión", exact: true }).last().click();
  await page.getByRole("link", { name: "¿Olvidaste tu contraseña?" }).click();
  await expect(page.getByRole("heading", { name: "Recuperar contraseña", exact: true })).toBeVisible();
  await page.getByLabel("Correo electrónico").fill("ana@example.com");
  await page.getByRole("button", { name: "Solicitar recuperación" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Si la cuenta cumple los requisitos" })).toBeVisible();
  expect(calls.map(call => call.path)).toEqual(["/api/v1/auth/resend-verification", "/api/v1/auth/forgot-password"]);
});

test("recovery fragment leads to password reset without automatic sign-in", async ({ page }) => {
  const calls = await installApi(page);
  await page.goto(`/restablecer-contrasena#token=${token}`);
  await page.getByLabel("Nueva contraseña").fill("lecturaSegura123");
  await page.getByLabel("Confirma tu contraseña").fill("lecturaSegura123");
  await page.getByRole("button", { name: "Restablecer contraseña" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Tu contraseña cambió" })).toBeVisible();
  expect(calls).toEqual([{ path: "/api/v1/auth/reset-password", body: { token, password: "lecturaSegura123" } }]);
});
