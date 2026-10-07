import { expect, test, type Page } from "@playwright/test";
import { orderDetailFixture } from "../../src/test/orders";

const owned = { ownedItemId: "8", editionId: "42", coverUrl: null, title: "Libro propio", authors: "Autora", productType: "EBOOK", acquiredAt: "2026-10-05T10:00:00Z", ownershipState: "OWNED", accessState: "OWNERSHIP_ONLY", contentAccessSupported: false,
  metadata: { isbn: "9780306406157", publisher: "Editorial", language: "es", pageCount: 120, publicationDate: "2020-01-01", ebookFileFormat: "EPUB", audioDurationSeconds: null, narrators: [] },
  sourcePurchases: [{ orderId: "700", orderItemId: "1", acquiredAt: "2026-10-05T10:00:00Z", paymentState: "APPROVED", orderState: "CONFIRMED", grantState: "ACTIVE" }], availableActions: [{ type: "VIEW_ORDER", label: "Ver pedido", href: "/orders/700" }, { type: "HELP", label: "Ayuda", href: "/ayuda/ebooks" }] };
const help = { slug: "ebooks", categorySlug: "digital", title: "Cómo funcionan los eBooks", summary: "Titularidad digital", body: "Tu cuenta registra la titularidad del título adquirido.", position: 1, applicability: "EBOOK" };
async function install(page: Page, mixed = false) {
  const checkout: unknown[] = [];
  const physicalReads: string[] = [];
  const formats = mixed ? ["PAPERBACK", "EBOOK"] : ["EBOOK"];
  await page.route("https://www.openstreetmap.org/**", route => route.fulfill({ contentType: "text/html", body: "<!doctype html><title>Mapa</title>" }));
  await page.route("**/api/v1/**", route => {
    const request = route.request(); const url = new URL(request.url()); const path = url.pathname;
    const json = (body: unknown, status = 200) => route.fulfill({ status, json: body });
    if (path === "/api/v1/auth/refresh") return json({ accessToken: "test-token", tokenType: "Bearer", expiresInSeconds: 1800, user: { userId: "2", email: "ana@example.com", role: "CUSTOMER" } });
    if (path === "/api/v1/me") return json({ customerId: "2", email: "ana@example.com", firstNames: "Ana", lastNames: "Pérez", phone: null, state: "ACTIVE", version: "0" });
    if (path === "/api/v1/cart") return json({ cartId: "40", state: "ACTIVE", requiresPhysicalFulfillment: mixed, physicalItemCount: mixed ? 1 : 0, digitalItemCount: 1, totalCurrent: mixed ? "37.00" : "18.50", items: formats.map((format, index) => ({ cartItemId: String(index + 1), editionId: String(42 + index), title: format === "EBOOK" ? "Libro propio" : "Libro físico", authors: "Autora", sku: "TEST", coverUrl: null, quantity: 1, currentPrice: "18.50", currentSubtotal: "18.50", available: true, format, requiresPhysicalFulfillment: format === "PAPERBACK", quantityEditable: format === "PAPERBACK", unavailabilityReason: null })) });
    if (path === "/api/v1/me/addresses") { physicalReads.push(path); return json([{ addressId: "15", alias: "Casa", recipient: "Ana Pérez", line1: "Av. Principal 123", line2: null, city: "Quito", province: "Pichincha", countryCode: "EC", postalCode: null, reference: null, phone: "+59325550134", primary: true }]); }
    if (path === "/api/v1/pickup-locations") { physicalReads.push(path); return json([]); }
    if (path === "/api/v1/reference/transfer-details") return json({ bank: "Banco Guayaquil", beneficiary: "PLIEGO", accountType: "Ahorros", accountNumber: "2557897233", identification: "1751550656" });
    if (path === "/api/v1/me/library") return json({ items: url.searchParams.get("productType") === "AUDIOBOOK" ? [] : [owned], page: 0, pageSize: 20, totalCount: url.searchParams.get("productType") === "AUDIOBOOK" ? "0" : "1" });
    if (path === "/api/v1/me/library/8") return json(owned);
    if (path === "/api/v1/help/categories") return json({ items: [{ slug: "digital", title: "Digital", position: 1, applicability: "GENERAL" }] });
    if (path === "/api/v1/help/articles") return json({ items: [help], page: 0, pageSize: 20, totalCount: "1" });
    if (path === "/api/v1/help/articles/ebooks") return json(help);
    if (path === "/api/v1/checkout") { checkout.push(request.postDataJSON()); return json({ orderId: "700", orderState: "CONFIRMED", paymentState: "APPROVED", total: mixed ? "37.00" : "18.50", paymentReference: "SIM-1", fulfillment: mixed ? { method: "HOME_DELIVERY" } : null }, 201); }
    if (path === "/api/v1/orders/700") return json(orderDetailFixture("PREPARING", { fulfillment: mixed ? { method: "HOME_DELIVERY" } : null, shipment: mixed ? orderDetailFixture().shipment : null, items: formats.map((format, index) => ({ orderItemId: String(index + 1), editionId: String(42 + index), title: format === "EBOOK" ? "Libro propio" : "Libro físico", authors: "Autora", publisher: "Editorial", format, requiresPhysicalFulfillment: format === "PAPERBACK", unitPrice: "18.50", quantity: 1, subtotal: "18.50" })) }));
    if (/^\/api\/v1\/catalog\/editions\//.test(path)) return json({ editionId: "42", available: true });
    return json({ items: [], page: 0, pageSize: 20, totalCount: "0" });
  });
  return { checkout, physicalReads };
}

for (const width of [375, 768, 1280]) {
  for (const movedFocus of [false, true]) {
    test(`delayed library detail restores reading focus at ${width}px; user moved focus=${movedFocus}`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await install(page);
      let finish: () => void = () => {};
      const response = new Promise<void>(resolve => { finish = resolve; });
      await page.route("**/api/v1/me/library/8", async route => { await response; await route.fulfill({ json: owned }); });
      await page.goto("/biblioteca");
      const title = page.getByRole("link", { name: "Libro propio", exact: true });
      await title.focus();
      await title.press("Enter");
      await expect(page).toHaveURL(/\/biblioteca\/8$/);
      await expect(page.getByRole("status").filter({ hasText: "Cargando adquisición…" })).toBeAttached();
      const control = page.locator("header a").first();
      if (movedFocus) await control.focus();
      finish();
      const heading = page.getByRole("heading", { name: "Libro propio", exact: true });
      await expect(heading).toBeVisible();
      if (movedFocus) await expect(control).toBeFocused();
      else await expect(heading).toBeFocused();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
    });
  }
}

test("owned title filters open detail with only genuine purchase and Help actions", async ({ page }) => {
  await install(page); await page.goto("/biblioteca");
  await expect(page.getByRole("heading", { name: "Mi biblioteca", exact: true })).toBeVisible();
  const filters = page.getByRole("group", { name: "Mostrar" });
  await filters.getByRole("button", { name: "Audiolibros" }).click();
  await expect(page.getByRole("heading", { name: "Aún no tienes audiolibros." })).toBeVisible();
  await filters.getByRole("button", { name: "eBooks" }).click();
  // The filters are the thin chips approved on Ofertas: compact, the chosen one an ultramar outline and text on a
  // faint wash — never a solid pill, never a dot.
  const chosen = filters.getByRole("button", { name: "eBooks" });
  await expect(chosen).toHaveAttribute("aria-pressed", "true");
  await expect(chosen).toHaveCSS("color", "rgb(40, 61, 168)");
  await expect(chosen).toHaveCSS("min-height", "36px");
  expect(await chosen.evaluate((el) => getComputedStyle(el).backgroundColor)).not.toBe("rgb(40, 61, 168)");
  expect(await chosen.evaluate((el) => getComputedStyle(el, "::before").content)).toBe("none");
  // An owned title is a white card whatever its format; the small media cue names the format.
  const card = page.locator("li", { has: page.getByRole("link", { name: "Libro propio", exact: true }) });
  await expect(card).toHaveCSS("background-color", "rgb(255, 255, 255)");
  await expect(card.locator("p", { hasText: /^\s*mobile\s*eBook$|eBook/ }).first().locator(".material-symbol")).toHaveText("mobile");
  await page.screenshot({ path: test.info().outputPath("library.png") });
  await page.getByRole("link", { name: "Libro propio", exact: true }).click();
  await expect(page).toHaveURL(/\/biblioteca\/8$/);
  await expect(page.getByText("Pertenece a tu cuenta", { exact: true })).toBeVisible();
  await expect(page.getByText(/simulación|Registro de titularidad/)).toHaveCount(0);
  await expect(page.locator('[class*="scene"]').first()).toHaveCSS("background-color", "rgb(255, 255, 255)");
  await expect(page.locator('[class*="purchase_"], [class*="_purchase"]').locator("visible=true").first()).toBeVisible();
  await page.waitForTimeout(200);
  await page.screenshot({ path: test.info().outputPath("library-detail.png"), fullPage: true });
  await expect(page.getByRole("navigation", { name: "Acciones de la adquisición" }).getByRole("link")).toHaveCount(2);
  await expect(page.getByRole("link", { name: /^Leer$|^Escuchar$|Continuar/ })).toHaveCount(0);
  await page.getByRole("navigation", { name: "Acciones de la adquisición" }).getByRole("link", { name: "Ayuda" }).click();
  await expect(page.getByRole("heading", { name: "Cómo funcionan los eBooks" })).toBeVisible();
});

test("Help search keeps backend applicability and opens a published article", async ({ page }) => {
  await install(page); await page.goto("/ayuda");
  // Resources first: a calm opening and the published articles as white cards; no search, chips or filters.
  await expect(page.getByRole("heading", { level: 1, name: "Estamos aquí para ayudarte." })).toBeVisible();
  await expect(page.getByRole("heading", { level: 2, name: "Echa un vistazo a estos recursos de asistencia" })).toBeVisible();
  await expect(page.getByRole("search")).toHaveCount(0);
  await expect(page.getByRole("main").getByRole("combobox")).toHaveCount(0);
  await expect(page.getByRole("main").locator("button[aria-pressed]")).toHaveCount(0);
  const card = page.locator("li", { has: page.getByRole("link", { name: "Cómo funcionan los eBooks" }) });
  await expect(card).toHaveCSS("background-color", "rgb(255, 255, 255)");
  await expect(card.locator(".material-symbol").first()).toHaveText("mobile");
  await page.screenshot({ path: test.info().outputPath("help.png"), fullPage: true });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  // Links that narrow the resources still work from the address alone.
  await page.goto("/ayuda?category=digital&applicability=EBOOK");
  await expect(page.getByText("Recursos sobre Digital, eBooks.")).toBeVisible();
  await expect(page.getByRole("link", { name: "Ver todos los recursos" })).toHaveAttribute("href", "/ayuda");
  await page.getByRole("link", { name: "Cómo funcionan los eBooks" }).click();
  await expect(page.getByText("Tu cuenta registra la titularidad del título adquirido.")).toBeVisible();
  // The closing card is white, never lavender.
  const onward = page.getByRole("complementary", { name: "Más ayuda" });
  await expect(onward.getByRole("heading", { name: "¿Necesitas algo más?" })).toBeVisible();
  await expect(onward).toHaveCSS("background-color", "rgb(255, 255, 255)");
  await expect(page.getByRole("link", { name: "Volver a Ayuda" })).toBeVisible();
  await page.screenshot({ path: test.info().outputPath("help-article.png"), fullPage: true });
});

for (const mixed of [false, true]) test(`${mixed ? "mixed" : "digital-only"} checkout submits one commercial command with the proper destination`, async ({ page }) => {
  const api = await install(page, mixed); await page.goto("/checkout");
  await expect(page.getByRole("heading", { name: "Pago", exact: true })).toBeVisible();
  if (mixed) { await expect(page.getByRole("tab", { name: "Entrega", exact: true })).toBeVisible(); await expect(page.getByText("Av. Principal 123", { exact: true })).toBeVisible(); }
  else { await expect(page.getByRole("tab", { name: "Entrega", exact: true })).toHaveCount(0); expect(api.physicalReads).toEqual([]); }
  await page.getByRole("button", { name: "Transferencia bancaria", exact: true }).click();
  await expect(page.getByText("Banco Guayaquil", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Hacer pedido", exact: true }).click();
  await expect(page).toHaveURL(/\/orders\/700$/);
  expect(api.checkout).toEqual([{ ...(mixed ? { fulfillmentMethod: "HOME_DELIVERY", addressId: "15" } : { fulfillmentMethod: "DIGITAL_ONLY" }), expectedCartId: "40", paymentMethod: "TRANSFER", simulationOutcome: "APPROVED" }]);
  if (!mixed) { expect(api.physicalReads).toEqual([]); await expect(page.getByRole("region", { name: "Destino confirmado" })).toHaveCount(0); }
});
