import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

// Opt-in fixture contains only a disposable test account; supply it through the test runner environment.
const env = (globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env ?? {};
const fixtureJson = env.PLIEGO_PICKUP_LIVE_FIXTURE_JSON;
test.skip(!fixtureJson, "Set PLIEGO_PICKUP_LIVE_FIXTURE_JSON to a verified disposable customer fixture.");
test.describe.configure({ mode: "serial" });
const api = "http://127.0.0.1:8080/api/v1";

for (const [fulfillment, payment, width] of [["STORE_PICKUP", "CARD", 1440], ["STORE_PICKUP", "TRANSFER", 390], ["HOME_DELIVERY", "CARD", 1280], ["HOME_DELIVERY", "CARD", 390]] as const) {
  test(`live ${fulfillment} / ${payment} at ${width}px`, async ({ page, request }, info) => {
    const fixture = JSON.parse(fixtureJson!);
    const credentials = { email: fixture.email, password: fixture.password };
    const login = await request.post(`${api}/auth/login`, { data: credentials }); expect(login.status()).toBe(200);
    const headers = { Authorization: `Bearer ${(await login.json()).accessToken}` };
    const previousCart = await (await request.get(`${api}/cart`, { headers })).json();
    for (const item of previousCart.items) expect((await request.delete(`${api}/cart/items/${item.cartItemId}`, { headers })).status()).toBe(204);
    const catalog = await (await request.get(`${api}/catalog/editions?pageSize=50`)).json();
    const edition = catalog.items.find((item: { available: boolean; format: string }) => item.available && ["PAPERBACK", "HARDCOVER"].includes(item.format));
    expect(edition, "The live catalog needs an available physical edition for this gate").toBeTruthy();
    const add = await request.post(`${api}/cart/items`, { headers, data: { editionId: edition.editionId, quantity: 1 } }); expect(add.status(), JSON.stringify(await add.json())).toBe(200);
    let addresses = await (await request.get(`${api}/me/addresses`, { headers })).json();
    if (fulfillment === "HOME_DELIVERY" && addresses.length === 0) {
      const address = await request.post(`${api}/me/addresses`, { headers: { ...headers, "Idempotency-Key": crypto.randomUUID() }, data: {
        alias: "Casa de prueba", recipient: "Lectora Prueba", line1: "Calle de prueba 123", city: "Quito", province: "Pichincha",
        countryCode: "EC", phone: "+593992345678", makePrimary: true,
      } }); expect(address.status(), JSON.stringify(await address.json())).toBe(201);
      addresses = await (await request.get(`${api}/me/addresses`, { headers })).json();
    }
    const cart = await (await request.get(`${api}/cart`, { headers })).json();
    const locations = await (await request.get(`${api}/pickup-locations`)).json();
    await page.context().clearCookies();
    await page.setViewportSize({ width, height: 1000 });
    await page.goto("/sign-in?from=%2Fcheckout");
    await page.getByLabel("Correo electrónico").fill(credentials.email);
    await page.getByLabel("Contraseña", { exact: true }).fill(credentials.password);
    await page.getByRole("button", { name: "Iniciar sesión", exact: true }).click();
    await expect(page).toHaveURL(/\/checkout$/);
    if (fulfillment === "STORE_PICKUP") {
      await page.getByRole("tab", { name: "Retiro", exact: true }).click();
      await page.getByRole("radio").first().click();
      await expect(page.getByRole("button", { name: "Cambiar punto" })).toBeFocused();
      await expect(page.getByRole("tabpanel")).toContainText(locations[0].name);
      await expect(page.getByRole("tabpanel")).toContainText(`Preparación estimada: ~${locations[0].preparationMinutes} min.`);
      await expect(page.getByTitle(`Mapa de ${locations[0].name}`)).toHaveCount(0);
      await page.getByRole("tab", { name: "Entrega", exact: true }).click();
      if (addresses.length) await expect(page.getByText((addresses.find((address: { primary: boolean }) => address.primary) ?? addresses[0]).line1, { exact: true })).toBeVisible();
      else await expect(page.getByText(/Aún no tienes una dirección guardada/)).toBeVisible();
      await page.getByRole("tab", { name: "Retiro", exact: true }).click();
      await expect(page.getByRole("tabpanel")).toContainText(locations[0].name);
      await expect(page.getByTitle(`Mapa de ${locations[0].name}`)).toHaveCount(0);
    } else await expect(page.getByText("Calle de prueba 123")).toBeVisible();
    if (payment === "CARD") {
      await page.getByRole("button", { name: "Tarjeta de crédito o débito" }).click();
      await page.getByLabel("Número de tarjeta").fill("4111111111111111");
      await page.getByLabel("Caducidad (MM/AA)").fill("12/30");
      await page.getByLabel("Código de seguridad", { exact: true }).fill("123");
      await page.getByLabel("Nombre en la tarjeta").fill("Lectora Prueba");
      await page.getByRole("button", { name: "Usar esta tarjeta" }).click();
    } else {
      const bank = await (await request.get(`${api}/reference/transfer-details`)).json();
      await page.getByRole("button", { name: "Transferencia bancaria" }).click();
      await expect(page.getByText(bank.bank, { exact: true })).toBeVisible();
    }
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(page.locator('[data-purchase="summary"]')).not.toContainText(/Recepción|Punto de retiro/);
    await page.evaluate(() => window.scrollTo({ top: 0, behavior: "instant" }));
    await page.screenshot({ path: info.outputPath(`${fulfillment}-${payment}-checkout.png`), fullPage: true, animations: "disabled" });
    const responsePromise = page.waitForResponse(response => new URL(response.url()).pathname === "/api/v1/checkout" && response.request().method() === "POST");
    await page.getByRole("button", { name: "Hacer pedido" }).click();
    const response = await responsePromise; expect(response.status()).toBe(201);
    const command = response.request().postDataJSON();
    expect(command.fulfillmentMethod).toBe(fulfillment); expect(command.paymentMethod).toBe(payment);
    if (fulfillment === "STORE_PICKUP") { expect(command.pickupLocationId).toBe(locations[0].id); expect(command).not.toHaveProperty("addressId"); }
    else { expect(command.addressId).toMatch(/^\d+$/); expect(command).not.toHaveProperty("pickupLocationId"); }
    const result = await response.json();
    const detail = await (await request.get(`${api}/orders/${result.orderId}`, { headers })).json();
    expect(result.total).toBe(cart.total); expect(result.taxAmount).toBe(cart.taxAmount); expect(detail.total).toBe(result.total);
    await expect(page).toHaveURL(new RegExp(`/orders/${result.orderId}$`));
    await expect(page.getByRole("heading", { level: 1 })).toBeFocused();
    if (fulfillment === "STORE_PICKUP") {
      expect(detail.address).toBeNull(); expect(detail.shipment).toBeNull();
      const pickup = detail.fulfillment.pickup;
      expect(pickup).toEqual(result.fulfillment.pickup);
      await expect(page.getByText(pickup.pickupCode, { exact: true })).toBeVisible();
      await expect(page.locator(`time[datetime="${pickup.readyAt}"]`)).toBeVisible();
      await expect(page.getByText(pickup.location.timezone, { exact: true })).toHaveCount(0);
      await expect(page.getByText(/Presenta la confirmación enviada a tu correo/)).toBeVisible();
      await expect(page.getByTitle(`Mapa de ${pickup.location.name}`)).toHaveAttribute("src", new RegExp(`marker=${pickup.location.latitude}%2C${pickup.location.longitude}`.replaceAll(".", "\\.")));
      await expect(page.getByText(/Transportista|Código de seguimiento/)).toHaveCount(0);
    } else {
      expect(detail.fulfillment.method).toBe("HOME_DELIVERY"); expect(detail.address.line1).toBe("Calle de prueba 123");
      await expect(page.getByRole("region", { name: "Destino confirmado" }).getByText(detail.address.recipient, { exact: true })).toBeVisible();
      await expect(page.getByRole("region", { name: "Destino confirmado" }).getByTitle("Mapa de referencia de PUCE")).toHaveAttribute("src", /marker=-0\.21%2C-78\.4914/);
      await expect(page.getByText(/no ubica la dirección de entrega/)).toBeVisible();
    }
    await expect(page.getByRole("heading", { name: "Es momento de celebrar" })).toBeVisible();
    await expect(page.getByRole("complementary", { name: "Tu pedido" })).not.toContainText(/Subtotal|IVA|Total/);
    await expect(page.getByRole("region", { name: "Destino confirmado" }).getByRole("heading", { name: "Enviar a" })).toBeVisible();
    const destinationBox = (await page.getByRole("region", { name: "Destino confirmado" }).boundingBox())!;
    const quickBox = (await page.getByRole("complementary", { name: "Tu pedido" }).boundingBox())!;
    if (width >= 850) { expect(quickBox.x).toBeGreaterThan(destinationBox.x + destinationBox.width); expect(Math.abs(quickBox.y - destinationBox.y)).toBeLessThan(3); }
    else expect(quickBox.y).toBeGreaterThan(destinationBox.y + destinationBox.height);
    await expect(page.locator('[data-confirmation="details"]')).not.toContainText(detail.payment.reference);
    await expect(page.locator('[data-confirmation="details"]')).not.toContainText(detail.address?.line1 ?? detail.fulfillment.pickup.location.address);
    await expect(page.locator('[data-confirmation="fulfillment"]')).toContainText(detail.items[0].title);
    await expect(page.locator('[data-confirmation="fulfillment"]').locator("figure")).toHaveCount(detail.items.length);
    await expect(page.getByRole("list", { name: "Progreso del envío" })).toHaveCount(0);
    const replay = await request.post(`${api}/checkout`, { headers: { ...headers, "Idempotency-Key": response.request().headers()["idempotency-key"] }, data: command });
    expect(replay.status()).toBe(201); expect(await replay.json()).toEqual(result);
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
    await page.evaluate(() => window.scrollTo({ top: 0, behavior: "instant" }));
    await page.screenshot({ path: info.outputPath(`${fulfillment}-${payment}-confirmation.png`), fullPage: true, animations: "disabled" });
  });
}
