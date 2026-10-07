import { expect, test } from "@playwright/test";

const testFrontendOrigin = process.env.PLIEGO_E2E_BASE_URL || "http://127.0.0.1:5173";
/** Every missing page shares one scene and one recovery: "Ir al inicio". No catalog-centric fallback, no legacy green. */
const LEGACY_GREENS = ["rgb(36, 81, 63)", "rgb(32, 61, 50)"];

test("missing pages share PLIEGO's 404 scene and lead home", async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("mantine-color-scheme-value", "light"));
  await page.route("**/api/v1/**", (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === "/api/v1/auth/refresh") return route.fulfill({ json: { accessToken: "t", tokenType: "Bearer", expiresInSeconds: 1800, user: { userId: "100", email: "ana@example.com", role: "CUSTOMER" } } });
    if (path === "/api/v1/me") return route.fulfill({ json: { customerId: "100", email: "ana@example.com", firstNames: "Ana", lastNames: "Pérez", phone: null, state: "ACTIVE", version: "0" } });
    if (path === "/api/v1/cart") return route.fulfill({ json: { cartId: null, state: null, totalCurrent: "0.00", items: [] } });
    if (path.startsWith("/api/v1/help/articles/")) return route.fulfill({ status: 404, json: { code: "P4040", title: "No encontrado", detail: "Artículo no disponible." } });
    return route.fulfill({ json: { items: [], page: 0, pageSize: 20, totalCount: "0" } });
  });
  await page.setViewportSize({ width: 1280, height: 800 });
  for (const route of ["/no-existe", "/ayuda/cuenta-y-correo/233", "/ayuda/no-publicado"]) {
    await page.goto(route);
    const scene = page.locator("[data-not-found-scene]");
    await expect(scene.getByRole("heading", { level: 1, name: "No encontramos esta página." })).toBeVisible();
    await expect(scene).toContainText("Puede que el enlace haya cambiado o que la página ya no esté disponible.");
    await expect(scene.getByText("404", { exact: true })).toHaveAttribute("aria-hidden", "true");
    const home = scene.getByRole("link", { name: "Ir al inicio" });
    await expect(home).toHaveAttribute("href", "/");
    await expect(home).toHaveCSS("background-color", "rgb(40, 61, 168)");
    await expect(page.getByRole("link", { name: "Ir al catálogo" })).toHaveCount(0);
    const painted = await page.evaluate(() => [...document.querySelectorAll<HTMLElement>("body *")].flatMap((el) => { const s = getComputedStyle(el); return [s.color, s.backgroundColor]; }));
    for (const green of LEGACY_GREENS) expect(painted, `${route} ${green}`).not.toContain(green);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  }
  await page.locator("[data-not-found-scene]").getByRole("link", { name: "Ir al inicio" }).focus();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(`${testFrontendOrigin}/`);
});
