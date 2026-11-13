import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";
import { verifyRegisteredEmail } from "./shared/verified-registration";

/**
 * Favorites against the real stack: adding a digital copy opens "Tu carrito"; once it closes, the row keeps
 * "Ya está en el carrito" and its cart action has become "Ver carrito ›" in place — focused, persistent across a
 * reload, and leading to the cart. The server's cart and digital-copy rules are untouched.
 */
const env = (globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env ?? {};
test.skip(!env.PLIEGO_E2E_LIVE, "Set PLIEGO_E2E_LIVE=1 to run against PostgreSQL and the live API.");
const api = (env.PLIEGO_API_BASE_URL || "http://127.0.0.1:8080").replace(/\/$/, "") + "/api/v1";
const fixtureScript = fileURLToPath(new URL("../../../backend/src/test/postgres18/realtime_live_fixture.py", import.meta.url));

test("a digital favorite added to the cart keeps a way back to it", async ({ page, request }) => {
  const { editionId, title } = JSON.parse(execFileSync("python3", [fixtureScript, "digital-edition"],
    { env: { ...process.env, CHECKOUT_BASE_URL: api.replace(/\/api\/v1$/, "") }, stdio: ["ignore", "pipe", "pipe"] }).toString()) as { editionId: string; title: string };
  const email = `favorites-cart-${Date.now()}@pliego.local`;
  const password = "Lectura-segura-2026";
  expect((await request.post(`${api}/auth/register`, { data: { email, password, firstNames: "Lectora", lastNames: "Favorita" } })).status()).toBe(201);
  verifyRegisteredEmail(email, api);
  const login = await request.post(`${api}/auth/login`, { data: { email, password } });
  const { accessToken } = await login.json() as { accessToken: string };
  expect((await request.put(`${api}/me/favorites/${editionId}`, { headers: { Authorization: `Bearer ${accessToken}` } })).ok()).toBe(true);

  await page.goto("/sign-in?from=%2Ffavorites");
  await page.getByLabel("Correo electrónico").fill(email);
  await page.getByLabel("Contraseña", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Iniciar sesión", exact: true }).click();
  const row = page.locator(`[data-favorite-row][data-edition-id="${editionId}"]`);
  const add = row.getByRole("button", { name: `Agregar al carrito: ${title}` });
  await add.focus();
  await page.keyboard.press("Enter");
  const drawer = page.getByRole("dialog", { name: "Tu carrito" });
  await expect(drawer).toBeVisible();
  await expect(drawer).toContainText(title);
  await page.keyboard.press("Escape");
  await expect(drawer).toHaveCount(0);

  const shortcut = row.getByRole("button", { name: `Ver carrito: ${title}` });
  await expect(row.getByText("Ya está en el carrito", { exact: true })).toBeVisible();
  await expect(shortcut).toBeFocused();
  await expect(row.getByRole("button", { name: /Agregar al carrito/ })).toHaveCount(0);

  // Persistent: after a reload the state comes from the server's cart, with the same shortcut.
  await page.reload();
  await expect(row.getByText("Ya está en el carrito", { exact: true })).toBeVisible();
  await row.getByRole("button", { name: `Ver carrito: ${title}` }).click();
  await expect(page).toHaveURL(/\/cart$/);
  await expect(page.getByRole("main")).toContainText(title);
});
