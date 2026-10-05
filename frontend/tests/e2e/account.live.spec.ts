import { expect, test, type Page } from "@playwright/test";

/** Account pages are reached from the header's account menu. */
async function openAccountSection(page: import("@playwright/test").Page, name: "Perfil" | "Direcciones" | "Favoritos" | "Pedidos") {
  await page.getByRole("button", { name: "Menú de cuenta" }).click();
  await page.getByRole("menuitem", { name, exact: true }).click();
}

const env = (globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env ?? {};
test.skip(!env.PLIEGO_E2E_LIVE, "Set PLIEGO_E2E_LIVE=1 to run against PostgreSQL and the live API.");
const api = (env.PLIEGO_API_BASE_URL || "http://127.0.0.1:8080").replace(/\/$/, "") + "/api/v1";

/** A trigger's box once the page has stopped moving (header compaction, scroll settling). */
async function settledBox(locator: import("@playwright/test").Locator) {
  // The header compacts with a transition shortly after a scroll, and Playwright re-scrolls an element that is
  // still moving when it clicks. Wait until the trigger and the header have held still for several reads.
  const header = locator.page().getByTestId("site-header");
  const read = async () => ({ box: await locator.boundingBox(), header: (await header.boundingBox())?.height ?? 0 });
  let previous = await read();
  let calm = 0;
  for (let attempt = 0; attempt < 40 && calm < 4; attempt += 1) {
    await locator.page().waitForTimeout(60);
    const next = await read();
    const still = previous.box !== null && next.box !== null
      && Math.abs(previous.box.y - next.box.y) < 0.5 && Math.abs(previous.box.x - next.box.x) < 0.5
      && Math.abs(previous.header - next.header) < 0.5;
    calm = still ? calm + 1 : 0;
    previous = next;
  }
  return previous.box;
}

async function expectCountryPopoverFits(
  page: Page,
  name: string,
  expectedSide?: "bottom" | "top",
  _reducedMotion = false,
  triggerBefore?: { x: number; y: number; width: number; height: number } | null,
) {
  const trigger = page.getByRole("combobox", { name, exact: true });
  await expect(trigger).toHaveAttribute("aria-expanded", "true");
  const viewport = await page.evaluate(() => ({ width: innerWidth, height: innerHeight }));
  // Phones choose from a bottom sheet; wider screens from a compact panel anchored to the trigger.
  const isSheet = viewport.width < 600;
  const popup = isSheet ? page.locator(".mantine-Drawer-content") : page.locator(".mantine-Popover-dropdown[data-country-panel]");
  await expect(popup).toBeVisible();
  // The panel is placed (and flipped when needed) as it mounts and eases in; measure once that has finished.
  await popup.evaluate((element) => Promise.allSettled(element.getAnimations().map((animation) => animation.finished)));
  const [anchor, panel] = await Promise.all([trigger.boundingBox(), popup.boundingBox()]);
  expect(anchor).not.toBeNull();
  expect(panel).not.toBeNull();
  expect(panel!.x).toBeGreaterThanOrEqual(0);
  expect(panel!.x + panel!.width).toBeLessThanOrEqual(viewport.width + 1);
  expect(panel!.y).toBeGreaterThanOrEqual(0);
  expect(panel!.y + panel!.height).toBeLessThanOrEqual(viewport.height + 1);
  const side = isSheet ? "sheet" : panel!.y >= anchor!.y + anchor!.height - 1 ? "bottom" : "top";
  if (side === "top") expect(panel!.y + panel!.height).toBeLessThanOrEqual(anchor!.y + 1);
  if (expectedSide && !isSheet) expect(side).toBe(expectedSide);
  if (triggerBefore) {
    // Subpixel rounding may change during popover placement; a whole CSS pixel would be visible.
    for (const dimension of ["x", "y", "width", "height"] as const) {
      expect(Math.abs(anchor![dimension] - triggerBefore[dimension]), `trigger ${dimension} moved: ${triggerBefore[dimension]} -> ${anchor![dimension]}`).toBeLessThanOrEqual(1);
    }
  }
  return side;
}

test("customer navigates profile, address book and orders across desktop and mobile", async ({ page, request }, testInfo) => {
  const email = `account-${Date.now()}@pliego.local`;
  const password = "Lectura-segura-2026";
  expect((await request.post(`${api}/auth/register`, { data: { email, password, firstNames: "Lectora", lastNames: "Cuenta" } })).status()).toBe(201);

  await page.goto("/account");
  await page.evaluate(() => document.fonts.ready);
  await page.getByRole("main").getByRole("link", { name: "Iniciar sesión" }).click();
  await page.getByLabel("Correo electrónico").fill(email);
  await page.getByLabel("Contraseña").fill(password);
  await page.getByRole("button", { name: "Iniciar sesión" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Mi perfil" })).toBeVisible();
  await expect(page.getByRole("navigation", { name: "Secciones de mi cuenta" })).toHaveCount(0);
  await page.getByRole("button", { name: "Agregar teléfono" }).click();
  const profilePhoneCountry = page.getByRole("combobox", { name: "Prefijo internacional", exact: true });
  await profilePhoneCountry.scrollIntoViewIfNeeded();
  const profilePhoneBefore = await settledBox(profilePhoneCountry);
  await profilePhoneCountry.click();
  await expectCountryPopoverFits(page, "Prefijo internacional", undefined, false, profilePhoneBefore);
  await page.keyboard.press("Escape");
  await expect(profilePhoneCountry).toBeFocused();
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
  await page.getByLabel("Ciudad").fill("Quito");
  await page.getByLabel("Provincia").fill("Pichincha");
  await page.setViewportSize({ width: 1280, height: 1800 });
  const deliveryCountry = page.getByRole("combobox", { name: "País de entrega", exact: true });
  const desktopCountryBefore = await settledBox(deliveryCountry);
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
    // Measure the painted layout, not the tick in which the resize was requested.
    await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    const bounds = await deliveryCountry.boundingBox();
    expect(bounds).not.toBeNull();
    // The country field is a form field like its neighbours: it takes its column's width.
    const city = await page.getByLabel("Ciudad").boundingBox();
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
  await page.evaluate(() => {
    const trigger = document.getElementById("address-countryCode");
    if (!trigger) return;
    const bounds = trigger.getBoundingClientRect();
    window.scrollTo({ top: window.scrollY + bounds.bottom - window.innerHeight + 24, behavior: "instant" });
  });
  const mobileCountryBefore = await settledBox(deliveryCountry);
  await deliveryCountry.click();
  await expectCountryPopoverFits(page, "País de entrega", "top", false, mobileCountryBefore);
  await expect(page.getByRole("combobox", { name: "Buscar país de entrega" })).toBeVisible();
  await page.screenshot({ path: "/tmp/pliego-country-picker-320-viewport.png" });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.keyboard.press("Escape");
  await page.emulateMedia({ reducedMotion: "reduce" });
  const mobilePhoneCountry = page.getByRole("combobox", { name: "Prefijo internacional", exact: true });
  await mobilePhoneCountry.scrollIntoViewIfNeeded();
  const mobilePhoneBefore = await settledBox(mobilePhoneCountry);
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
