import { expect, test } from "@playwright/test";

import { mockFavoritesApi } from "./shared/favorites-api";

/** Account pages are reached from the header's account menu. */
async function openAccountSection(page: import("@playwright/test").Page, name: "Perfil" | "Direcciones" | "Favoritos" | "Pedidos") {
  await page.getByRole("button", { name: "Menú de cuenta" }).click();
  await page.getByRole("menuitem", { name, exact: true }).click();
}

test("guests retain the favorite action through sign-in; customers can browse, toggle, and add from a card", async ({ page }) => {
  await mockFavoritesApi(page);
  await page.goto("/catalog");

  await page.evaluate(() => document.fonts.ready);

  const firstCard = page.locator(".edition-item").first();
  const cover = firstCard.locator("[data-bookcard-link]");
  await cover.focus();
  const addFavorite = firstCard.getByRole("button", { name: "Agregar a favoritos: Cien años de soledad" });
  await expect(addFavorite).toBeVisible();
  // Focus follows the card's visual order: link → cart → favorite.
  await page.keyboard.press("Tab");
  await expect(firstCard.locator("[data-bookcard-cart]")).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(addFavorite).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/sign-in\?/);

  await page.getByLabel("Correo electrónico").fill("lectora@example.invalid");
  await page.getByLabel("Contraseña").fill("Lectura-segura-2026");
  await page.getByRole("button", { name: "Iniciar sesión" }).click();
  await expect(page).toHaveURL("http://127.0.0.1:5173/catalog");
  await expect(firstCard.getByRole("button", { name: "Quitar de favoritos: Cien años de soledad" })).toHaveAttribute("aria-pressed", "true");
  await expect(firstCard.locator("[data-bookcard-feedback]")).toContainText("Agregado a favoritos.");

  await firstCard.getByRole("button", { name: "Agregar al carrito: Cien años de soledad" }).click();
  await expect(firstCard.locator("[data-bookcard-feedback]")).toContainText("Agregado al carrito.");

  await openAccountSection(page, "Favoritos");
  await expect(page.getByRole("heading", { level: 1, name: "Favoritos" })).toBeVisible();
  // Favoritos is a reading list of saved rows, not the Catalog grid.
  await expect(page.locator("[data-favorite-row]")).toHaveCount(1);
  const favorite = page.locator("[data-favorite-row]").first();
  await expect(favorite).toContainText("Cien años de soledad");
  await expect(favorite).toContainText("Gabriel García Márquez");
  await expect(favorite).toContainText("$\u00a018,50");
  await expect(favorite).toContainText("Disponible");
  await expect(favorite.locator("[data-bookcard-link]")).toHaveAttribute("href", /\/catalog\/editions\/42\?/);
  // Removing is immediate and never asks; the toast is where it can be taken back.
  await favorite.getByRole("button", { name: "Quitar de favoritos: Cien años de soledad" }).focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("heading", { name: "Aún no guardaste favoritos." })).toBeVisible();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  const toast = page.locator("[data-undo-toast]");
  await expect(toast).toContainText("Quitado de favoritos");
  await page.screenshot({ path: test.info().outputPath("favorite-undo-toast.png") });
  const undo = toast.getByRole("button", { name: "Deshacer" });
  await undo.focus();
  await page.keyboard.press("Enter");
  await expect(page.locator("[data-favorite-row]")).toHaveCount(1);
  await expect(page.getByRole("button", { name: "Quitar de favoritos: Cien años de soledad" })).toBeFocused();
  await expect(toast).toContainText("Restaurado en favoritos");
  await expect(toast.getByRole("button", { name: "Deshacer" })).toHaveCount(0);

  // On a phone with doubled text the toast wraps inside the viewport and its action stays reachable.
  await page.setViewportSize({ width: 320, height: 640 });
  await page.addStyleTag({ content: "html { font-size: 200% !important; }" });
  await page.getByRole("button", { name: "Quitar de favoritos: Cien años de soledad" }).click();
  await expect(toast.getByRole("button", { name: "Deshacer" })).toBeInViewport({ ratio: 1 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: test.info().outputPath("favorite-undo-toast-phone-200.png") });
  await toast.getByRole("button", { name: "Cerrar aviso" }).click();
  await expect(toast).toHaveCount(0);
});

test("touch layouts keep both cover actions visible without hover and without horizontal overflow", async ({ browser }) => {
  const context = await browser.newContext({
    baseURL: "http://127.0.0.1:5173",
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
  });
  const page = await context.newPage();
  await mockFavoritesApi(page);
  await page.goto("/catalog");

  const firstCard = page.locator(".edition-item").first();
  const actions = firstCard.locator("[data-bookcard-actions]");
  await expect(firstCard).toBeVisible();
  await page.evaluate(() => document.fonts.ready);
  await expect(actions).toBeVisible();
  await expect(firstCard.getByRole("button", { name: "Agregar a favoritos: Cien años de soledad" })).toBeVisible();
  await expect(firstCard.getByRole("button", { name: "Agregar al carrito: Cien años de soledad" })).toBeVisible();
  expect(await actions.evaluate((element) => getComputedStyle(element).position)).not.toBe("absolute");
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(390);
  await context.close();
});

test("shows authoritative membership after a failed mutation response", async ({ page }) => {
  await mockFavoritesApi(page);
  await page.route("**/api/v1/me/favorites/42", (route) => route.fulfill({
    status: 503,
    contentType: "application/problem+json",
    body: JSON.stringify({
      type: "urn:pliego:problem:INTERNAL_SERVER_ERROR",
      title: "Servicio no disponible",
      detail: "No pudimos guardar el cambio.",
      status: 503,
      code: "INTERNAL_SERVER_ERROR",
    }),
  }));
  await page.goto("/catalog");
  await page.locator(".edition-item").first()
    .getByRole("button", { name: "Agregar a favoritos: Cien años de soledad" }).click();
  await page.getByLabel("Correo electrónico").fill("lectora@example.invalid");
  await page.getByLabel("Contraseña").fill("Lectura-segura-2026");
  await page.getByRole("button", { name: "Iniciar sesión" }).click();

  const firstCard = page.locator(".edition-item").first();
  const favoriteButton = firstCard.getByRole("button", { name: "Agregar a favoritos: Cien años de soledad" });
  await expect(firstCard.getByRole("alert")).toContainText("El libro no está guardado en tus favoritos. El cambio no se confirmó.");
  await expect(favoriteButton).toHaveAttribute("aria-pressed", "false");
});
