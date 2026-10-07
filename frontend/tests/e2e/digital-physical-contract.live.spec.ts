import { test, expect } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { verifyRegisteredEmail } from "./shared/verified-registration";

test.skip(!process.env.PLIEGO_E2E_LIVE, "Requires the disposable PostgreSQL/backend live-browser gate.");

test.use({ trace: "off" });

type Sample = { editionId: string; title: string; format: string; available: boolean };
async function sample(page: import("@playwright/test").Page, format: string): Promise<Sample> {
  const response = await page.request.get(`/api/v1/catalog/editions?format=${format}&page=0&pageSize=50`);
  expect(response.ok()).toBeTruthy();
  const body = await response.json();
  const found = body.items.find((item: Sample) => item.available);
  expect(found).toBeTruthy();
  return found;
}

test("live Home, navigation, physical/digital catalog, detail, search and offers", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1, name: "Descubre el mundo de PLIEGO." })).toBeVisible();
  const header = page.getByTestId("site-header").getByRole("navigation", { name: "Navegación principal" });
  for (const name of ["Libros", "eBooks", "Audiolibros", "Ofertas", "Ayuda"]) {
    // Categories make a section a disclosure; a section without a panel is a link.
    await expect(header.getByRole("button", { name, exact: true }).or(header.getByRole("link", { name, exact: true }))).toBeVisible();
  }
  for (const format of ["PAPERBACK", "HARDCOVER", "EBOOK", "AUDIOBOOK"]) {
    const edition = await sample(page, format);
    await page.goto(`/catalog?format=${format}`);
    await expect(page.locator(`a[href^="/catalog/editions/${edition.editionId}"]`).first()).toBeVisible();
    await expect(page.getByText("Recibimos una respuesta incompleta", { exact: false })).toHaveCount(0);
    await page.goto(`/catalog?format=${format}&que=${encodeURIComponent(edition.title)}`);
    await page.locator(`a[href^="/catalog/editions/${edition.editionId}"]`).first().click();
    await expect(page.getByRole("heading", { name: edition.title, exact: true })).toBeVisible();
    const detail = await (await page.request.get(`/api/v1/catalog/editions/${edition.editionId}`)).json();
    if (detail.format === "EBOOK" && detail.ebookFileFormat) await expect(page.getByRole("region", { name: "Datos de la edición" })).toContainText(detail.ebookFileFormat);
    if (detail.format === "AUDIOBOOK") {
      const facts = page.getByRole("region", { name: "Datos de la edición" });
      await expect(facts.locator("dt").filter({ hasText: /^Formato$/ }).locator("..").locator("dd")).toContainText(/Audiolibro.*\d/);
      await expect(facts).toContainText(detail.narrators.join(", "));
    }
    await expect(page.getByRole("button", { name: /descargar|reproducir|escuchar/i })).toHaveCount(0);
    await expect(page.getByText("Recibimos una respuesta incompleta", { exact: false })).toHaveCount(0);
  }
  // The Home's popular row shows every medium the projection features, each with its own label.
  await page.goto("/");
  const popular = page.locator('section[aria-labelledby="popular-heading"]');
  for (const medium of ["PHYSICAL", "EBOOK", "AUDIOBOOK"]) await expect(popular.locator(`[data-media="${medium}"]`).first()).toBeAttached();
  const offersResponse = await page.request.get("/api/v1/catalog/offers?page=0&pageSize=5");
  expect(offersResponse.ok()).toBeTruthy();
  const offers = await offersResponse.json();
  await header.getByRole("link", { name: "Ofertas" }).click();
  await expect(page.getByRole("heading", { name: "Descubre las últimas ofertas.", exact: true })).toBeVisible();
  if (offers.items.length) await expect(page.locator(`a[href^="/catalog/editions/${offers.items[0].editionId}"]`).first()).toBeVisible();
  else await expect(page.getByText("No hay ofertas disponibles por ahora.")).toBeVisible();
});

test("live physical and digital purchase controls keep cart quantities and clean the fixture", async ({ page }) => {
  const email = `digital-browser-${randomUUID()}@example.invalid`;
  const password = `Fixture-${randomUUID()}`;
  const registration = await page.request.post("/api/v1/auth/register", {
    data: { email, password, firstNames: "Cliente", lastNames: "Prueba" },
  });
  expect(registration.status()).toBe(201);
  verifyRegisteredEmail(email, process.env.PLIEGO_API_BASE_URL ?? "http://127.0.0.1:18080");
  const login = await page.request.post("/api/v1/auth/login", { data: { email, password } });
  expect(login.ok()).toBeTruthy();
  const token = (await login.json()).accessToken;
  const headers = { Authorization: `Bearer ${token}` };
  const initial = await page.request.get("/api/v1/cart", { headers });
  expect((await initial.json()).items).toEqual([]);
  expect((await (await page.request.get("/api/v1/me/favorites", { headers })).json()).items).toEqual([]);
  const touchedFavorites: string[] = [];
  try {
    for (const format of ["PAPERBACK", "EBOOK", "AUDIOBOOK"]) {
      const edition = await sample(page, format);
      await page.goto(`/catalog/editions/${edition.editionId}`);
      touchedFavorites.push(edition.editionId);
      await page.getByRole("button", { name: `Agregar a favoritos: ${edition.title}`, exact: true }).click();
      await expect(page.getByRole("button", { name: `Quitar de favoritos: ${edition.title}`, exact: true })).toHaveAttribute("aria-pressed", "true");
      await page.goto("/favorites");
      const favorite = page.locator(`[data-favorite-row][data-edition-id="${edition.editionId}"]`);
      await expect(favorite).toBeVisible();
      if (format !== "PAPERBACK") await expect(favorite).toContainText(format === "EBOOK" ? "Ebook" : "Audiolibro");
      await page.request.delete(`/api/v1/me/favorites/${edition.editionId}`, { headers });
      await page.goto(`/catalog/editions/${edition.editionId}`);
      await page.getByRole("button", { name: "Agregar al carrito", exact: true }).click();
      await expect(page.getByRole("link", { name: "Ver el carrito", exact: true })).toBeVisible();
      if (format !== "PAPERBACK") {
        await page.getByRole("button", { name: "Agregar al carrito", exact: true }).click();
        await expect(page.getByText("Esta edición digital ya está en tu carrito.")).toBeAttached();
      }
      await page.getByRole("link", { name: "Ver el carrito", exact: true }).click();
      await expect(page.getByRole("link", { name: edition.title, exact: true }).first()).toBeVisible();
      if (format === "PAPERBACK") await expect(page.getByRole("combobox", { name: `Cantidad de ${edition.title}` })).toBeVisible();
      else {
        await expect(page.getByRole("combobox", { name: `Cantidad de ${edition.title}` })).toHaveCount(0);
        await expect(page.getByText("Cantidad: 1", { exact: true })).toHaveCount(1);
      }
      const response = await page.request.get("/api/v1/cart", { headers });
      const cart = await response.json();
      expect(cart.items).toHaveLength(1); expect(cart.items[0].quantity).toBe(1);
      await page.request.delete(`/api/v1/cart/items/${cart.items[0].cartItemId}`, { headers });
    }
  } finally {
    const response = await page.request.get("/api/v1/cart", { headers });
    for (const line of (await response.json()).items) await page.request.delete(`/api/v1/cart/items/${line.cartItemId}`, { headers });
    for (const editionId of touchedFavorites) await page.request.delete(`/api/v1/me/favorites/${editionId}`, { headers });
  }
});
