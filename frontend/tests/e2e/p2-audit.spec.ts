import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { mockFavoritesApi } from "./shared/favorites-api";

/** Account pages are reached from the header's account menu. */
async function openAccountSection(page: import("@playwright/test").Page, name: "Perfil" | "Direcciones" | "Favoritos" | "Pedidos") {
  await page.getByRole("button", { name: "Menú de cuenta" }).click();
  await page.getByRole("menuitem", { name, exact: true }).click();
}
async function signIn(page: Page, from = "/favorites") {
  await page.goto(`/sign-in?from=${encodeURIComponent(from)}`);
  await page.getByLabel("Correo electrónico").fill("lectora@example.invalid");
  await page.getByLabel("Contraseña", { exact: true }).fill("Lectura-segura-2026");
  await page.getByRole("button", { name: "Iniciar sesión", exact: true }).click();
  await expect(page).toHaveURL(`http://127.0.0.1:5173${from}`);
}
test("lost successful favorite response reconciles the server result once", async ({ page }) => {
  await mockFavoritesApi(page, ["42"]);
  let deletes = 0, removed = false, reads = 0;
  await page.route("**/api/v1/me/favorites/42", route => { deletes++; removed = true; return route.abort("failed"); });
  await page.route("**/api/v1/me/favorites/status?**", route => {
    reads++; return route.fulfill({ json: new URL(route.request().url()).searchParams.getAll("editionIds").map(editionId => ({ editionId, favorite: editionId === "42" && !removed })) });
  });
  await signIn(page, "/catalog");
  const favorite = page.locator(".edition-item").first().locator("[data-bookcard-favorite]");
  await favorite.focus(); await page.keyboard.press("Enter");
  await expect(favorite).toHaveAttribute("aria-pressed", "false");
  await expect(page.locator(".edition-item").first().getByRole("status")).toContainText("Quitado de favoritos.");
  expect(deletes).toBe(1); expect(reads).toBeGreaterThan(1);
});
test("keyboard removal moves focus to a surviving row then the empty heading", async ({ page }) => {
  await mockFavoritesApi(page, ["42", "43"]); await signIn(page);
  const rows = page.locator("[data-favorite-row]");
  await rows.first().locator("[data-bookcard-favorite]").focus(); await page.keyboard.press("Enter");
  await expect(rows).toHaveCount(1); await expect(rows.first().locator("[data-bookcard-favorite]")).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("heading", { name: "Aún no guardaste favoritos." })).toBeFocused();
  await page.keyboard.press("Tab"); await expect(page.getByRole("link", { name: "Explorar el catálogo" })).toBeFocused();
});
test("search name includes its visible label", async ({ page }) => {
  await mockFavoritesApi(page); await page.goto("/catalog");
  await expect(page.getByRole("button", { name: /Buscar libros/ })).toBeVisible();
});
test("authentication switch links have a persistent non-color cue", async ({ page }) => {
  await mockFavoritesApi(page);
  for (const path of ["/sign-in", "/register"]) {
    await page.goto(path); const link = page.locator(".auth-switch a");
    await expect(link).toBeVisible();
    expect(await link.evaluate(el => getComputedStyle(el).textDecorationLine)).toContain("underline");
  }
});

test("unknown favorite outcome recovers with a read while preserving keyboard focus", async ({ page }) => {
  await mockFavoritesApi(page, ["42"]);
  let deletes = 0, lost = false, canRead = false;
  await page.route("**/api/v1/me/favorites/42", route => { deletes++; lost = true; return route.abort("failed"); });
  await page.route("**/api/v1/me/favorites/status?**", route => {
    if (lost && !canRead) return route.abort("failed");
    return route.fulfill({ json: new URL(route.request().url()).searchParams.getAll("editionIds").map(editionId => ({ editionId, favorite: editionId === "42" && !lost })) });
  });
  await signIn(page, "/catalog");
  const card = page.locator(".edition-item").first();
  await card.locator("[data-bookcard-favorite]").focus(); await page.keyboard.press("Enter");
  const check = card.getByRole("button", { name: /Consultar favorito/ });
  await expect(check).toBeFocused(); await expect(check).not.toHaveAttribute("aria-pressed");
  canRead = true; await page.keyboard.press("Enter");
  await expect(card.getByRole("button", { name: /Agregar a favoritos/ })).toBeFocused();
  await expect(card.locator("[data-bookcard-favorite]")).toHaveAttribute("aria-pressed", "false");
  expect(deletes).toBe(1);
});

test("authentication preserves Addresses through the sign-in/register switch", async ({ page }) => {
  await mockFavoritesApi(page);
  await page.goto("/account/addresses?view=all#primary");
  await page.getByRole("main").getByRole("link", { name: "Iniciar sesión", exact: true }).click();
  await page.locator(".auth-switch a").click();
  await expect(page).toHaveURL(/\/register\?from=%2Faccount%2Faddresses/);
  await page.locator(".auth-switch a").click();
  await expect(page.getByRole("heading", { level: 1, name: "Iniciar sesión", exact: true })).toBeVisible();
  await page.getByLabel("Correo electrónico").fill("lectora@example.invalid");
  await page.getByLabel("Contraseña", { exact: true }).fill("Lectura-segura-2026");
  await page.getByRole("button", { name: "Iniciar sesión", exact: true }).click();
  await expect(page).toHaveURL("http://127.0.0.1:5173/account/addresses?view=all#primary");
});

for (const adaptation of ["200% text", "200% zoom", "320px reflow"] as const) {
  test(`P2 controls retain keyboard operation and readability at ${adaptation} with reduced motion`, async ({ page }, testInfo) => {
    await mockFavoritesApi(page, ["42"]);
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.setViewportSize({ width: adaptation === "320px reflow" ? 320 : 1280, height: 900 });
    await page.goto("/sign-in");
    async function adapt() {
      if (adaptation === "200% zoom") await page.evaluate(() => { document.documentElement.style.zoom = "2"; });
      if (adaptation === "200% text") await page.evaluate(() => {
        const elements = Array.from(document.querySelectorAll<HTMLElement>(".auth-content, .auth-content *, main section, main section *"));
        const sizes = elements.map(el => parseFloat(getComputedStyle(el).fontSize));
        elements.forEach((el, index) => { if (!el.classList.contains("material-symbol")) el.style.fontSize = `${sizes[index] * 2}px`; });
      });
    }
    await adapt();
    const switchLink = page.locator(".auth-switch a");
    await switchLink.focus(); await page.keyboard.press("Enter");
    await expect(page).toHaveURL(/\/register/); await adapt();
    await page.locator(".auth-switch a").focus(); await page.keyboard.press("Enter");
    await signIn(page, "/favorites"); await adapt();
    await page.locator("[data-bookcard-favorite]").focus(); await page.keyboard.press("Enter");
    await expect(page.getByRole("heading", { name: "Aún no guardaste favoritos." })).toBeFocused();
    await page.keyboard.press("Tab"); await expect(page.getByRole("link", { name: "Explorar el catálogo" })).toBeFocused();
    await page.screenshot({ path: testInfo.outputPath("favorites-adaptation.png"), fullPage: true });
    await openAccountSection(page, "Perfil"); await adapt();
    await page.getByRole("button", { name: "Editar nombres" }).focus(); await page.keyboard.press("Enter");
    await page.getByLabel("Nombres", { exact: true }).fill("Ana María");
    await openAccountSection(page, "Favoritos");
    await openAccountSection(page, "Perfil");
    await expect(page.getByLabel("Nombres", { exact: true })).toHaveValue("Ana María");
    await page.reload(); await page.getByRole("main").getByRole("link", { name: "Iniciar sesión", exact: true }).click();
    await page.getByLabel("Correo electrónico").fill("lectora@example.invalid");
    await page.getByLabel("Contraseña", { exact: true }).fill("Lectura-segura-2026");
    await page.getByRole("button", { name: "Iniciar sesión", exact: true }).click();
    await expect(page.getByLabel("Nombres", { exact: true })).toHaveValue("Ana María");
    await adapt();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.screenshot({ path: testInfo.outputPath("profile-adaptation.png"), fullPage: true });
  });
}

for (const colorScheme of ["light", "dark"] as const) {
  test(`sign-in and registration switch links are readable in ${colorScheme}`, async ({ page }) => {
    await mockFavoritesApi(page); await page.emulateMedia({ colorScheme, reducedMotion: "reduce" });
    for (const path of ["/sign-in", "/register"]) {
      await page.goto(path);
      const link = page.locator(".auth-switch a");
      await expect(link).toBeVisible();
      const result = await new AxeBuilder({ page }).include(".auth-switch").withRules(["color-contrast"]).analyze();
      expect(result.violations).toEqual([]);
      await link.focus();
      expect(await link.evaluate(el => getComputedStyle(el).outlineStyle)).not.toBe("none");
    }
  });
}
