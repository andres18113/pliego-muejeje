import { expect, test, type Page } from "@playwright/test";
import { storefrontNavigationFixture } from "../../src/test/storefrontFixture";

async function formApi(page: Page, authenticated: boolean) {
  const writes: unknown[] = [];
  await page.route("**/api/v1/**", route => {
    const request = route.request(), path = new URL(request.url()).pathname.replace(/^.*\/api\/v1/, "");
    const json = (body: unknown) => route.fulfill({ json: body });
    if (request.method() !== "GET" && path !== "/auth/refresh") writes.push({ path, body: request.postDataJSON() });
    if (path === "/auth/refresh") return authenticated ? json({ accessToken: "test-token", tokenType: "Bearer", expiresInSeconds: 1800,
      user: { userId: "87", email: "lectora@example.invalid", role: "CUSTOMER" } }) : route.fulfill({ status: 204 });
    if (path === "/storefront/navigation") return json(storefrontNavigationFixture);
    if (path === "/me") return json({ customerId: "87", email: "lectora@example.invalid", firstNames: "Ana", lastNames: "Pérez", phone: null,
      state: "ACTIVE", version: "0", emailVerified: true });
    if (path === "/me/addresses") return json([]);
    if (path === "/reference/countries") return json([{ code: "EC", name: "Ecuador" }, { code: "CO", name: "Colombia" }]);
    if (path === "/cart") return json({ cartId: "7", state: "ACTIVE", requiresPhysicalFulfillment: false, physicalItemCount: 0, digitalItemCount: 0, items: [], totalCurrent: "0.00" });
    return route.fulfill({ status: 404, json: {} });
  });
  return writes;
}

for (const width of [320, 390, 768, 1280]) {
  test(`Registration live Ecuador validation and input bounds at ${width}px`, async ({ page }) => {
    const writes = await formApi(page, false);
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/register");
    const names = page.getByLabel("Nombres", { exact: true });
    await names.pressSequentially("Ana7");
    await expect(names).toHaveValue("Ana");
    await expect(names).toHaveAttribute("aria-invalid", "true");
    await expect(page.locator("#register-first-names-error")).toContainText(/letras|números/);
    await names.pressSequentially(" María");
    await expect(names).toHaveValue("Ana María");
    await expect(names).not.toHaveAttribute("aria-invalid", "true");
    await page.getByRole("button", { name: "Añadir teléfono (opcional)" }).click();
    const phone = page.getByLabel("Teléfono (opcional)", { exact: true });
    await expect(phone).toBeEnabled();
    await phone.click();
    await phone.pressSequentially("99");
    await expect(phone).toHaveAttribute("aria-invalid", "true");
    await expect(page.locator("#register-phone-error")).toContainText(/9 dígitos/);
    await phone.pressSequentially("12345678");
    await expect(phone).toHaveValue("991234567");
    await expect(phone).toHaveAttribute("maxlength", "9");
    await expect(page.locator("#register-phone-input-status")).toContainText(/9 dígitos/);
    await expect(page.getByRole("combobox", { name: /país|prefijo/i })).toHaveCount(0);
    expect(writes).toHaveLength(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
    await page.screenshot({ path: test.info().outputPath(`register-ecuador-${width}.png`), fullPage: true, animations: "disabled" });
  });

  test(`Profile live name and Ecuador phone recovery at ${width}px`, async ({ page }) => {
    const writes = await formApi(page, true);
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/account");
    await page.getByRole("button", { name: "Editar nombres" }).click();
    const names = page.getByLabel("Nombres", { exact: true });
    await names.fill(""); await names.pressSequentially("Ana1");
    await expect(names).toHaveValue("Ana");
    await expect(names).toHaveAttribute("aria-invalid", "true");
    await page.getByRole("button", { name: "Cancelar", exact: true }).click();
    await page.getByRole("button", { name: "Agregar teléfono" }).click();
    const phone = page.getByLabel("Teléfono", { exact: true });
    await expect(phone).toBeEnabled();
    await phone.click();
    await phone.pressSequentially("99");
    await expect(phone).toHaveAttribute("aria-invalid", "true");
    await expect(page.locator("#profile-phone-error")).toContainText(/9 dígitos/);
    await phone.pressSequentially("1234567");
    await expect(phone).toHaveValue("991234567");
    await expect(phone).not.toHaveAttribute("aria-invalid", "true");
    expect(writes).toHaveLength(0);
    await page.screenshot({ path: test.info().outputPath(`profile-ecuador-${width}.png`), fullPage: true, animations: "disabled" });
  });

  test(`Delivery remains Ecuador with its flag and local phone feedback at ${width}px`, async ({ page }) => {
    const writes = await formApi(page, true);
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/account/addresses");
    await page.getByRole("button", { name: "Agregar dirección" }).click();
    const dialog = page.getByRole("dialog", { name: "Nueva dirección" });
    await expect(dialog).toBeVisible();
    const country = dialog.getByLabel("País de entrega", { exact: true });
    await expect(country).toHaveValue("Ecuador");
    await expect(country).toHaveAttribute("readonly", "");
    await expect(dialog.locator(".delivery-country-trigger img")).toHaveAttribute("src", /EC(?:[-.]|\.svg)/);
    await expect(dialog.getByRole("combobox", { name: "País de entrega" })).toHaveCount(0);
    const street = dialog.getByLabel("Dirección", { exact: true });
    await street.fill("Calle 10 y Avenida 6");
    await expect(street).toHaveValue("Calle 10 y Avenida 6");
    const phone = dialog.getByLabel("Teléfono de contacto", { exact: true });
    await expect(phone).toBeEnabled();
    await phone.click();
    await phone.pressSequentially("99");
    await expect(dialog.locator("#address-phone-error")).toContainText(/9 dígitos/);
    await phone.pressSequentially("123456789");
    await expect(phone).toHaveValue("991234567");
    await expect(dialog.locator("#address-phone-input-status")).toContainText(/9 dígitos/);
    expect(writes).toHaveLength(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
    await page.screenshot({ path: test.info().outputPath(`delivery-ecuador-${width}.png`), fullPage: true, animations: "disabled" });
  });
}

for (const [label, letter] of [["Hangul", "각"], ["Greek", "ᾂ"]] as const) {
  test(`Name clipboard preserves ${label} NFD at 120 NFC code points and rejects 121 atomically`, async ({ page }) => {
    const writes = await formApi(page, false);
    await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
    await page.goto("/register");
    const names = page.getByLabel("Nombres", { exact: true });
    const accepted = letter.normalize("NFD").repeat(120);
    const oversized = letter.normalize("NFD").repeat(121);
    expect([...accepted.normalize("NFC")]).toHaveLength(120);
    expect([...oversized.normalize("NFC")]).toHaveLength(121);
    // Use Chromium's native clipboard insertion, which applies native maxlength;
    // synthetic change/paste events alone cannot reproduce silent UTF-16 truncation.
    await names.fill("Ana");
    await page.evaluate(value => navigator.clipboard.writeText(value), accepted);
    await names.press("ControlOrMeta+A"); await names.press("ControlOrMeta+V");
    await expect(names).toHaveValue(accepted);
    expect([...(await names.inputValue()).normalize("NFC")]).toHaveLength(120);
    await expect(names).not.toHaveAttribute("aria-invalid", "true");

    await page.evaluate(value => navigator.clipboard.writeText(value), oversized);
    await names.press("ControlOrMeta+A"); await names.press("ControlOrMeta+V");
    await expect(names).toHaveValue(accepted);
    await expect(names).toHaveAttribute("aria-invalid", "true");
    await expect(page.locator("#register-first-names-error")).toContainText("120");
    expect(writes).toHaveLength(0);
    await page.screenshot({ path: test.info().outputPath(`name-clipboard-${label.toLowerCase()}.png`), fullPage: true, animations: "disabled" });
  });
}
