import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

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
  await expect(page.getByRole("heading", { name: "Tu próxima lectura." })).toBeVisible();
  const header = page.getByTestId("site-header").getByRole("navigation", { name: "Navegación principal" });
  await expect(header.getByRole("link")).toHaveText(["Libros", "eBooks", "Audiolibros", "Ofertas"]);
  for (const format of ["PAPERBACK", "HARDCOVER", "EBOOK", "AUDIOBOOK"]) {
    const edition = await sample(page, format);
    await page.goto(`/catalog?format=${format}`);
    await expect(page.locator(`a[href^="/catalog/editions/${edition.editionId}"]`).first()).toBeVisible();
    await expect(page.getByText("Recibimos una respuesta incompleta", { exact: false })).toHaveCount(0);
    await page.goto(`/catalog?format=${format}&que=${encodeURIComponent(edition.title)}`);
    await page.locator(`a[href^="/catalog/editions/${edition.editionId}"]`).first().click();
    await expect(page.getByRole("heading", { name: edition.title, exact: true })).toBeVisible();
    const detail = await (await page.request.get(`/api/v1/catalog/editions/${edition.editionId}`)).json();
    if (detail.format === "EBOOK" && detail.ebookFileFormat) await expect(page.getByText(detail.ebookFileFormat, { exact: true })).toBeVisible();
    if (detail.format === "AUDIOBOOK") {
      await expect(page.getByText("Duración", { exact: true })).toBeVisible();
      await expect(page.getByText(detail.narrators.join(", "), { exact: true })).toBeVisible();
    }
    await expect(page.getByRole("button", { name: /descargar|reproducir|escuchar/i })).toHaveCount(0);
    await expect(page.getByText("Recibimos una respuesta incompleta", { exact: false })).toHaveCount(0);
  }
  await page.goto("/");
  const reading = page.getByRole("heading", { name: "Tu próxima lectura." }).locator("..");
  await reading.getByRole("button", { name: "eBooks", exact: true }).click();
  await expect(reading.locator("[data-reading-scene]").first()).toBeVisible();
  await reading.getByRole("button", { name: "Audiolibros", exact: true }).click();
  await expect(reading.locator("[data-reading-scene]").first()).toBeVisible();
  const offersResponse = await page.request.get("/api/v1/catalog/offers?page=0&pageSize=5");
  expect(offersResponse.ok()).toBeTruthy();
  const offers = await offersResponse.json();
  await reading.getByRole("button", { name: "Ofertas", exact: true }).click();
  if (offers.items.length) await expect(reading.locator(`a[href^="/catalog/editions/${offers.items[0].editionId}"]`).first()).toBeVisible();
  else await expect(reading.getByText("No hay ofertas disponibles por ahora.")).toBeVisible();
  await header.getByRole("link", { name: "Ofertas" }).click();
  await expect(page.getByRole("heading", { name: "Ofertas", exact: true })).toBeVisible();
  if (offers.items.length) await expect(page.locator(`a[href^="/catalog/editions/${offers.items[0].editionId}"]`).first()).toBeVisible();
  else await expect(page.getByText("No hay ofertas disponibles por ahora.")).toBeVisible();
});

test("live physical and digital purchase controls keep cart quantities and clean the fixture", async ({ page }) => {
  const path = process.env.PLIEGO_CART_GATE_ENV ?? join(homedir(), ".config/pliego/digital-cart-gate.env");
  const values = Object.fromEntries(readFileSync(path, "utf8").split("\n").filter((line) => line.startsWith("export ")).map((line) => {
    const at = line.indexOf("="); return [line.slice(7, at), line.slice(at + 1).replace(/^['"]|['"]$/g, "")];
  }));
  const login = await page.request.post("/api/v1/auth/login", { data: { email: values.PLIEGO_CUSTOMER_EMAIL, password: values.PLIEGO_CUSTOMER_PASSWORD } });
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
        await expect(page.getByText("Cantidad: 1", { exact: true })).toBeVisible();
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
