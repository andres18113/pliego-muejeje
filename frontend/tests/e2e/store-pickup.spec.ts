import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { pickupLocation, pickupOrder } from "../../src/test/pickup";

async function install(page: Page) {
  const posts: { body: Record<string, unknown>; key: string | undefined }[] = [];
  let locationState: "ok" | "error" | "empty" = "ok";
  await page.route("https://www.openstreetmap.org/**", route => route.fulfill({ contentType: "text/html", body: "<!doctype html><html lang='es'><title>Mapa de prueba</title><body>Mapa</body></html>" }));
  await page.route("**/api/v1/**", async route => {
    const request = route.request(); const path = new URL(request.url()).pathname;
    const json = (body: unknown, status = 200) => route.fulfill({ status, json: body });
    if (path === "/api/v1/auth/refresh") return route.fulfill({ status: 204 });
    if (path === "/api/v1/auth/login") return json({ accessToken: "e2e-token", tokenType: "Bearer", expiresInSeconds: 1800, user: { userId: "100", email: "ana@example.com", role: "CUSTOMER" } });
    if (path === "/api/v1/me") return json({ customerId: "100", email: "ana@example.com", firstNames: "Ana", lastNames: "Pérez", phone: null, state: "ACTIVE", version: "0" });
    if (path === "/api/v1/me/addresses") return json([{ addressId: "15", alias: "Casa", recipient: "Ana Pérez", line1: "Av. Principal 123", line2: null,
      city: "Quito", province: "Pichincha", countryCode: "EC", postalCode: null, reference: null, phone: "+59325550134", primary: true }]);
    if (path === "/api/v1/cart") return json({ cartId: "40", state: "ACTIVE", requiresPhysicalFulfillment: true, physicalItemCount: 1, digitalItemCount: 0, subtotal: "18.50", taxRate: "15.00", taxAmount: "2.78", shippingAmount: "0.00", total: "21.28", totalCurrent: "21.28",
      estimatedDeliveryFrom: "2026-10-05", estimatedDeliveryTo: "2026-10-07", items: [{ cartItemId: "1", editionId: "42", title: "Cien años de soledad", authors: "Gabriel García Márquez", sku: "TEST-42", coverUrl: null,
        requiresPhysicalFulfillment: true, quantityEditable: true, quantity: 1, currentPrice: "18.50", currentSubtotal: "18.50", available: true, unavailabilityReason: null }] });
    if (path === "/api/v1/pickup-locations") return locationState === "error"
      ? json({ code: "READ_FAILURE", title: "Error de consulta", detail: "Vuelve a consultar." }, 503)
      : json(locationState === "empty" ? [] : [pickupLocation, { ...pickupLocation, id: "9", name: "Otro punto de retiro", address: "Otra dirección" }]);
    if (path === "/api/v1/reference/transfer-details") return json({ bank: "Banco Guayaquil", beneficiary: "PLIEGO", accountType: "Ahorros", accountNumber: "2557897233", identification: "1751550656" });
    if (path === "/api/v1/checkout") {
      const body = request.postDataJSON(); posts.push({ body, key: request.headers()["idempotency-key"] });
      return json({ orderId: "700", orderState: "CONFIRMED", paymentState: "APPROVED", total: "21.28", paymentReference: "SIM-PICKUP",
        subtotal: "18.50", taxRate: "15.00", taxAmount: "2.78", shippingAmount: "0.00", fulfillment: pickupOrder.fulfillment }, 201);
    }
    if (path === "/api/v1/orders/700") return json(pickupOrder);
    return json({ items: [], page: 0, pageSize: 20, totalCount: "0" });
  });
  await page.goto("/sign-in?from=%2Fcheckout");
  await page.getByLabel("Correo electrónico").fill("ana@example.com");
  await page.getByLabel("Contraseña", { exact: true }).fill("Lectura-segura-2026");
  await page.getByRole("button", { name: "Iniciar sesión", exact: true }).click();
  await expect(page).toHaveURL(/\/checkout$/);
  await expect(page.getByText("Av. Principal 123")).toBeVisible();
  return { posts, locations: (state: typeof locationState) => { locationState = state; } };
}
async function choosePickup(page: Page) {
  await page.getByRole("tab", { name: "Retiro", exact: true }).click();
  await page.getByRole("radio", { name: /Punto de prueba Quito/ }).click();
  await expect(page.getByRole("button", { name: "Cambiar punto" })).toBeFocused();
}
async function noOverflow(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
}
async function axe(page: Page) {
  const results = await new AxeBuilder({ page }).analyze().catch(async (error: unknown) => {
    if (!(error instanceof Error) || !error.message.includes("page.evaluate: SyntaxError") || !error.message.includes("JSON")) throw error;
    // Malformed partial-result transport must not skip accessibility rules or hide violations.
    console.warn("Axe result transport returned malformed JSON; rerunning all checks via axe.run.");
    return new AxeBuilder({ page }).setLegacyMode().analyze();
  });
  expect(results.violations).toEqual([]);
}

for (const width of [1440, 1024, 768, 390, 320]) {
  test(`Google composition with PLIEGO controls at ${width}px`, async ({ page }, info) => {
    await page.setViewportSize({ width, height: 950 }); await install(page);
    const tabs = page.getByRole("tablist"); const summary = page.locator('[data-purchase="summary"]');
    const destination = page.getByRole("tabpanel");
    await expect(page.getByRole("button", { name: "Hacer pedido" })).toBeDisabled();
    await expect(page.getByRole("banner")).toContainText("Finalizar Compra");
    expect(await page.getByRole("button", { name: "Hacer pedido" }).evaluate(button => getComputedStyle(button).cursor)).toBe("not-allowed");
    const headingLines = summary.getByRole("heading", { name: "Resumen del pedido" }).locator("span");
    await expect(headingLines).toHaveText(["Resumen", "del pedido"]);
    const firstHeadingLine = (await headingLines.nth(0).boundingBox())!;
    const secondHeadingLine = (await headingLines.nth(1).boundingBox())!;
    expect(secondHeadingLine.y).toBeGreaterThan(firstHeadingLine.y);
    const [tabsBox, destinationBox, summaryBox] = await Promise.all([tabs.boundingBox(), destination.boundingBox(), summary.boundingBox()]);
    expect(tabsBox!.y + tabsBox!.height).toBeLessThan(destinationBox!.y);
    if (width >= 960) { expect(summaryBox!.x).toBeGreaterThan(tabsBox!.x + tabsBox!.width); expect(Math.abs(summaryBox!.y - tabsBox!.y)).toBeLessThan(3); }
    await page.getByRole("button", { name: "Cambiar dirección" }).click();
    await expect(destination.getByText("Casa", { exact: true })).toHaveText("Casa");
    await page.screenshot({ path: info.outputPath(`delivery-addresses-${width}.png`), fullPage: true });
    await page.getByRole("button", { name: "Cerrar", exact: true }).click();
    await expect(page.getByRole("button", { name: "Cambiar dirección" })).toBeFocused();
    await page.screenshot({ path: info.outputPath(`delivery-${width}.png`), fullPage: true });
    const delivery = page.getByRole("tab", { name: "Entrega", exact: true });
    await delivery.focus(); await page.keyboard.press("ArrowRight");
    await expect(page.getByRole("tab", { name: "Retiro", exact: true })).toBeFocused();
    await page.getByRole("radio", { name: /Punto de prueba Quito/ }).click();
    await expect(page.getByRole("button", { name: "Cambiar punto" })).toBeFocused();
    await expect(destination).toContainText("Punto de prueba Quito");
    await expect(destination).toContainText("Preparación estimada: ~37 min.");
    await expect(page.getByRole("button", { name: "Hacer pedido" })).toBeDisabled();
    await expect(summary.locator("dt")).toHaveText(["Subtotal", "IVA (15 %)", "Gastos de envío", "Total"]);
    await expect(page.getByTitle("Mapa de Punto de prueba Quito")).toHaveCount(0);
    await noOverflow(page); await axe(page);
    await page.screenshot({ path: info.outputPath(`pickup-${width}.png`), fullPage: true });
    await delivery.click(); await expect(page.getByText("Av. Principal 123")).toBeVisible();
    await expect(destination).toContainText("Entrega a domicilio");
    await expect(summary.locator("dt")).toHaveText(["Subtotal", "IVA (15 %)", "Gastos de envío", "Total"]);
    await page.getByRole("tab", { name: "Retiro", exact: true }).click();
    await expect(destination).toContainText("Punto de prueba Quito");
    await expect(page.getByTitle("Mapa de Punto de prueba Quito")).toHaveCount(0);
  });
}

test("loading error, retry, multiple locations and empty-state recovery", async ({ page }) => {
  const api = await install(page); api.locations("error");
  await page.getByRole("tab", { name: "Retiro", exact: true }).click();
  await expect(page.getByText("No pudimos consultar los puntos de retiro.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Hacer pedido" })).toHaveAttribute("aria-disabled", "true");
  await page.route("**/api/v1/reference/transfer-details", route => route.fulfill({ status: 400, json: { code: "READ_FAILURE", title: "Sin conexión", detail: "Vuelve a consultar." } }));
  await page.getByRole("button", { name: "Transferencia bancaria" }).click();
  await expect(page.getByRole("alert", { name: "No pudimos consultar los puntos de retiro." })).toBeVisible();
  await expect(page.getByRole("alert", { name: "No pudimos consultar los datos bancarios." })).toBeVisible();
  await axe(page);
  api.locations("ok"); await page.getByRole("alert", { name: "No pudimos consultar los puntos de retiro." }).getByRole("button", { name: "Volver a intentar" }).click();
  await expect(page.getByRole("radio")).toHaveCount(2);
  await expect(page.getByRole("radio").first()).toBeFocused();
  await page.getByRole("radio", { name: /Otro punto de retiro/ }).focus(); await page.keyboard.press("Space");
  await expect(page.getByRole("tabpanel")).toContainText("Otro punto de retiro");
  await expect(page.getByTitle("Mapa de Otro punto de retiro")).toHaveCount(0);
  api.locations("empty");
  await page.getByRole("tab", { name: "Entrega", exact: true }).click();
  await page.getByRole("tab", { name: "Retiro", exact: true }).click();
  await expect(page.getByText(/No hay puntos de retiro disponibles/)).toBeVisible();
  await expect(page.getByRole("button", { name: "Hacer pedido" })).toHaveAttribute("aria-disabled", "true");
  expect(api.posts).toHaveLength(0);
  await page.getByRole("tab", { name: "Entrega", exact: true }).click();
  await expect(page.getByText("Av. Principal 123")).toBeVisible();
});

for (const payment of ["CARD", "TRANSFER"] as const) {
  test(`pickup confirmation and ${payment} at 200% text with reduced motion`, async ({ page }, info) => {
    await page.setViewportSize({ width: 1280, height: 1000 }); await page.emulateMedia({ reducedMotion: "reduce" });
    const api = await install(page); await page.evaluate(() => { document.documentElement.style.fontSize = "200%"; });
    await choosePickup(page); await noOverflow(page); await axe(page);
    if (payment === "CARD") {
      await page.getByRole("button", { name: "Tarjeta de crédito o débito" }).click();
      await expect(page.getByRole("button", { name: "Hacer pedido" })).toBeDisabled();
      await page.getByLabel("Número de tarjeta").fill("4111111111111111");
      await page.getByLabel("Caducidad (MM/AA)").fill("12/30");
      await page.getByLabel("Código de seguridad", { exact: true }).fill("123");
      await page.getByLabel("Nombre en la tarjeta").fill("Ana Pérez");
      await expect(page.getByRole("button", { name: "Hacer pedido" })).toBeDisabled();
      await page.getByRole("button", { name: "Usar esta tarjeta" }).click();
      await expect(page.getByRole("button", { name: "Cambiar método de pago" })).toBeFocused();
    } else {
      await page.getByRole("button", { name: "Transferencia bancaria" }).click();
      await expect(page.getByText("Banco Guayaquil")).toBeVisible();
    }
    await expect(page.getByRole("button", { name: "Hacer pedido" })).toBeEnabled();
    await page.getByRole("button", { name: "Hacer pedido" }).click();
    await expect(page.getByRole("heading", { level: 1 })).toBeFocused();
    await expect(page.getByText("P-ABC234")).toBeVisible();
    await expect(page.locator('time[datetime="2026-10-05T00:32:12Z"]')).toContainText("19:32:12");
    await expect(page.getByText("America/Guayaquil")).toHaveCount(0);
    await expect(page.getByText(/Presenta la confirmación enviada a tu correo/)).toBeVisible();
    await expect(page.getByTitle("Mapa de Punto de prueba Quito")).toHaveAttribute("src", /marker=-0\.22%2C-78\.5/);
    await expect(page.getByRole("complementary", { name: "Tu pedido" })).not.toContainText(/IVA|Total|Cien años/);
    await expect(page.locator('[data-confirmation="details"]')).toContainText("IVA (15 %)");
    expect(api.posts).toHaveLength(1);
    expect(api.posts[0].body).toMatchObject({ fulfillmentMethod: "STORE_PICKUP", pickupLocationId: "8", paymentMethod: payment });
    expect(api.posts[0].body).not.toHaveProperty("addressId");
    expect(api.posts[0].key).toMatch(/^[0-9a-f-]{36}$/);
    await noOverflow(page); await axe(page);
    await page.screenshot({ path: info.outputPath(`confirmation-${payment}-200text.png`), fullPage: true });
    await page.getByRole("complementary", { name: "Tu pedido" }).getByRole("link", { name: "Ver pedido completo" }).click();
    await expect(page.getByRole("heading", { level: 1, name: "Detalle del pedido" })).toBeFocused();
    await expect(page.getByText("P-ABC234")).toBeVisible();
    await expect(page.getByRole("heading", { name: "Retiro en tienda", exact: true })).toBeVisible();
    await expect(page.getByText(/Transportista|Código de seguimiento/)).toHaveCount(0);
    await noOverflow(page); await axe(page);
  });
}

for (const adaptation of [{ width: 1440, largeText: false }, { width: 320, largeText: false }, { width: 1280, largeText: true }]) {
  test(`CVV help preserves keyboard, data and dialog at ${adaptation.width}px${adaptation.largeText ? " / 200% text" : ""}`, async ({ page }, info) => {
    await page.setViewportSize({ width: adaptation.width, height: 1000 });
    await page.emulateMedia({ reducedMotion: "reduce" });
    const api = await install(page);
    if (adaptation.largeText) await page.evaluate(() => { document.documentElement.style.fontSize = "200%"; });
    await page.getByRole("button", { name: "Tarjeta de crédito o débito" }).click();
    const cardDialog = page.getByRole("dialog", { name: "Tarjeta de crédito o débito" });
    const cardSurface = (await cardDialog.elementHandle())!;
    const originalScrollHeight = await cardSurface.evaluate(node => node.scrollHeight);
    const help = cardDialog.getByRole("button", { name: "Ayuda sobre el código de seguridad" });
    await help.focus(); await page.keyboard.press("Enter");
    let popup = page.getByRole("dialog", { name: "Código de seguridad" });
    await expect(popup.getByRole("heading", { name: "Código de seguridad" })).toBeFocused();
    await expect(popup.getByRole("img", { name: "Código de 3 dígitos al reverso de la tarjeta" })).toBeVisible();
    await page.keyboard.press("Tab");
    await expect(popup.getByRole("button", { name: "Entendido" })).toBeFocused();
    await page.keyboard.press("Shift+Tab"); await expect(popup.getByRole("button", { name: "Entendido" })).toBeFocused();
    await page.keyboard.press("Escape"); await expect(popup).toHaveCount(0); await expect(help).toBeFocused();
    await expect(cardDialog).toBeVisible();
    await cardDialog.getByLabel("Número de tarjeta").fill("378282246310005");
    await help.click(); popup = page.getByRole("dialog", { name: "Código de seguridad" });
    await expect(popup.getByRole("img", { name: "Código de 4 dígitos en el frente de la tarjeta" })).toBeVisible();
    expect(await cardSurface.evaluate(node => node.scrollHeight)).toBe(originalScrollHeight);
    const bounds = (await popup.boundingBox())!;
    expect(bounds.x).toBeGreaterThanOrEqual(0); expect(bounds.y).toBeGreaterThanOrEqual(0);
    expect(bounds.x + bounds.width).toBeLessThanOrEqual(adaptation.width + 1);
    expect(bounds.y + bounds.height).toBeLessThanOrEqual(1001);
    await axe(page);
    await page.screenshot({ path: info.outputPath("cvv-front-help.png"), fullPage: true, animations: "disabled" });
    await popup.getByRole("button", { name: "Entendido" }).click(); await expect(help).toBeFocused();
    await expect(cardDialog.getByLabel("Número de tarjeta")).toHaveValue("3782 822463 10005");
    await help.click();
    await page.mouse.click(8, 8);
    await expect(popup).toHaveCount(0); await expect(cardDialog).toBeVisible();
    expect(api.posts).toHaveLength(0);
    await expect(page.getByRole("button", { name: "Hacer pedido" })).toBeDisabled();
  });
}

test("closing CVV help and card in quick succession preserves the payment trigger focus", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await install(page);
  const opener = page.getByRole("button", { name: "Tarjeta de crédito o débito", exact: true });
  await opener.click();
  const card = page.getByRole("dialog", { name: "Tarjeta de crédito o débito" });
  const help = card.getByRole("button", { name: "Ayuda sobre el código de seguridad" });
  await help.click();
  await expect(page.getByRole("dialog", { name: "Código de seguridad" }).getByRole("heading")).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(help).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(card).toHaveCount(0);
  await expect(opener).toBeFocused();
});
