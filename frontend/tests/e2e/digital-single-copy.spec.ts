import { expect, test, type Page } from "@playwright/test";
import { storefrontNavigationFixture } from "../../src/test/storefrontFixture";
import { fillCheckoutBilling } from "./billing-fixtures";

type DigitalState = "available" | "owned" | "pending" | "inCart";
const messages = { owned: "Ya está en tu biblioteca", pending: "Tienes un pedido abierto con esta edición", inCart: "Ya está en tu carrito" };
const labels = { owned: "Ver en Mi biblioteca", pending: "Ver pedido", inCart: "Ver el carrito" };
const compactLabels = { owned: "Mi biblioteca", pending: "Ver pedido", inCart: "Ver carrito" };
const hrefs = { owned: "/biblioteca/800", pending: "/orders/900", inCart: "/cart" };
const synopsis = Array.from({ length: 50 }, (_, i) => `Párrafo ${i + 1} para recorrer esta lectura digital y consultar sus datos.`).join(" ");
const edition = { editionId: "42", bookId: "1", sku: "D42", title: "Una lectura para volver", subtitle: null, authors: [{ name: "Autora Prueba", order: 1 }], publisher: { name: "Editorial" }, categories: [], isbn13: null, pageCount: 312, price: "18.50", coverUrl: null, coverLicense: null, coverAttribution: null, coverSourceUrl: null, format: "EBOOK", language: "es", available: true, ebookFileFormat: "EPUB", audioDurationSeconds: null, narrators: [], synopsis, publicationDate: null,
  offer: { offerId: "7", originalPrice: "25.00", discountAmount: "6.50", effectivePrice: "18.50", savingsAmount: "6.50", savingsPercent: "26.00", startsAt: "2026-10-01T00:00:00Z", endsAt: "2026-12-31T00:00:00Z", daysRemaining: 60, endingSoon: false } };
const digitalLine = { cartItemId: "100", editionId: "42", title: edition.title, authors: "Autora Prueba", sku: "D42", coverUrl: null, quantity: 1, currentPrice: "18.50", currentSubtotal: "18.50", originalPrice: "25.00", unitSavings: "6.50", originalSubtotal: "25.00", lineSavings: "6.50", available: true, requiresPhysicalFulfillment: false, quantityEditable: false, format: "EBOOK", unavailabilityReason: null as string | null };

async function mockCustomer(page: Page, options: { initial?: DigitalState; cart?: boolean; blocked?: "P6002" | "P6003"; checkoutConflict?: "P6002" | "P6003"; addConflict?: "P6002" | "P6003"; missingIds?: boolean; deferEligibility?: boolean } = {}) {
  const state = { digital: options.initial ?? "available", inCart: Boolean(options.cart), adds: 0, checkouts: 0, eligibilityReads: 0, physical: false, acceptedConflict: false };
  let releaseEligibility = () => {};
  const eligibilityGate = options.deferEligibility ? new Promise<void>(resolve => { releaseEligibility = resolve; }) : Promise.resolve();
  await page.route("**/api/v1/**", async route => {
    const request = route.request(), url = new URL(request.url()), path = url.pathname.replace("/api/v1", "");
    const ok = (body: unknown, status = 200) => route.fulfill({ json: body, status });
    const conflict = (code: string) => ok({ type: `urn:pliego:problem:${code}`, status: 409, code, title: "Compra digital bloqueada", detail: "Consulta tu biblioteca o el pedido abierto." }, 409);
    if (path === "/auth/refresh") return ok({ accessToken: "synthetic-digital-token", tokenType: "Bearer", expiresInSeconds: 1800, user: { userId: "2", email: "digital@example.test", role: "CUSTOMER" } });
    if (path === "/storefront/navigation") return ok(storefrontNavigationFixture);
    if (path === "/catalog/editions/42") return ok(edition);
    if (path === "/catalog/editions/43") return ok({ ...edition, editionId: "43", title: "Un libro en papel", format: "PAPERBACK", ebookFileFormat: null });
    if (path === "/me/favorites/status") return ok([{ editionId: "42", favorite: false }]);
    if (path === "/me/favorites") return ok({ items: [], page: 0, pageSize: 20, totalCount: "0" });
    if (path === "/me") return ok({ customerId: "2", email: "digital@example.test", firstNames: "Compradora", lastNames: "Prueba", phone: null, state: "ACTIVE", version: "0" });
    if (path === "/me/billing-identity") return route.fulfill({ status: 204 });
    if (path === "/me/addresses") return ok([]);
    if (path === "/reference/transfer-details") return ok({ bank: "Banco de prueba", beneficiary: "PLIEGO", accountType: "Ahorros", accountNumber: "000000", identification: "0000000000" });
    if (path === "/me/digital-eligibility") {
      state.eligibilityReads++;
      await eligibilityGate;
      const owned = state.digital === "owned" || options.blocked === "P6002" || state.acceptedConflict && options.checkoutConflict === "P6002";
      const pending = state.digital === "pending" || options.blocked === "P6003" || state.acceptedConflict && options.checkoutConflict === "P6003";
      return ok([{ editionId: "42", owned, ownedItemId: owned && !options.missingIds ? "800" : null, pendingOrder: pending, pendingOrderId: pending && !options.missingIds ? "900" : null, inCart: state.digital === "inCart" || state.inCart, purchasable: !owned && !pending }]);
    }
    if (path === "/cart/items" && request.method() === "POST") {
      state.adds++;
      if (options.addConflict) return conflict(options.addConflict);
      const physical = request.postDataJSON().editionId === "43";
      state.inCart = true;
      state.physical ||= physical;
      if (!physical) state.digital = "inCart";
      return ok({ cartItemId: physical ? "101" : "100", quantity: 1 });
    }
    if (path === "/cart") {
      const items: (typeof digitalLine)[] = state.inCart || state.digital === "inCart" ? [{ ...digitalLine, available: !options.blocked, unavailabilityReason: options.blocked ?? null }] : [];
      if (state.physical) items.push({ ...digitalLine, cartItemId: "101", editionId: "43", title: "Un libro en papel", format: "PAPERBACK", requiresPhysicalFulfillment: true, quantityEditable: true });
      return ok({ cartId: items.length ? "40" : null, state: "ACTIVE", requiresPhysicalFulfillment: state.physical, physicalItemCount: state.physical ? 1 : 0, digitalItemCount: items.length ? 1 : 0, items,
        totalCurrent: state.physical ? "37.00" : "18.50", originalSubtotal: state.physical ? "50.00" : "25.00", savingsTotal: state.physical ? "13.00" : "6.50", currentSubtotal: state.physical ? "37.00" : "18.50", subtotal: state.physical ? "37.00" : "18.50", taxRate: "0.00", taxAmount: "0.00", shippingAmount: "0.00", total: state.physical ? "37.00" : "18.50", quoteFingerprint: "a".repeat(64) });
    }
    if (path === "/checkout" && request.method() === "POST") {
      state.checkouts++;
      state.acceptedConflict = true;
      return conflict(options.checkoutConflict ?? "P6002");
    }
    return ok({ code: "NOT_FOUND", title: "Recurso de prueba no disponible", status: 404 }, 404);
  });
  return { state, releaseEligibility };
}

for (const width of [1280, 360]) {
  for (const digital of ["owned", "pending", "inCart"] as const) {
    test(`digital edition ${digital} mirrors its action in the floating pill at ${width}px`, async ({ page }, testInfo) => {
      await page.setViewportSize({ width, height: 800 });
      const { state } = await mockCustomer(page, { initial: digital });
      await page.goto("/catalog/editions/42");
      const scene = page.getByRole("region", { name: "Compra" });
      await expect(scene.getByText(messages[digital], { exact: true })).toBeVisible();
      await expect(scene.getByRole("link", { name: labels[digital], exact: true })).toHaveAttribute("href", hrefs[digital]);
      await expect(scene.getByRole("button", { name: "Agregar al carrito", exact: true })).toHaveCount(0);
      await expect(scene.locator("s")).toHaveText("$ 25,00");
      await page.screenshot({ path: testInfo.outputPath(`edition-${digital}-${width}.png`), fullPage: true });
      const headingTop = await page.getByRole("heading", { level: 1 }).evaluate(node => node.getBoundingClientRect().top + window.scrollY);
      await page.evaluate(() => window.scrollTo(0, 650));
      const bar = page.getByRole("region", { name: "Resumen del libro" });
      await expect(bar).toBeVisible();
      const destination = bar.locator("#context-digital-destination");
      const visibleLabel = width < 600 ? compactLabels[digital] : labels[digital];
      await expect(destination).toHaveText(visibleLabel);
      await expect(destination).toHaveAccessibleName(visibleLabel);
      await expect(destination).toHaveAttribute("href", hrefs[digital]);
      await expect(bar.getByRole("button", { name: /Agregar/ })).toHaveCount(0);
      expect((await bar.boundingBox())!.height).toBe(width < 600 ? 56 : 64);
      expect(await page.getByRole("heading", { level: 1 }).evaluate(node => node.getBoundingClientRect().top + window.scrollY)).toBe(headingTop);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      const boxes = await destination.boundingBox();
      expect(boxes!.x + boxes!.width).toBeLessThanOrEqual(width - 8);
      await page.screenshot({ path: testInfo.outputPath(`edition-${digital}-sticky-${width}.png`) });
      expect(state.adds).toBe(0);
    });
  }

  for (const blocked of [undefined, "P6002", "P6003"] as const) {
    test(`cart and drawer explain the digital copy ${blocked ?? "available"} at ${width}px`, async ({ page }, testInfo) => {
      await page.setViewportSize({ width, height: 800 });
      await mockCustomer(page, { cart: true, blocked });
      // Adding another, physical title opens the shared drawer with the already present digital line.
      await page.goto("/catalog/editions/43");
      await page.getByRole("region", { name: "Compra" }).getByRole("button", { name: "Agregar al carrito", exact: true }).click();
      await page.evaluate(() => window.scrollTo(0, 650));
      await page.getByRole("region", { name: "Resumen del libro" }).getByRole("button", { name: width < 600 ? "Agregar" : "Agregar al carrito", exact: true }).click();
      const drawer = page.getByRole("dialog", { name: "Tu carrito" });
      await expect(drawer.getByText("Copia digital individual")).toBeVisible();
      await expect(drawer.getByRole("combobox", { name: "Cantidad de Un libro en papel" })).toBeVisible();
      if (blocked) {
        await expect(drawer.getByText(blocked === "P6002" ? messages.owned : messages.pending)).toBeVisible();
        await expect(drawer.getByRole("link", { name: blocked === "P6002" ? labels.owned : labels.pending })).toHaveAttribute("href", blocked === "P6002" ? hrefs.owned : hrefs.pending);
        await expect(drawer.getByRole("link", { name: "Continuar con la compra" })).toHaveCount(0);
      }
      await page.screenshot({ path: testInfo.outputPath(`drawer-${blocked ?? "digital"}-${width}.png`) });
      await page.goto("/cart");
      await expect(page.getByText("Copia digital individual")).toBeVisible();
      // The label is always visible; the info toggletip explains the rule on hover, focus, click or tap.
      const info = page.getByRole("button", { name: "Más información sobre la copia digital individual" });
      await expect(info).toHaveAccessibleDescription("Al comprarlo, este título se añade a tu biblioteca digital. Solo puedes adquirirlo una vez por cuenta.");
      const explanation = page.getByRole("tooltip");
      await expect(explanation).toBeHidden();
      if (width < 600) await info.click(); else await info.hover();
      await expect(explanation).toBeVisible();
      await expect(explanation).toBeInViewport({ ratio: 1 });
      if (!blocked) await page.screenshot({ path: testInfo.outputPath(`cart-digital-info-${width}.png`) });
      await page.keyboard.press("Escape");
      await expect(explanation).toBeHidden();
      await info.click();
      await expect(explanation).toBeVisible();
      await page.mouse.click(4, 400);
      await expect(explanation).toBeHidden();
      if (blocked) {
        await expect(page.getByRole("link", { name: blocked === "P6002" ? labels.owned : labels.pending })).toHaveAttribute("href", blocked === "P6002" ? hrefs.owned : hrefs.pending);
        await expect(page.getByRole("button", { name: `Quitar ${edition.title} del carrito` })).toBeVisible();
        await expect(page.getByRole("link", { name: "Continuar con la compra" })).toHaveCount(0);
        const actions = page.locator("[data-cart-line]").first().locator(".text-button");
        const geometry = await actions.evaluateAll(nodes => nodes.map(node => {
          const box = node.getBoundingClientRect();
          const text = document.createRange();
          text.selectNodeContents(node);
          const label = text.getBoundingClientRect();
          return { top: box.top, height: box.height, textTop: label.top, centerOffset: Math.abs((label.top + label.bottom - box.top - box.bottom) / 2) };
        }));
        expect(geometry).toHaveLength(3);
        for (const action of geometry) {
          expect(action.height).toBeGreaterThanOrEqual(44);
          expect(action.centerOffset).toBeLessThanOrEqual(1);
        }
        if (width >= 600) {
          expect(Math.max(...geometry.map(action => action.top)) - Math.min(...geometry.map(action => action.top))).toBeLessThanOrEqual(1);
          expect(Math.max(...geometry.map(action => action.textTop)) - Math.min(...geometry.map(action => action.textTop))).toBeLessThanOrEqual(1);
        }
      }
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await page.screenshot({ path: testInfo.outputPath(`cart-${blocked ?? "digital"}-${width}.png`), fullPage: true });
    });
  }

  for (const code of ["P6002", "P6003"] as const) {
    test(`checkout explains ${code} and ends the attempt at ${width}px`, async ({ page }, testInfo) => {
      await page.setViewportSize({ width, height: 800 });
      const { state } = await mockCustomer(page, { cart: true, checkoutConflict: code });
      await page.goto("/checkout");
      const summary = page.getByRole("complementary");
      await expect(summary.getByText(/Copia digital individual/)).toBeVisible();
      await expect(summary.getByText(/1 unidad ×/)).toHaveCount(0);
      await page.getByRole("button", { name: "Transferencia bancaria" }).click();
      await fillCheckoutBilling(page);
      await page.screenshot({ path: testInfo.outputPath(`checkout-digital-${code}-${width}.png`), fullPage: true });
      await page.getByRole("button", { name: "Hacer pedido" }).click();
      const problem = page.getByRole("alert").filter({ has: page.getByRole("heading", { name: code === "P6002" ? messages.owned : messages.pending, exact: true }) });
      await expect(problem).toBeVisible();
      await expect(problem.getByRole("link", { name: code === "P6002" ? labels.owned : labels.pending })).toHaveAttribute("href", code === "P6002" ? hrefs.owned : hrefs.pending);
      const cartLink = problem.getByRole("link", { name: "Revisar el carrito" });
      await expect(cartLink).toHaveAttribute("href", "/cart");
      await expect(cartLink.locator(".material-symbol")).toHaveCount(0);
      await expect(cartLink).toHaveCSS("margin-top", "0px");
      const destinationLink = problem.getByRole("link", { name: code === "P6002" ? labels.owned : labels.pending });
      const destinationBox = (await destinationLink.boundingBox())!;
      const cartBox = (await cartLink.boundingBox())!;
      expect(Math.abs(cartBox.y + cartBox.height / 2 - destinationBox.y - destinationBox.height / 2)).toBeLessThanOrEqual(2);
      expect(cartBox.x).toBeGreaterThan(destinationBox.x + destinationBox.width);
      await expect(page.getByRole("button", { name: "Hacer pedido" })).toBeDisabled();
      expect(state.checkouts).toBe(1);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await page.screenshot({ path: testInfo.outputPath(`checkout-${code}-${width}.png`), fullPage: true });
    });
  }
}

test("eligibility loading keeps the normal add, then refreshes to inCart after success without resizing the pill", async ({ page }) => {
  const { state, releaseEligibility } = await mockCustomer(page, { deferEligibility: true });
  await page.goto("/catalog/editions/42");
  await expect(page.getByRole("region", { name: "Compra" }).getByRole("button", { name: "Agregar al carrito", exact: true })).toBeVisible();
  await page.evaluate(() => window.scrollTo(0, 650));
  const bar = page.getByRole("region", { name: "Resumen del libro" });
  await expect(bar.getByRole("button", { name: "Agregar al carrito", exact: true })).toBeVisible();
  const before = await bar.boundingBox();
  releaseEligibility();
  await bar.getByRole("button", { name: "Agregar al carrito", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "Tu carrito" })).toBeVisible();
  await page.getByRole("button", { name: "Cerrar carrito" }).click();
  await expect(bar.getByRole("link", { name: "Ver el carrito", exact: true })).toBeVisible();
  await expect(bar.getByRole("link", { name: "Ver el carrito", exact: true })).toBeFocused();
  expect(await bar.boundingBox()).toEqual(before);
  expect(state.adds).toBe(1);
  expect(state.eligibilityReads).toBeGreaterThanOrEqual(2);
});

for (const code of ["P6002", "P6003"] as const) {
  test(`edition add ${code} uses Spanish conflict feedback without opening the drawer`, async ({ page }) => {
    const { state } = await mockCustomer(page, { addConflict: code });
    await page.goto("/catalog/editions/42");
    const scene = page.getByRole("region", { name: "Compra" });
    await scene.getByRole("button", { name: "Agregar al carrito", exact: true }).click();
    await expect(scene.getByText(code === "P6002" ? messages.owned : messages.pending, { exact: true })).toBeVisible();
    await expect(page.getByRole("dialog", { name: "Tu carrito" })).toHaveCount(0);
    expect(state.adds).toBe(1);
  });
}

for (const width of [1280, 360]) {
  test(`the digital-copy explanation stays with its icon: scrolling dismisses it and it never covers the header at ${width}px`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 640 });
    await mockCustomer(page, { cart: true });
    await page.goto("/cart");
    const info = page.getByRole("button", { name: "Más información sobre la copia digital individual" });
    const explanation = page.getByRole("tooltip");
    const header = page.locator("[data-purchase-header]");
    const frames = () => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));

    // Open by press, then scroll down and back up: dismissed on the first scroll and not reopened by scrolling back.
    await info.click();
    await expect(explanation).toBeVisible();
    await frames();
    await page.mouse.wheel(0, 240);
    await expect(explanation).toBeHidden();
    await page.mouse.wheel(0, -240);
    await frames();
    await expect(explanation).toBeHidden();

    // With the icon just under the sticky header there is no room above it: it opens below, clear of the header.
    const headerBottom = (await header.boundingBox())!.y + (await header.boundingBox())!.height;
    await info.evaluate((node, gap) => { window.scrollBy(0, node.getBoundingClientRect().top - gap); }, headerBottom + 16);
    await frames();
    await info.click();
    await expect(explanation).toBeVisible();
    const [icon, sheet] = [(await info.boundingBox())!, (await explanation.boundingBox())!];
    expect(sheet.y).toBeGreaterThanOrEqual(headerBottom);
    expect(sheet.y).toBeGreaterThanOrEqual(icon.y + icon.height - 1);
    expect(sheet.y - (icon.y + icon.height)).toBeLessThanOrEqual(20);
    await expect(explanation).toBeInViewport({ ratio: 1 });
    await page.screenshot({ path: testInfo.outputPath(`info-below-header-${width}.png`) });
    // Keyboard focus that scrolls the button into view keeps it open; Escape still closes it.
    await page.keyboard.press("Escape");
    await expect(explanation).toBeHidden();

    // Inside the cart drawer, a scroll of its own list (a nested container) dismisses it too.
    // (Only an add from the floating bar answers with the drawer; the scene's add answers in place.)
    await page.goto("/catalog/editions/43");
    await page.evaluate(() => window.scrollTo(0, 650));
    await page.getByRole("region", { name: "Resumen del libro" }).getByRole("button", { name: width < 600 ? "Agregar" : "Agregar al carrito", exact: true }).click();
    const drawer = page.getByRole("dialog", { name: "Tu carrito" });
    const drawerInfo = drawer.getByRole("button", { name: "Más información sobre la copia digital individual" });
    await drawerInfo.click();
    await expect(explanation).toBeVisible();
    await frames();
    await drawerInfo.evaluate((node) => {
      let scroller: HTMLElement | null = node.parentElement;
      while (scroller && !/(auto|scroll)/.test(getComputedStyle(scroller).overflowY)) scroller = scroller.parentElement;
      (scroller ?? document.documentElement).dispatchEvent(new Event("scroll"));
    });
    await expect(explanation).toBeHidden();
    await expect(drawer).toBeVisible();
  });
}

test("tabbing to the explanation's button keeps it open even when focus scrolls the button into view", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 400 });
  await mockCustomer(page, { cart: true });
  await page.goto("/cart");
  const info = page.getByRole("button", { name: "Más información sobre la copia digital individual" });
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
  await info.focus();
  await expect(page.getByRole("tooltip")).toBeVisible();
  await page.waitForTimeout(150);
  await expect(page.getByRole("tooltip")).toBeVisible();
});
