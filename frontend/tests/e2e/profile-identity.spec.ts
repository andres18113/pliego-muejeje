import { expect, test, type Page } from "@playwright/test";
import { storefrontNavigationFixture } from "../../src/test/storefrontFixture";

/** Mi perfil keeps the cédula and the password as rows of its one sheet (ADR 0040). */
async function stub(page: Page, initialCedula: string | null) {
  let cedula = initialCedula;
  const writes: { method: string; path: string; body: unknown }[] = [];
  const profile = { customerId: "2", firstNames: "Andrés", lastNames: "Ramírez", email: "lector@example.invalid", phone: "+593999999999", state: "ACTIVE", version: "0", emailVerified: true };
  await page.route("**/api/v1/**", async route => {
    const request = route.request(), path = new URL(request.url()).pathname.replace("/api/v1", "");
    if (path === "/auth/refresh") return route.fulfill({ json: { accessToken: "synthetic-profile-identity", tokenType: "Bearer", expiresInSeconds: 1800, user: { userId: "2", email: profile.email, role: "CUSTOMER" } } });
    if (path === "/storefront/navigation") return route.fulfill({ json: storefrontNavigationFixture });
    if (path === "/me/billing-identity" && request.method() === "GET") return cedula ? route.fulfill({ json: { type: "EC_CEDULA", number: cedula } }) : route.fulfill({ status: 204 });
    if (path.startsWith("/me/billing-identity") || path === "/auth/forgot-password") {
      const body = request.postDataJSON() as { number?: string };
      writes.push({ method: request.method(), path, body });
      if (path.startsWith("/me/billing-identity")) cedula = body.number ?? cedula;
      return path === "/auth/forgot-password" ? route.fulfill({ status: 202, json: { message: "Si la cuenta cumple los requisitos, recibirás un correo." } }) : route.fulfill({ status: 204 });
    }
    if (path === "/me") return route.fulfill({ json: profile });
    return route.fulfill({ json: { items: [], page: 0, pageSize: 20, totalCount: "0" } });
  });
  return writes;
}

for (const width of [320, 768, 1280]) {
  test(`cédula and password live in the profile sheet at ${width}px`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 900 });
    const writes = await stub(page, null);
    await page.goto("/account");
    const sheet = page.locator("ul").filter({ has: page.getByText("Nombres", { exact: true }) });
    await expect(sheet.getByText("Cédula o RUC", { exact: true })).toBeVisible();
    await expect(sheet.getByText("Contraseña", { exact: true })).toBeVisible();
    await expect(page.getByText(/opcional/i)).toHaveCount(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.screenshot({ path: testInfo.outputPath(`profile-${width}.png`), fullPage: true });

    await page.getByRole("button", { name: "Agregar cédula o RUC", exact: true }).click();
    const form = page.getByRole("form", { name: "Agregar cédula o RUC" });
    await form.getByRole("textbox").pressSequentially("1710034065");
    await form.getByRole("button", { name: "Guardar", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "¿Es correcta tu cédula?" });
    await expect(dialog.getByText("1710034065")).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath(`cedula-confirm-${width}.png`) });
    await dialog.getByRole("button", { name: "Guardar cédula" }).click();
    await expect(page.getByRole("status").filter({ hasText: "Guardamos tu cédula." })).toBeVisible();
    await expect(sheet.getByText("1710034065")).toBeVisible();
    await expect(page.getByRole("button", { name: "Corregir cédula o RUC", exact: true })).toBeFocused();

    await page.getByRole("button", { name: "Cambiar contraseña", exact: true }).click();
    await expect(page.getByRole("form", { name: "Cambiar contraseña" })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.screenshot({ path: testInfo.outputPath(`password-open-${width}.png`), fullPage: true });
    await page.getByRole("button", { name: "Enviar enlace", exact: true }).click();
    await expect(page.getByRole("status").filter({ hasText: "Solicitud recibida." })).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath(`password-sent-${width}.png`), fullPage: true });
    expect(writes.map(write => `${write.method} ${write.path}`)).toEqual(["PUT /me/billing-identity", "POST /auth/forgot-password"]);
  });
}

test("a correction asks for the current password and never removes the cédula", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  const writes = await stub(page, "0912345675");
  await page.goto("/account");
  await page.getByRole("button", { name: "Corregir cédula o RUC", exact: true }).click();
  const form = page.getByRole("form", { name: "Corregir cédula o RUC" });
  await form.getByLabel("Cédula o RUC").pressSequentially("1710034065");
  await form.getByLabel("Contraseña actual").fill("synthetic-current-password");
  await form.getByRole("button", { name: "Corregir", exact: true }).click();
  await page.getByRole("dialog", { name: "¿Corregir tu identificación?" }).getByRole("button", { name: "Sí, corregir" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Corregimos tu identificación." })).toBeVisible();
  expect(writes).toEqual([{ method: "POST", path: "/me/billing-identity/correction", body: { type: "EC_CEDULA", currentNumber: "0912345675", number: "1710034065", currentPassword: "synthetic-current-password" } }]);
  await expect(page.getByRole("button", { name: /Quitar/ })).toHaveCount(0);
});

for (const width of [320, 1280]) {
  test(`the cédula/RUC field accepts only digits, at most 13, from keyboard and clipboard at ${width}px`, async ({ page, context }) => {
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    await page.setViewportSize({ width, height: 900 });
    const writes = await stub(page, null);
    await page.goto("/account");
    await page.getByRole("button", { name: "Agregar cédula o RUC", exact: true }).click();
    const input = page.locator("#profile-cedula-input");
    const status = page.locator("#profile-cedula-status");
    await expect(input).toHaveAttribute("maxlength", "13");
    await expect(input).toHaveAttribute("inputmode", "numeric");

    await input.pressSequentially("17900169190019");
    await expect(input).toHaveValue("1790016919001");
    await expect(status).toHaveText("Máximo 13 dígitos: la cédula tiene 10 y el RUC 13.");
    await input.press("Backspace");
    await expect(status).toHaveText("RUC de sociedad: falta 1 dígito.");
    await input.pressSequentially("a- .");
    await expect(input).toHaveValue("179001691900");
    await expect(status).toHaveText("Escribe solo números: sin letras, espacios ni guiones.");
    await expect(input).toHaveAttribute("aria-invalid", "true");

    const paste = async (text: string) => {
      await page.evaluate(value => navigator.clipboard.writeText(value), text);
      await input.press("ControlOrMeta+V");
    };
    await input.fill("");
    await paste(" 179-001.6919 001 ");
    await expect(input).toHaveValue("1790016919001");
    await expect(status).toContainText("RUC de sociedad válido.");
    await input.fill("");
    await paste("17900169190011");
    await expect(input).toHaveValue("");
    await expect(status).toHaveText("Máximo 13 dígitos: la cédula tiene 10 y el RUC 13.");
    await paste("+593 991234567");
    await expect(input).toHaveValue("");
    await expect(status).toHaveText("Escribe solo números: sin letras, espacios ni guiones.");
    await input.pressSequentially("1710034065");
    await paste("0010");
    await expect(input).toHaveValue("1710034065");
    await expect(status).toHaveText("Máximo 13 dígitos: la cédula tiene 10 y el RUC 13.");
    await input.press("End");
    await input.pressSequentially("001");
    await expect(status).toContainText("RUC de persona natural válido.");
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    expect(writes).toHaveLength(0);
  });
}
