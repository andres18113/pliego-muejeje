import { expect, test, type Locator, type Page } from "@playwright/test";

/**
 * The approved Cart, in light mode: a compact centred pair of white cards (lines + Resumen del pedido), the saved
 * books as white cards, ultramar actions and a green saving. These checks read computed styles, so the Cart cannot
 * lose its composition (a stylesheet that stops applying, a shared token re-pointed) without a failure here.
 */
const WHITE = "rgb(255, 255, 255)";
const ULTRAMAR = "rgb(40, 61, 168)";
/** The legacy green action tokens (`--pine`, `--forest` in styles.css): never visible on a PLIEGO page. */
const LEGACY_GREENS = ["rgb(36, 81, 63)", "rgb(32, 61, 50)"];

const line = (index: number, extra: Record<string, unknown>) => ({
  cartItemId: String(100 + index), editionId: String(42 + index), title: index === 0 ? "Cien años de soledad" : "Rayuela",
  authors: index === 0 ? "Gabriel García Márquez" : "Julio Cortázar", sku: `PLG-${index}`, coverUrl: null, quantity: 1,
  currentPrice: "18.50", currentSubtotal: "18.50", available: true, unavailabilityReason: null,
  requiresPhysicalFulfillment: true, quantityEditable: true, ...extra,
});
const savedEdition = { editionId: "77", bookId: "31", title: "Pedro Páramo", authors: "Juan Rulfo", publisher: "Editorial Sur", isbn13: null, price: "12.00",
  coverUrl: null, coverLicense: null, coverAttribution: null, format: "PAPERBACK", language: "es", available: true, favoritedAt: "2026-10-01T12:00:00Z" };

async function install(page: Page) {
  const state = { restored: false, quantityPuts: [] as number[], posts: 0 };
  const cart = () => {
    const items = [
      // Quantity 2 on offer; the saving is the server's own figure.
      line(0, { quantity: state.quantityPuts.at(-1) ?? 2, currentPrice: "63.96", currentSubtotal: "127.92", originalPrice: "79.95", unitSavings: "15.99", originalSubtotal: "159.90", lineSavings: "31.97" }),
      line(1, { originalPrice: "18.50", unitSavings: "0.00", originalSubtotal: "18.50", lineSavings: "0.00" }),
      ...(state.restored ? [line(2, { cartItemId: "177", editionId: "77", title: "Pedro Páramo", authors: "Juan Rulfo", currentPrice: "12.00", currentSubtotal: "12.00" })] : []),
    ];
    return { cartId: "40", requiresPhysicalFulfillment: true, physicalItemCount: items.length, digitalItemCount: 0, state: "ACTIVE", items,
      totalCurrent: "146.42", originalSubtotal: "178.40", savingsTotal: "31.97", currentSubtotal: "146.42", subtotal: "146.42", taxRate: "15.00", taxAmount: "21.96", shippingAmount: "0.00", total: "168.38" };
  };
  await page.addInitScript(() => localStorage.setItem("mantine-color-scheme-value", "light"));
  await page.route("**/api/v1/**", async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    const method = request.method();
    if (path === "/api/v1/auth/refresh") return route.fulfill({ json: { accessToken: "cart-token", tokenType: "Bearer", expiresInSeconds: 1800, user: { userId: "100", email: "ana@example.com", role: "CUSTOMER" } } });
    if (path === "/api/v1/me") return route.fulfill({ json: { customerId: "100", email: "ana@example.com", firstNames: "Ana", lastNames: "Pérez", phone: null, state: "ACTIVE", version: "0" } });
    if (path === "/api/v1/cart") return route.fulfill({ json: cart() });
    if (path === "/api/v1/cart/items" && method === "POST") { state.posts++; state.restored = true; return route.fulfill({ status: 201, json: { cartId: "40", cartItemId: "177", quantity: 1 } }); }
    if (path === "/api/v1/cart/items/100" && method === "PUT") { const quantity = (request.postDataJSON() as { quantity: number }).quantity; state.quantityPuts.push(quantity); return route.fulfill({ json: { cartId: "40", cartItemId: "100", quantity } }); }
    if (path === "/api/v1/me/favorites/status") return route.fulfill({ json: [{ editionId: "77", favorite: true }] });
    if (path === "/api/v1/me/favorites") return route.fulfill({ json: { items: [savedEdition], page: 0, pageSize: 4, totalCount: "1" } });
    if (path.includes("/catalog/editions/")) return route.fulfill({ status: 404, json: { code: "P2041", title: "No disponible", detail: "Edición no disponible." } });
    return route.fulfill({ json: { items: [], page: 0, pageSize: 20, totalCount: "0" } });
  });
  return state;
}

const style = (target: Locator, property: string) => target.evaluate((el, name) => getComputedStyle(el).getPropertyValue(name), property);
const box = async (target: Locator) => (await target.boundingBox())!;

/** Every colour painted inside the page (text, fills, edges), to catch a token that fell back to a legacy value. */
const paintedColours = (page: Page) => page.evaluate(() => {
  const seen = new Set<string>();
  for (const el of document.querySelectorAll<HTMLElement>("body *")) {
    if (!el.getClientRects().length) continue;
    const s = getComputedStyle(el);
    seen.add(s.color); seen.add(s.backgroundColor);
    if (s.borderTopStyle !== "none" && s.borderTopWidth !== "0px") seen.add(s.borderTopColor);
  }
  return [...seen];
});

const channels = (colour: string) => (colour.match(/-?[\d.]+/g) ?? []).map(Number);
/** The saving's restrained green: green leads both other channels. */
const isGreen = (colour: string) => { const [r, g, b] = channels(colour); return g > r + 30 && g > b + 30; };
/** A white or paper-white card surface. */
const isPaperWhite = (colour: string) => { const [r, g, b, a = 1] = channels(colour); return a === 1 && Math.min(r, g, b) >= 245; };

/** Lavender (#e4def4) and its mixes sit well above green in both red and blue; a faint ultramar tint does not. */
function isLavender(colour: string) {
  const [r, g, b, a = 1] = (colour.match(/-?[\d.]+/g) ?? []).map(Number);
  if (colour.startsWith("color(")) return false; // color-mix() results of the ultramar tints
  return a > 0 && r - g > 6 && b - g > 14 && r > 200;
}

async function expectApprovedCart(page: Page, width: number) {
  const flow = page.locator('[data-purchase-stage="cart"]');
  const lines = page.locator("[data-cart-line]");
  const summary = page.getByRole("complementary", { name: "Resumen del pedido" });
  await expect(lines).toHaveCount(2);
  await expect(summary).toBeVisible();

  // Centred, compact: never wider than 1120px, equal space either side.
  const flowBox = await box(flow);
  expect(flowBox.width).toBeLessThanOrEqual(1120.5);
  if (width > 1200) expect(Math.abs(flowBox.x - (width - (flowBox.x + flowBox.width)))).toBeLessThanOrEqual(16);

  // White cards with rounded corners: each line and the summary.
  for (const card of [lines.nth(0), lines.nth(1), summary]) {
    expect(await style(card, "background-color")).toBe(WHITE);
    expect(parseFloat(await style(card, "border-top-left-radius"))).toBeGreaterThanOrEqual(16);
  }
  const first = await box(lines.nth(0));
  const aside = await box(summary);
  if (width >= 960) {
    // Lines and summary side by side, the summary a compact column.
    expect(aside.x).toBeGreaterThanOrEqual(first.x + first.width);
    expect(aside.width).toBeLessThanOrEqual(380.5);
  } else expect(aside.y).toBeGreaterThanOrEqual(first.y + first.height);

  // Cover, title and metadata are one group: the title starts beside the cover on wide lines, inside the card always.
  const title = await box(lines.nth(0).getByRole("heading", { level: 2 }));
  expect(title.x).toBeGreaterThanOrEqual(first.x);
  expect(title.x + title.width).toBeLessThanOrEqual(first.x + first.width + 0.5);

  // Offer line: today's price, the previous one struck, and the green saving strip with Material sell.
  const offer = lines.nth(0);
  await expect(offer.locator("s")).toContainText("159,90");
  const strip = offer.getByText(/Ahorras \$\s*31,97 en este artículo/);
  await expect(strip).toBeVisible();
  await expect(strip.locator("xpath=..").locator(".material-symbol")).toHaveText("sell");
  expect(isGreen(await style(strip, "color")), "saving strip is green").toBe(true);
  // Regular line: no struck price and no strip.
  await expect(lines.nth(1).locator("s")).toHaveCount(0);
  await expect(lines.nth(1).getByText(/Ahorras/)).toHaveCount(0);

  // Line actions sit together at the end of the card, inside it.
  for (const name of ["Guardar", "Quitar"]) {
    const action = await box(offer.getByRole("button").filter({ hasText: name }));
    expect(action.x).toBeGreaterThanOrEqual(first.x);
    expect(action.x + action.width).toBeLessThanOrEqual(first.x + first.width + 0.5);
    expect(action.y + action.height).toBeLessThanOrEqual(first.y + first.height + 0.5);
  }

  // The lightweight quantity control: no filled box, no heavy edge.
  const quantity = offer.getByRole("combobox", { name: "Cantidad de Cien años de soledad" }).or(offer.getByRole("button", { name: /Cantidad de Cien años de soledad/ })).first();
  expect(["rgba(0, 0, 0, 0)", WHITE]).toContain(await style(quantity, "background-color"));

  // The authoritative summary, in order, with the saving in green.
  const rows = await summary.locator("dl > div").evaluateAll((items) => items.map((row) => [row.querySelector("dt")?.textContent, row.querySelector("dd")?.textContent?.replace(/\s+/g, " ")]));
  expect(rows).toEqual([["Subtotal", "$ 178,40"], ["Ahorro total hoy", "-$ 31,97"], ["IVA (15 %)", "$ 21,96"], ["Envío", "$ 0,00"], ["Total", "$ 168,38"]]);
  for (const cell of ["dt", "dd"]) expect(isGreen(await style(summary.locator(`[data-tone="savings"] ${cell}`), "color")), `summary saving ${cell} is green`).toBe(true);

  // The ultramar action.
  const cta = summary.getByRole("link", { name: "Continuar con la compra" });
  expect(await style(cta, "background-color")).toBe(ULTRAMAR);
  expect(await style(cta, "color")).toBe(WHITE);

  // Guardado para después: its books are white cards too.
  const saved = page.locator("[data-cart-saved]");
  await expect(saved.getByRole("heading", { name: "Guardado para después" })).toBeVisible();
  const savedCard = saved.locator("[data-favorite-row]");
  await expect(savedCard).toHaveCount(1);
  expect(isPaperWhite(await style(savedCard, "background-color")), "saved book is a card").toBe(true);
  expect(parseFloat(await style(savedCard, "border-top-left-radius"))).toBeGreaterThanOrEqual(12);

  const colours = await paintedColours(page);
  for (const green of LEGACY_GREENS) expect(colours, `legacy green ${green}`).not.toContain(green);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), "no horizontal overflow").toBe(true);
}

for (const [name, width, height] of [["desktop", 1440, 900], ["1024", 1024, 768], ["390", 390, 844], ["320", 320, 640]] as const) {
  test(`the approved Cart holds its composition at ${name}`, async ({ page }) => {
    await install(page);
    await page.setViewportSize({ width, height });
    await page.goto("/cart");
    await expectApprovedCart(page, width);
    await page.screenshot({ path: test.info().outputPath(`cart-${name}.png`), fullPage: true });
  });
}

test("the approved Cart holds at 200% text", async ({ page }) => {
  await install(page);
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto("/cart");
  await expect(page.locator("[data-cart-line]")).toHaveCount(2);
  await page.addStyleTag({ content: "html { font-size: 200% !important; }" });
  const summary = page.getByRole("complementary", { name: "Resumen del pedido" });
  for (const card of [page.locator("[data-cart-line]").first(), summary]) expect(await style(card, "background-color")).toBe(WHITE);
  expect(isPaperWhite(await style(page.locator("[data-cart-saved] [data-favorite-row]"), "background-color"))).toBe(true);
  expect(await style(summary.getByRole("link", { name: "Continuar con la compra" }), "background-color")).toBe(ULTRAMAR);
  await expect(summary.getByRole("link", { name: "Continuar con la compra" })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: test.info().outputPath("cart-text200.png"), fullPage: true });
});

test("Cart controls work and hover or press without lavender or legacy green", async ({ page }) => {
  const state = await install(page);
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto("/cart");
  const offer = page.locator("[data-cart-line]").first();
  const summary = page.getByRole("complementary", { name: "Resumen del pedido" });
  await expect(offer).toBeVisible();

  // Every interactive control on the page: hover it, then press it without releasing on it.
  const controls = page.locator("main").locator("a, button, [role='combobox']");
  const count = await controls.count();
  expect(count).toBeGreaterThan(6);
  for (let index = 0; index < count; index++) {
    const control = controls.nth(index);
    if (!(await control.isVisible())) continue;
    await control.scrollIntoViewIfNeeded();
    await control.hover();
    await page.waitForTimeout(180);
    const label = (await control.innerText()).trim().split("\n")[0] || (await control.getAttribute("aria-label")) || `#${index}`;
    for (const phase of ["hover", "press"] as const) {
      if (phase === "press") { await page.mouse.down(); await page.waitForTimeout(180); }
      const painted = await control.evaluate((el) => { const s = getComputedStyle(el); return [s.backgroundColor, s.color, s.borderTopColor]; });
      expect(isLavender(painted[0]), `${label} ${phase} fill ${painted[0]}`).toBe(false);
      for (const green of LEGACY_GREENS) expect(painted, `${label} ${phase}`).not.toContain(green);
    }
    await page.mouse.move(2, 2);
    await page.mouse.up();
  }
  await page.keyboard.press("Escape");
  await page.waitForTimeout(300); // let the last hover's colour transition finish
  expect(await style(summary.getByRole("link", { name: "Continuar con la compra" }), "background-color")).toBe(ULTRAMAR);

  // Quantity: choosing another amount sends exactly that amount.
  await offer.getByRole("combobox", { name: "Cantidad de Cien años de soledad" }).or(offer.getByRole("button", { name: /Cantidad de Cien años de soledad/ })).first().click();
  const option = page.getByRole("option", { name: "3", exact: true });
  await option.hover();
  await page.waitForTimeout(150);
  expect(isLavender(await style(option, "background-color")), "quantity option hover").toBe(false);
  await option.click();
  await expect.poll(() => state.quantityPuts).toEqual([3]);

  // Restore: the saved book returns to the cart as a normal white line.
  await page.locator("[data-cart-saved] [data-favorite-row]").getByRole("button", { name: /carrito/i }).click();
  await expect.poll(() => state.posts).toBe(1);
  await expect(page.locator("[data-cart-line]")).toHaveCount(3);
  expect(await style(page.locator("[data-cart-line]").nth(2), "background-color")).toBe(WHITE);
});
