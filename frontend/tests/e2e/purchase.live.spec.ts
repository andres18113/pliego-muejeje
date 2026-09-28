import { expect, test } from "@playwright/test";

// Opt-in: runs against the real backend and the seeded development catalog
// (scripts/seed-development-catalog.py). It creates a customer and real orders.
//   PLIEGO_E2E_LIVE=1 npx playwright test purchase.live
const env = (globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env ?? {};
test.skip(!env.PLIEGO_E2E_LIVE, "Set PLIEGO_E2E_LIVE=1 to run against the live development backend.");

const api = (env.PLIEGO_API_BASE_URL || "http://127.0.0.1:8080").replace(/\/$/, "") + "/api/v1";

test("a new CUSTOMER buys a seeded edition end to end against the live API", async ({ page, request }) => {
  const email = `e2e-${Date.now()}@pliego.local`;
  const password = "Lectura-segura-2026";
  const registered = await request.post(`${api}/auth/register`, {
    data: { email, password, firstNames: "Lectora", lastNames: "E2E" },
  });
  expect(registered.status()).toBe(201);
  const catalog = await (await request.get(`${api}/catalog/editions?pageSize=50`)).json();
  const edition = catalog.items.find((item: { available: boolean }) => item.available);
  test.skip(!edition, "The seeded catalog has no available edition.");

  await page.goto(`/catalog/editions/${edition.editionId}`);
  await page.getByRole("link", { name: "Iniciar sesión para agregar" }).click();
  await page.getByLabel("Correo electrónico").fill(email);
  await page.getByLabel("Contraseña").fill(password);
  await page.getByRole("button", { name: "Iniciar sesión" }).click();
  await page.getByRole("button", { name: "Menú de cuenta" }).click();
  await page.getByRole("menuitem", { name: "Mis pedidos" }).click();
  await expect(page.getByRole("heading", { name: "Aún no tienes pedidos." })).toBeVisible();
  await page.goBack();
  await page.getByRole("button", { name: "Agregar al carrito" }).click();
  await page.getByRole("link", { name: "Ver el carrito" }).click();
  await expect(page.getByRole("link", { name: edition.title })).toBeVisible();

  await page.getByRole("link", { name: "Continuar con la compra" }).click();
  await page.getByLabel("Dirección", { exact: true }).fill("Av. Amazonas 100");
  await page.getByLabel("Ciudad").fill("Quito");
  await page.getByLabel("Provincia").fill("Pichincha");
  await page.getByLabel("Teléfono de contacto").fill("0991234567");
  await page.getByRole("button", { name: "Guardar dirección" }).click();
  await expect(page.locator(".checkout-selected-address")).toContainText("Casa");
  await page.locator(".payment-method-option").filter({ hasText: "Tarjeta" }).click();
  await page.getByLabel("Número de tarjeta").fill("4111111111111111");
  await page.getByLabel("Vencimiento (MM/AA)").fill("12/30");
  await page.getByLabel("CVV").fill("123");
  await page.getByLabel("Nombre en la tarjeta").fill("Lectora E2E");
  await expect(page.getByText("Pago aprobado")).toHaveCount(0);
  for (const viewport of [
    { name: "desktop", width: 1280, height: 900 }, { name: "tablet", width: 768, height: 1024 },
    { name: "mobile", width: 390, height: 844 }, { name: "small-mobile", width: 320, height: 720 },
  ]) {
    await page.setViewportSize(viewport);
    await page.screenshot({ path: `/tmp/pliego-checkout-${viewport.name}.png`, fullPage: true });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  }
  await page.getByRole("button", { name: /Pagar/ }).click();

  await expect(page.getByRole("heading", { level: 1, name: /^Pedido n\.º \d+ confirmado$/ })).toBeVisible();
  await expect(page.getByText(/^SIM-/)).toBeVisible();
  const orderId = /\/orders\/(\d+)$/.exec(page.url())?.[1];
  expect(orderId).toBeTruthy();
  await page.getByRole("link", { name: "Ver mis pedidos" }).click();
  await expect(page.getByRole("link", { name: new RegExp(`Pedido n.º ${orderId}`) })).toBeVisible();
  await page.screenshot({ path: "/tmp/pliego-s06-desktop.png", fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: "/tmp/pliego-s06-mobile-history.png", fullPage: true });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.getByRole("link", { name: new RegExp(`Pedido n.º ${orderId}`) }).click();
  await expect(page.getByRole("heading", { name: "Historial del pedido" })).toBeVisible();
  await expect(page.getByRole("heading", { name: new RegExp(`Pedido n.º ${orderId}`) })).toBeVisible();
  await page.screenshot({ path: "/tmp/pliego-s06-mobile.png", fullPage: true });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.setViewportSize({ width: 320, height: 720 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.getByRole("button", { name: "Cancelar pedido" }).click();
  await page.getByRole("button", { name: "Confirmar cancelación" }).click();
  await expect(page.getByText("Este pedido ya está cancelado.")).toBeVisible();
  await expect(page.getByText(/El pago fue reembolsado/i)).toBeVisible();
});

test("transfer checkout reads configured bank data and shows the generated reference", async ({ page, request }) => {
  const email = `transfer-${Date.now()}@pliego.local`;
  const password = "Lectura-segura-2026";
  expect((await request.post(`${api}/auth/register`, { data: { email, password, firstNames: "Lectora", lastNames: "Transferencia" } })).status()).toBe(201);
  const catalog = await (await request.get(`${api}/catalog/editions?pageSize=50`)).json();
  const edition = catalog.items.find((item: { available: boolean }) => item.available);
  test.skip(!edition, "The seeded catalog has no available edition.");

  await page.goto(`/catalog/editions/${edition.editionId}`);
  await page.getByRole("link", { name: "Iniciar sesión para agregar" }).click();
  await page.getByLabel("Correo electrónico").fill(email);
  await page.getByLabel("Contraseña").fill(password);
  await page.getByRole("button", { name: "Iniciar sesión" }).click();
  await page.getByRole("button", { name: "Agregar al carrito" }).click();
  await page.getByRole("link", { name: "Ver el carrito" }).click();
  await page.getByRole("link", { name: "Continuar con la compra" }).click();
  await page.getByLabel("Dirección", { exact: true }).fill("Calle Lectura 12");
  await page.getByLabel("Ciudad").fill("Quito");
  await page.getByLabel("Provincia").fill("Pichincha");
  await page.getByLabel("Teléfono de contacto").fill("0991234567");
  await page.getByRole("button", { name: "Guardar dirección" }).click();
  await page.locator(".payment-method-option").filter({ hasText: "Transferencia" }).click();
  const configured = await (await request.get(`${api}/reference/transfer-details`)).json();
  await expect(page.locator(".transfer-instructions")).toContainText(configured.bank);
  await expect(page.locator(".transfer-instructions")).toContainText(configured.accountNumber);
  await expect(page.locator(".transfer-instructions")).toContainText(configured.identification);
  await expect(page.getByRole("radio", { name: /Pago aprobado|Pago rechazado/ })).toHaveCount(0);
  await page.setViewportSize({ width: 320, height: 720 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.getByRole("button", { name: /Pagar/ }).click();
  await expect(page.getByRole("heading", { level: 1, name: /^Pedido n\.º \d+ confirmado$/ })).toBeVisible();
  await expect(page.locator(".order-transfer")).toContainText(configured.bank);
  await expect(page.locator(".order-transfer")).toContainText(/SIM-/);
  await expect(page.getByRole("button", { name: "Copiar referencia" })).toBeVisible();
});
