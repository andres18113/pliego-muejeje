import { expect, test, type Page } from "@playwright/test";
import { readChevronRotation } from "./shared/chevron";

const env = (globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env ?? {};
test.skip(!env.PLIEGO_E2E_LIVE, "Set PLIEGO_E2E_LIVE=1 to run against PostgreSQL and the live API.");
const api = (env.PLIEGO_API_BASE_URL || "http://127.0.0.1:8080").replace(/\/$/, "") + "/api/v1";

async function expectCountryPopoverFits(
  page: Page,
  name: string,
  expectedSide?: "bottom" | "top",
  reducedMotion = false,
  triggerBefore?: { x: number; y: number; width: number; height: number } | null,
) {
  const trigger = page.getByRole("combobox", { name, exact: true });
  const popup = page.locator(".country-picker-positioner[data-open]");
  await expect(popup).toBeVisible();
  const side = await popup.getAttribute("data-side");
  if (side !== "bottom" && side !== "top") throw new Error(`Unexpected country picker side: ${side}`);
  if (expectedSide) expect(side).toBe(expectedSide);
  await expect(trigger).toHaveAttribute("data-popup-side", side);
  const rotated = await readChevronRotation(trigger.locator(".country-picker-chevron"));
  expect(rotated).toBe(side === "top");
  const motion = await page.locator(".country-picker-popup[data-open]").evaluate((element) => {
    const style = getComputedStyle(element);
    return {
      duration: style.transitionDuration.split(",")[0].trim(),
    };
  });
  const durationMs = motion.duration.endsWith("ms")
    ? Number.parseFloat(motion.duration)
    : Number.parseFloat(motion.duration) * 1000;
  if (reducedMotion) expect(durationMs).toBeLessThanOrEqual(80);
  // The shared dropdown's established transform transition is 120ms.
  else expect(durationMs).toBe(120);
  // The established dropdown translates; geometric placement is checked below.
  const [anchor, panel, viewport] = await Promise.all([
    trigger.boundingBox(), popup.boundingBox(), page.evaluate(() => ({ width: innerWidth, height: innerHeight })),
  ]);
  expect(anchor).not.toBeNull();
  expect(panel).not.toBeNull();
  expect(panel!.x).toBeGreaterThanOrEqual(0);
  expect(panel!.x + panel!.width).toBeLessThanOrEqual(viewport.width + 1);
  expect(panel!.y).toBeGreaterThanOrEqual(0);
  expect(panel!.y + panel!.height).toBeLessThanOrEqual(viewport.height + 1);
  if (side === "bottom") expect(panel!.y).toBeGreaterThanOrEqual(anchor!.y + anchor!.height - 1);
  if (side === "top") expect(panel!.y + panel!.height).toBeLessThanOrEqual(anchor!.y + 1);
  if (triggerBefore) {
    expect(anchor!.x).toBeCloseTo(triggerBefore.x, 1);
    expect(anchor!.y).toBeCloseTo(triggerBefore.y, 1);
    expect(anchor!.width).toBeCloseTo(triggerBefore.width, 1);
    expect(anchor!.height).toBeCloseTo(triggerBefore.height, 1);
  }
  return side;
}

test("customer navigates profile, address book and orders across desktop and mobile", async ({ page, request }) => {
  const email = `account-${Date.now()}@pliego.local`;
  const password = "Lectura-segura-2026";
  expect((await request.post(`${api}/auth/register`, { data: { email, password, firstNames: "Lectora", lastNames: "Cuenta" } })).status()).toBe(201);

  await page.goto("/account");
  await page.getByRole("main").getByRole("link", { name: "Iniciar sesión" }).click();
  await page.getByLabel("Correo electrónico").fill(email);
  await page.getByLabel("Contraseña").fill(password);
  await page.getByRole("button", { name: "Iniciar sesión" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Mi cuenta" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Direcciones" })).toBeVisible();
  const profilePhoneCountry = page.getByRole("combobox", { name: "Prefijo internacional", exact: true });
  await profilePhoneCountry.scrollIntoViewIfNeeded();
  const profilePhoneBefore = await profilePhoneCountry.boundingBox();
  await profilePhoneCountry.click();
  await expectCountryPopoverFits(page, "Prefijo internacional", undefined, false, profilePhoneBefore);
  await page.keyboard.press("Escape");
  await expect(profilePhoneCountry).toBeFocused();
  await page.getByLabel("Nombres").fill("Lectora Ana");
  await page.getByRole("button", { name: "Guardar datos personales" }).click();
  await expect(page.getByText("Guardamos tus datos personales.")).toBeVisible();
  await page.screenshot({ path: "/tmp/pliego-profile-desktop.png", fullPage: true });

  await page.getByRole("link", { name: "Direcciones" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Mis direcciones" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Aún no tienes direcciones guardadas." })).toBeVisible();
  await page.getByRole("button", { name: "Agregar dirección" }).click();
  await expect(page.getByRole("heading", { name: "Nueva dirección" })).toBeFocused();
  await page.getByLabel("Dirección", { exact: true }).fill("Av. Amazonas 100");
  await page.getByLabel("Ciudad").fill("Quito");
  await page.getByLabel("Provincia").fill("Pichincha");
  await page.setViewportSize({ width: 1280, height: 1800 });
  const deliveryCountry = page.getByRole("combobox", { name: "País de entrega", exact: true });
  const desktopCountryBefore = await deliveryCountry.boundingBox();
  await deliveryCountry.click();
  await expectCountryPopoverFits(page, "País de entrega", "bottom", false, desktopCountryBefore);
  await page.getByRole("combobox", { name: "Buscar país de entrega" }).fill("Ecuador");
  await page.screenshot({ path: "/tmp/pliego-address-country-picker.png", fullPage: true });
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("Enter");
  await expect(deliveryCountry).toContainText("Ecuador");
  await page.getByLabel("Teléfono de contacto").fill("0991234567");
  for (const viewport of [
    { width: 1280, height: 900 }, { width: 768, height: 1024 },
    { width: 390, height: 844 }, { width: 320, height: 720 },
  ]) {
    await page.setViewportSize(viewport);
    const bounds = await deliveryCountry.boundingBox();
    expect(bounds).not.toBeNull();
    expect(bounds!.width).toBeLessThanOrEqual(225);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  }
  await page.screenshot({ path: "/tmp/pliego-address-form-320.png", fullPage: true });
  await page.evaluate(() => {
    const trigger = document.getElementById("address-countryCode");
    if (!trigger) return;
    const bounds = trigger.getBoundingClientRect();
    window.scrollTo({ top: window.scrollY + bounds.bottom - window.innerHeight + 24, behavior: "instant" });
  });
  const mobileCountryBefore = await deliveryCountry.boundingBox();
  await deliveryCountry.click();
  await expectCountryPopoverFits(page, "País de entrega", "top", false, mobileCountryBefore);
  await expect(page.getByRole("combobox", { name: "Buscar país de entrega" })).toBeVisible();
  await page.screenshot({ path: "/tmp/pliego-country-picker-320-viewport.png" });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.keyboard.press("Escape");
  await page.emulateMedia({ reducedMotion: "reduce" });
  const mobilePhoneCountry = page.getByRole("combobox", { name: "Prefijo internacional", exact: true });
  await mobilePhoneCountry.scrollIntoViewIfNeeded();
  const mobilePhoneBefore = await mobilePhoneCountry.boundingBox();
  await mobilePhoneCountry.click();
  await expectCountryPopoverFits(page, "Prefijo internacional", undefined, true, mobilePhoneBefore);
  await page.screenshot({ path: "/tmp/pliego-phone-country-picker-320.png" });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.keyboard.press("Escape");
  await expect(mobilePhoneCountry).toBeFocused();
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.getByRole("button", { name: "Guardar dirección" }).click();
  const home = page.locator(".account-address-row").filter({ hasText: "Casa" });
  await expect(home).toContainText("Ecuador");
  await expect(home).toContainText("+593991234567");
  await expect(home).toContainText("Principal");
  await expect(page.getByLabel("Quién recibe")).toHaveCount(0);

  await page.getByRole("button", { name: "Menú de cuenta" }).click();
  await expect(page.getByText("Lectora Ana Cuenta")).toBeVisible();
  await expect(page.getByText(email)).toBeVisible();
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
    await expect(page.getByRole("link", { name: /^Carrito/ })).toBeVisible();
    await expect(page.getByRole("button", { name: "Menú de cuenta" })).toBeVisible();
  }

  await page.getByRole("link", { name: "Mis pedidos" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Mis pedidos" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Direcciones" })).toBeVisible();
  await page.getByRole("link", { name: "Direcciones" }).click();
  await home.getByRole("button", { name: "Eliminar Casa" }).click();
  await expect(page.getByRole("button", { name: "Confirmar eliminación" })).toBeFocused();
  await page.getByRole("button", { name: "Confirmar eliminación" }).click();
  await expect(page.getByRole("heading", { name: "Aún no tienes direcciones guardadas." })).toBeVisible();
});
