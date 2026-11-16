import { expect, test } from "@playwright/test";
import { choosePlace } from "./geo-fixtures";
import { verifyRegisteredEmail } from "./shared/verified-registration";

/** Account pages are reached from the header's account menu. */
async function openAccountSection(page: import("@playwright/test").Page, name: "Perfil" | "Direcciones" | "Favoritos" | "Pedidos") {
  await page.getByRole("button", { name: "Menú de cuenta" }).click();
  await page.getByRole("menuitem", { name, exact: true }).click();
}

const env = (globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env ?? {};
test.skip(!env.PLIEGO_E2E_LIVE, "Set PLIEGO_E2E_LIVE=1 to run against PostgreSQL and the live API.");
const api = (env.PLIEGO_API_BASE_URL || "http://127.0.0.1:8080").replace(/\/$/, "") + "/api/v1";

test("customer navigates profile, address book and orders across desktop and mobile", async ({ page, request }, testInfo) => {
  const email = `account-${Date.now()}@pliego.local`;
  const password = "Lectura-segura-2026";
  expect((await request.post(`${api}/auth/register`, { data: { email, password, firstNames: "Lectora", lastNames: "Cuenta" } })).status()).toBe(201);
  verifyRegisteredEmail(email, api);

  await page.goto("/account");
  await page.evaluate(() => document.fonts.ready);
  await page.getByRole("main").getByRole("link", { name: "Iniciar sesión" }).click();
  await page.getByLabel("Correo electrónico").fill(email);
  await page.getByLabel("Contraseña", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Iniciar sesión" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Mi perfil" })).toBeVisible();
  await expect(page.getByRole("navigation", { name: "Secciones de mi cuenta" })).toHaveCount(0);
  await page.getByRole("button", { name: "Agregar teléfono" }).click();
  // Ecuador-only: the prefix is fixed (+593), never a country picker; the field takes the nine national digits.
  await expect(page.getByLabel("Ecuador, prefijo +593")).toBeVisible();
  await expect(page.getByRole("combobox", { name: "Prefijo internacional" })).toHaveCount(0);
  await expect(page.getByRole("textbox", { name: "Teléfono" })).toHaveAttribute("maxlength", "9");
  await page.getByRole("button", { name: "Cancelar", exact: true }).click();
  await page.getByRole("button", { name: "Editar nombres" }).click();
  await page.getByLabel("Nombres", { exact: true }).fill("Lectora Ana");
  await page.getByRole("button", { name: "Guardar", exact: true }).click();
  await expect(page.getByText("Guardamos tus nombres.")).toBeVisible();
  await page.screenshot({ path: "/tmp/pliego-profile-desktop.png", fullPage: true });

  await openAccountSection(page, "Direcciones");
  await expect(page.getByRole("heading", { level: 1, name: "Direcciones" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Aún no tienes direcciones guardadas." })).toBeVisible();
  await page.getByRole("button", { name: "Agregar dirección" }).click();
  await expect(page.locator("#address-form-heading")).toBeFocused();
  await page.getByLabel("Dirección", { exact: true }).fill("Av. Amazonas 100");
  await choosePlace(page, page.locator("body"), "Pichincha", "Quito");
  await page.setViewportSize({ width: 1280, height: 1800 });
  // Deliveries are Ecuador-only: the country is a fixed, read-only fact with its explanation, not a picker.
  const deliveryCountry = page.getByRole("textbox", { name: "País de entrega", exact: true });
  await expect(deliveryCountry).toHaveValue("Ecuador");
  await expect(deliveryCountry).toHaveAttribute("readonly", "");
  await expect(deliveryCountry).toHaveAccessibleDescription("Entregas únicamente en Ecuador.");
  await expect(page.getByRole("combobox", { name: "País de entrega" })).toHaveCount(0);
  await page.getByLabel("Teléfono de contacto").fill("991234567");
  for (const viewport of [
    { width: 1280, height: 900 }, { width: 768, height: 1024 },
    { width: 390, height: 844 }, { width: 320, height: 720 },
  ]) {
    await page.setViewportSize(viewport);
    // Measure the painted layout, not the tick in which the resize was requested.
    await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    const bounds = await page.locator(".delivery-country-trigger").boundingBox();
    expect(bounds).not.toBeNull();
    // The country field is a form field like its neighbours: it takes its column's width.
    // The trigger itself, by its exact role: while a picker closes its search and list share the label.
    const city = await page.getByRole("combobox", { name: "Ciudad", exact: true }).boundingBox();
    expect(Math.abs(bounds!.width - city!.width)).toBeLessThanOrEqual(1);
    const fits = await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);
    if (!fits) {
      await page.screenshot({ path: testInfo.outputPath("address-overflow.png"), fullPage: true });
      const evidence = await page.evaluate(() => ({ width: innerWidth, scrollWidth: document.documentElement.scrollWidth,
        elements: Array.from(document.querySelectorAll<HTMLElement>("body *")).map(el => ({ tag: el.tagName, classes: el.className, right: el.getBoundingClientRect().right, width: el.getBoundingClientRect().width })).filter(el => el.right > innerWidth + 1).slice(0, 12) }));
      await testInfo.attach("address-overflow", { body: JSON.stringify(evidence), contentType: "application/json" });
    }
    expect(fits).toBe(true);
  }
  await page.screenshot({ path: "/tmp/pliego-address-form-320.png", fullPage: true });
  // At 320px the fixed +593 prefix and the national digits stay on one line without widening the page.
  await expect(page.locator(".international-phone").filter({ has: page.getByLabel("Teléfono de contacto") }).getByLabel("Ecuador, prefijo +593")).toBeVisible();
  await expect(page.getByRole("combobox", { name: "Prefijo internacional" })).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.getByRole("button", { name: "Guardar dirección" }).click();
  const home = page.locator(".account-address-row").filter({ hasText: "Casa" });
  await expect(home).toContainText("Ecuador");
  await expect(home).toContainText("+593 99 123 4567");
  await expect(home).toContainText("Principal");
  await expect(page.getByLabel("Quién recibe")).toHaveCount(0);

  await page.getByRole("button", { name: "Menú de cuenta" }).click();
  await expect(page.getByRole("menu").getByText("Lectora Ana Cuenta", { exact: true })).toBeVisible();
  await expect(page.getByRole("menu").getByText(email, { exact: true })).toBeVisible();
  await page.keyboard.press("Escape");

  for (const viewport of [
    { name: "desktop", width: 1280, height: 900 },
    { name: "tablet", width: 768, height: 1024 },
    { name: "mobile", width: 390, height: 844 },
    { name: "small-mobile", width: 320, height: 720 },
  ]) {
    await page.setViewportSize(viewport);
    await page.screenshot({ path: `/tmp/pliego-account-${viewport.name}.png`, fullPage: true });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await expect(page.getByRole("banner").getByRole("link", { name: /^Carrito/ })).toBeVisible();
    await expect(page.getByRole("button", { name: "Menú de cuenta" })).toBeVisible();
  }

  await openAccountSection(page, "Pedidos");
  await expect(page.getByRole("heading", { level: 1, name: "Mis pedidos" })).toBeVisible();
  await openAccountSection(page, "Direcciones");
  await home.getByRole("button", { name: "Eliminar Casa" }).click();
  await expect(page.getByRole("button", { name: "Conservar dirección" })).toBeFocused();
  await page.getByRole("button", { name: "Eliminar dirección" }).click();
  await expect(page.getByRole("heading", { name: "Aún no tienes direcciones guardadas." })).toBeVisible();
});
