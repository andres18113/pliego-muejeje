import { fillCheckoutBilling } from "./billing-fixtures";
import { chromium, expect, test, type BrowserContext, type Page } from "@playwright/test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { storefrontNavigationFixture } from "../../src/test/storefrontFixture";

const title = "Manual de medicina basada en evidencias";
const prices = {
  1: { line: "81.95", tax: "12.29", total: "114.93" },
  2: { line: "163.90", tax: "24.59", total: "209.18" },
  3: { line: "245.85", tax: "36.88", total: "303.42" },
  10: { line: "819.50", tax: "122.93", total: "963.12" },
} as const;
type Quantity = keyof typeof prices;

/** Only the HTTP boundary is replaced; both tabs run the real session, query cache and purchase components. */
async function installPurchaseApi(context: BrowserContext, initialQuantity: Quantity = 1) {
  const state = { quantity: initialQuantity, addresses: [] as Record<string, unknown>[], checkoutPosts: 0, addressPosts: 0,
    cartReads: [] as { tab: string; quantity: Quantity }[], quantityPuts: [] as Quantity[],
    heldCartRead: null as { page: Page; wait: Promise<void> } | null };
  await context.route("**/api/v1/**", async route => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname.replace("/api/v1", "");
    const method = request.method();
    const ok = (json: unknown, status = 200) => route.fulfill({ status, json });
    if (path === "/auth/refresh" && method === "POST") return ok({ accessToken: "browser-fixture-token", tokenType: "Bearer", expiresInSeconds: 1800,
      user: { userId: "100", email: "reader@example.test", role: "CUSTOMER" } });
    if (path === "/storefront/navigation" && method === "GET") return ok(storefrontNavigationFixture);
    if (path === "/me" && method === "GET") return ok({ customerId: "100", email: "reader@example.test", firstNames: "Lectora", lastNames: "Prueba",
      phone: null, state: "ACTIVE", version: "0", emailVerified: true });
    if (path === "/me/favorites" && method === "GET") return ok({ items: [], page: 0,
      pageSize: Number(url.searchParams.get("pageSize") ?? url.searchParams.get("size") ?? 4), totalCount: "0" });
    if (path === "/me/favorites/status" && method === "GET") return ok(url.searchParams.getAll("editionIds").map(editionId => ({ editionId, favorite: false })));
    if (path === "/cart" && method === "GET") {
      state.cartReads.push({ tab: request.frame().page().url(), quantity: state.quantity });
      if (state.heldCartRead?.page === request.frame().page()) await state.heldCartRead.wait;
      const price = prices[state.quantity];
      return ok({ cartId: "40", state: "ACTIVE", requiresPhysicalFulfillment: true, physicalItemCount: 1, digitalItemCount: 0,
        items: [{ cartItemId: "50", editionId: "250", title, authors: "Autora Prueba", sku: "TEST-250", coverUrl: null,
          quantity: state.quantity, currentPrice: "81.95", currentSubtotal: price.line, available: true,
          requiresPhysicalFulfillment: true, quantityEditable: true, format: "PAPERBACK", unavailabilityReason: null }],
        totalCurrent: price.total, subtotal: price.line, taxRate: "15.00", taxAmount: price.tax, shippingAmount: "20.69", total: price.total,
        quoteFingerprint: state.quantity.toString(16).repeat(64), estimatedDeliveryFrom: "2026-10-12", estimatedDeliveryTo: "2026-10-15",
      });
    }
    if (path === "/cart/items/50" && method === "PUT") {
      const quantity = request.postDataJSON().quantity as Quantity;
      if (!(quantity in prices)) throw new Error(`Unexpected fixture quantity ${quantity}`);
      state.quantity = quantity;
      state.quantityPuts.push(quantity);
      return ok({ cartId: "40", cartItemId: "50", quantity });
    }
    if (path === "/me/addresses" && method === "GET") return ok(state.addresses);
    if (path === "/me/addresses" && method === "POST") {
      state.addressPosts++;
      const body = request.postDataJSON();
      state.addresses.push({ ...body, addressId: "15", primary: true, line2: body.line2 ?? null,
        postalCode: body.postalCode ?? null, reference: body.reference ?? null });
      return ok({ addressId: "15" }, 201);
    }
    if (path === "/reference/countries" && method === "GET") return ok([{ code: "EC", name: "Ecuador" }]);
    if (path === "/reference/transfer-details" && method === "GET") return ok({ bank: "Banco de prueba", beneficiary: "PLIEGO Prueba", accountType: "Ahorros", accountNumber: "000000", identification: "0000000000" });
    if (path === "/pickup-locations" && method === "GET") return ok([]);
    if (path === "/checkout" && method === "POST") {
      state.checkoutPosts++;
      // No order is created, even if a regression lets a blocked click cross this boundary.
      return ok({ type: "urn:pliego:problem:P1001", title: "Pedido de prueba bloqueado", status: 422, detail: "No se creó ningún pedido.", code: "P1001" }, 422);
    }
    return ok({ title: "Endpoint no previsto en esta prueba", status: 404 }, 404);
  });
  return state;
}

async function changeQuantity(page: Page, quantity: Quantity) {
  const control = page.getByRole("combobox", { name: `Cantidad de ${title}`, exact: true });
  await control.click();
  await page.getByRole("option", { name: String(quantity), exact: true }).click();
  await expect(control).toHaveAttribute("data-quantity", String(quantity));
  await expect(control).not.toHaveAttribute("aria-disabled", "true");
}

for (const width of [320, 390, 768, 1280]) {
  test(`Cardholder name rejects digits while typing at ${width}px`, async ({ context, page }) => {
    const state = await installPurchaseApi(context);
    state.addresses.push({ addressId: "15", alias: "Casa", recipient: "Lectora Prueba", line1: "Calle de prueba 123", line2: null,
      city: "Quito", province: "Pichincha", countryCode: "EC", postalCode: null, reference: null, phone: "+593991234567", primary: true });
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/checkout");
    await page.getByRole("button", { name: "Tarjeta de crédito o débito", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "Tarjeta de crédito o débito", exact: true });
    const holder = dialog.getByLabel("Nombre en la tarjeta", { exact: true });
    await holder.pressSequentially("Ana7");
    await expect(holder).toHaveValue("Ana");
    await expect(dialog.getByText(/solo letras, espacios/)).toBeVisible();
    await expect(holder).toHaveAttribute("aria-invalid", "true");
    expect(state.checkoutPosts).toBe(0);
  });
  test(`ACCT-02 quantity 10 distinguishes unit price and subtotal at ${width}px`, async ({ context, page }) => {
    await installPurchaseApi(context, 10);
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/cart");
    const line = page.locator("[data-cart-line]");
    await expect(line).toContainText("Cant.10");
    await expect(line.getByText(/81,95 c\/u/)).toBeVisible();
    await expect(line.getByText(/Subtotal.*819,50/)).toBeVisible();
    const overflow = await line.evaluate(el => el.scrollWidth > el.clientWidth);
    expect(overflow).toBe(false);
    await page.screenshot({ path: test.info().outputPath(`cart-qty10-${width}.png`), fullPage: true });
  });

  test(`ACCT-03 first saved address restores focus after the real dialog exits at ${width}px`, async ({ context, page }) => {
    const state = await installPurchaseApi(context);
    await page.setViewportSize({ width, height: 900 });
    // A busy browser can commit the replacement control later than a single animation frame.
    const renderer = await context.newCDPSession(page);
    await renderer.send("Emulation.setCPUThrottlingRate", { rate: 4 });
    await page.goto("/checkout");
    const add = page.getByRole("button", { name: "Añadir dirección", exact: true });
    const dialog = page.getByRole("dialog", { name: "Nueva dirección" });
    await add.click();
    await dialog.getByRole("button", { name: "Cancelar", exact: true }).click();
    await expect(dialog).toHaveCount(0);
    await expect(add).toBeFocused();
    await add.click();
    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
    await expect(add).toBeFocused();
    await add.click();
    await dialog.getByLabel("Dirección", { exact: true }).fill("Calle de prueba 123");
    await dialog.getByLabel("Ciudad", { exact: true }).fill("Quito");
    await dialog.getByLabel("Provincia", { exact: true }).fill("Pichincha");
    await dialog.getByLabel("Teléfono de contacto", { exact: true }).fill("991234567");
    await dialog.getByRole("button", { name: "Guardar dirección", exact: true }).click();
    await expect(dialog).toHaveCount(0);
    await expect(page.locator('[data-purchase="selected-address"]')).toContainText("Calle de prueba 123");
    const notice = page.getByRole("status").filter({ hasText: "Guardamos la dirección y la elegimos para este pedido." });
    await expect(notice).toHaveCount(1);
    await expect(notice).toBeVisible();
    await page.screenshot({ path: test.info().outputPath(`address-saved-${width}.png`), fullPage: true });
    const focusEvidence = JSON.stringify(await page.evaluate(() => ({
      tag: document.activeElement?.tagName, id: document.activeElement?.id,
    })));
    await writeFile(test.info().outputPath("focus-after-save.json"), focusEvidence);
    await test.info().attach("focus-after-save", { body: focusEvidence, contentType: "application/json" });
    await expect(page.locator("#checkout-change-address")).toBeFocused();
    expect(state.addressPosts).toBe(1);
    expect(state.checkoutPosts).toBe(0);
  });
}

test("ACCT-01 two real tabs converge on activation and require a fresh checkout acknowledgement after each change", async ({ baseURL }) => {
  const scratch = await mkdtemp(join(tmpdir(), "pliego-purchase-tabs-"));
  const extension = join(scratch, "activation");
  await mkdir(extension);
  await writeFile(join(extension, "manifest.json"), JSON.stringify({ manifest_version: 3, name: "PLIEGO real tab activation", version: "1.0",
    permissions: ["tabs"], background: { service_worker: "worker.js" } }));
  await writeFile(join(extension, "worker.js"), "chrome.runtime.onInstalled.addListener(() => {});");
  const context = await chromium.launchPersistentContext(join(scratch, "profile"), { channel: "chromium", headless: true, baseURL,
    viewport: { width: 1280, height: 900 }, ignoreDefaultArgs: ["--disable-extensions"],
    args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`],
    env: { ...process.env, XDG_CONFIG_HOME: scratch, XDG_CACHE_HOME: scratch },
  });
  try {
    const worker = context.serviceWorkers()[0] ?? await context.waitForEvent("serviceworker");
    const page = await context.newPage();
    const state = await installPurchaseApi(context);
    state.addresses.push({ addressId: "15", alias: "Casa", recipient: "Lectora Prueba", line1: "Calle de prueba 123", line2: null,
      city: "Quito", province: "Pichincha", countryCode: "EC", postalCode: null, reference: null, phone: "+593991234567", primary: true });
    await page.goto("/cart?test-tab=a");
    const secondTab = await context.newPage();
    await secondTab.goto("/cart?test-tab=b");
    for (const tab of [page, secondTab]) {
      const nativeFocus = await context.newCDPSession(tab);
      await nativeFocus.send("Emulation.setFocusEmulationEnabled", { enabled: false });
      await tab.evaluate(() => {
        const events: string[] = [];
        Object.assign(window, { purchaseActivationEvents: events });
        window.addEventListener("focus", () => events.push("focus"));
        document.addEventListener("visibilitychange", () => events.push(document.visibilityState));
      });
    }
    const tabIds = await worker.evaluate("(async () => { const tabs = await chrome.tabs.query({}); return { a: tabs.find(t => t.url?.includes('test-tab=a')).id, b: tabs.find(t => t.url?.includes('test-tab=b')).id }; })()") as { a: number; b: number };
    async function activate(tab: Page, id: number) {
      await worker.evaluate(`(async () => { const tab = await chrome.tabs.update(${id}, { active: true }); await chrome.windows.update(tab.windowId, { focused: true }); })()`);
      await tab.bringToFront();
    }
    await expect(secondTab.getByRole("combobox", { name: `Cantidad de ${title}` })).toHaveAttribute("data-quantity", "1");
    await activate(page, tabIds.a);
    await changeQuantity(page, 2);
    await activate(secondTab, tabIds.b);
    const nativeActivation = JSON.stringify({ reads: state.cartReads,
      a: await page.evaluate(() => ({ focus: document.hasFocus(), visibility: document.visibilityState, events: Reflect.get(window, "purchaseActivationEvents") })),
      b: await secondTab.evaluate(() => ({ focus: document.hasFocus(), visibility: document.visibilityState, events: Reflect.get(window, "purchaseActivationEvents") })),
    });
    await writeFile(test.info().outputPath("native-tab-activation.json"), nativeActivation);
    await test.info().attach("native-tab-activation", { body: nativeActivation, contentType: "application/json" });
    await expect(secondTab.getByRole("combobox", { name: `Cantidad de ${title}` })).toHaveAttribute("data-quantity", "2");
    await expect(secondTab.getByText(/209,18/).first()).toBeVisible();

    // Preserve the second tab's old cache while the first tab changes the authoritative cart again.
    await activate(page, tabIds.a);
    await changeQuantity(page, 3);
    let releaseMountRead!: () => void;
    state.heldCartRead = { page: secondTab, wait: new Promise<void>(resolve => { releaseMountRead = resolve; }) };
    await activate(secondTab, tabIds.b);
    await secondTab.getByRole("link", { name: "Continuar con la compra", exact: true }).click();
    await expect(secondTab.getByRole("heading", { level: 1, name: "Finalizar compra" })).toBeVisible();
    // The native focus read is still pending: checkout first shows the real cached quantity 2.
    await expect(secondTab.getByText(/209,18/).first()).toBeVisible();
    state.heldCartRead = null;
    releaseMountRead();
    const changed = secondTab.getByRole("alert", { name: "Tu carrito cambió", exact: true });
    await expect(changed).toBeVisible();
    await expect(changed).toContainText("209,18");
    await expect(changed).toContainText("303,42");
    await secondTab.screenshot({ path: test.info().outputPath("checkout-change-30342.png"), fullPage: true });
    await secondTab.getByRole("button", { name: "Transferencia bancaria", exact: true }).click();
    await fillCheckoutBilling(secondTab);
    const submit = secondTab.getByRole("button", { name: "Hacer pedido", exact: true });
    await expect(submit).toHaveAttribute("aria-disabled", "true");
    // Native pointer events still reach an aria-disabled control; test our handler's guard.
    await submit.dblclick({ force: true });
    expect(state.checkoutPosts).toBe(0);
    await changed.getByRole("button", { name: "Revisé el resumen actualizado", exact: true }).click();
    await expect(changed).toHaveCount(0);
    await expect(submit).not.toHaveAttribute("aria-disabled", "true");

    await activate(page, tabIds.a);
    await changeQuantity(page, 1);
    await activate(secondTab, tabIds.b);
    await expect(changed).toBeVisible();
    await expect(changed).toContainText("303,42");
    await expect(changed).toContainText("114,93");
    await secondTab.screenshot({ path: test.info().outputPath("checkout-change-11493.png"), fullPage: true });
    await expect(submit).toHaveAttribute("aria-disabled", "true");
    await submit.dblclick({ force: true });
    expect(state.checkoutPosts).toBe(0);
    await changed.getByRole("button", { name: "Revisé el resumen actualizado", exact: true }).click();
    await expect(submit).not.toHaveAttribute("aria-disabled", "true");
    await test.info().attach("cart-boundary-reads", { body: JSON.stringify(state.cartReads), contentType: "application/json" });
    await writeFile(test.info().outputPath("cart-boundary.json"), JSON.stringify({ reads: state.cartReads, quantityPuts: state.quantityPuts, checkoutPosts: state.checkoutPosts }));
    await secondTab.screenshot({ path: test.info().outputPath("checkout-reviewed-two-tabs.png"), fullPage: true });
    expect(state.quantityPuts).toEqual([2, 3, 1]);
    expect(state.checkoutPosts).toBe(0);
    await secondTab.close();
  } finally {
    await context.close();
    await rm(scratch, { recursive: true, force: true });
  }
});
