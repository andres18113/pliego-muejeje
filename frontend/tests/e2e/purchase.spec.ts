import { expect, test, type Page, type Route } from "@playwright/test";

/** Account pages are reached from the header's account menu. */
async function openAccountSection(page: import("@playwright/test").Page, name: "Perfil" | "Direcciones" | "Favoritos" | "Pedidos") {
  await page.getByRole("button", { name: "Menú de cuenta" }).click();
  await page.getByRole("menuitem", { name, exact: true }).click();
}

const edition = {
  editionId: "42",
  bookId: "17",
  title: "Cien años de soledad",
  subtitle: null,
  synopsis: "Una historia familiar en Macondo.",
  authors: [{ authorId: "9", name: "Gabriel García Márquez", order: 1 }],
  categories: [{ slug: "narrativa", name: "Narrativa", parentSlug: null }],
  publisher: { publisherId: "5", name: "Editorial Sur" },
  isbn13: "9780306406157",
  sku: "PLG-LIT-042",
  language: "es",
  format: "PAPERBACK",
  pageCount: 496,
  publicationDate: "1967-05-30",
  price: "18.50",
  coverUrl: null,
  coverLicense: null,
  coverSourceUrl: null,
  coverAttribution: null,
  available: true,
};

type Line = { cartItemId: string; editionId: string; quantity: number };
type Order = { orderId: string; orderState: string; paymentState: string; method: string; total: string; reference: string | null; quantity: number };

/**
 * In-memory stand-in for the v1 REST contract: the "server" owns prices, totals, stock, and
 * order creation, and reports domain failures with canonical SQLSTATE codes.
 */
class FakePliego {
  stock = 5;
  lines: Line[] = [];
  addresses: Record<string, unknown>[] = [];
  orders: Order[] = [];
  checkoutAttempts = new Map<string, Order>();
  addPosts = 0;
  checkoutPosts = 0;
  loseNextCheckoutResponse = false;
  rejectNextCheckout = false;

  async install(page: Page) {
    await page.route("**/api/v1/**", (route) => this.handle(route));
  }

  private cart() {
    const items = this.lines.map((line) => ({
      cartItemId: line.cartItemId,
      editionId: line.editionId,
      title: edition.title,
      authors: "Gabriel García Márquez",
      sku: edition.sku,
      coverUrl: null,
      quantity: line.quantity,
      currentPrice: edition.price,
      currentSubtotal: (Number(edition.price) * line.quantity).toFixed(2),
      available: this.stock >= line.quantity,
      unavailabilityReason: this.stock >= line.quantity ? null : "P3002",
    }));
    return {
      cartId: items.length ? "40" : null,
      requiresPhysicalFulfillment: items.length > 0,
      physicalItemCount: items.length,
      digitalItemCount: 0,
      state: items.length ? "ACTIVE" : null,
      items,
      totalCurrent: items.reduce((sum, item) => sum + Number(item.currentSubtotal), 0).toFixed(2),
    };
  }

  private async handle(route: Route) {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname.replace("/api/v1", "");
    const method = request.method();
    const body = request.postData() ? JSON.parse(request.postData()!) : undefined;
    const ok = (payload: unknown, status = 200) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(payload) });
    const fail = (status: number, code: string, title: string, detail: string) => route.fulfill({
      status,
      contentType: "application/problem+json",
      body: JSON.stringify({ type: `urn:pliego:problem:${code}`, title, status, detail, code, traceId: "e2e" }),
    });

    if (/^\/checkout\/attempts\/[^/]+\/resolve$/.test(path) && method === "POST") {
      const order = this.checkoutAttempts.get(path.split("/")[3]);
      return ok(order ? { state: "CREATED", order: { orderId: order.orderId, orderState: order.orderState, paymentState: order.paymentState, total: order.total, paymentReference: order.reference } } : { state: "NOT_CREATED", order: null });
    }
    if (path === "/auth/refresh") return route.fulfill({ status: 204 });
    if (path === "/auth/login") {
      return ok({ accessToken: "e2e-token", tokenType: "Bearer", expiresInSeconds: 1800, user: { userId: "100", email: "ana@example.com", role: "CUSTOMER" } });
    }
    if (path === "/me" && method === "GET") return ok({ customerId: "100", email: "ana@example.com", firstNames: "Ana", lastNames: "Pérez", phone: null, state: "ACTIVE", version: "0" });
    if (path === "/reference/countries") return ok([{ code: "EC", name: "Ecuador" }, { code: "CO", name: "Colombia" }]);
    if (path === "/reference/transfer-details") return ok({ bank: "Banco Guayaquil", beneficiary: "PLIEGO", accountType: "Ahorros", accountNumber: "2557897233", identification: "1751550656" });
    if (path === "/catalog/categories") return ok({ items: [{ slug: "narrativa", name: "Narrativa", parentSlug: null }] });
    if (path === "/catalog/filter-options") return ok({ languages: ["es"], minimumPrice: "18.50", maximumPrice: "18.50" });
    if (path === "/catalog/editions/42") return ok({ ...edition, available: this.stock > 0 });
    if (path === "/catalog/editions") {
      return ok({ items: [{ ...edition, authors: "Gabriel García Márquez", publisher: "Editorial Sur", available: this.stock > 0 }], page: 0, pageSize: 20, totalCount: "1" });
    }
    if (path === "/me/favorites/status") {
      return ok(url.searchParams.getAll("editionIds").map((editionId) => ({ editionId, favorite: false })));
    }

    if (path === "/cart" && method === "GET") return ok(this.cart());
    if (path === "/cart/items" && method === "POST") {
      this.addPosts += 1;
      const existing = this.lines.find((line) => line.editionId === body.editionId);
      const quantity = (existing?.quantity ?? 0) + body.quantity;
      if (quantity > this.stock) return fail(409, "P3002", "Existencias insuficientes", "No hay existencias suficientes para la cantidad solicitada.");
      if (existing) existing.quantity = quantity;
      else this.lines.push({ cartItemId: String(100 + this.lines.length), editionId: body.editionId, quantity });
      const line = this.lines.find((candidate) => candidate.editionId === body.editionId)!;
      return ok({ cartId: "40", cartItemId: line.cartItemId, quantity: line.quantity });
    }
    const itemMatch = /^\/cart\/items\/(\d+)$/.exec(path);
    if (itemMatch) {
      const line = this.lines.find((candidate) => candidate.cartItemId === itemMatch[1]);
      if (!line) return fail(404, "P4003", "Artículo no encontrado", "El artículo ya no está en el carrito.");
      if (method === "DELETE") {
        this.lines = this.lines.filter((candidate) => candidate !== line);
        return route.fulfill({ status: 204 });
      }
      if (body.quantity > this.stock) return fail(409, "P3002", "Existencias insuficientes", "No hay existencias suficientes para la cantidad solicitada.");
      line.quantity = body.quantity;
      return ok({ cartId: "40", cartItemId: line.cartItemId, quantity: line.quantity });
    }

    if (path === "/me/addresses" && method === "GET") return ok(this.addresses);
    if (path === "/me/addresses" && method === "POST") {
      const addressId = String(15 + this.addresses.length);
      this.addresses.push({ addressId, ...body, primary: body.makePrimary || this.addresses.length === 0 });
      return ok({ addressId }, 201);
    }

    if (path === "/checkout") {
      this.checkoutPosts += 1;
      const cart = this.cart();
      if (!cart.items.length) return fail(409, "P4002", "Carrito vacío", "Agrega al menos un libro antes de finalizar la compra.");
      if (cart.items.some((item) => !item.available)) return fail(409, "P3002", "Existencias insuficientes", "Uno o más libros ya no tienen existencias suficientes.");
      const approved = body.simulationOutcome === "APPROVED" && !this.rejectNextCheckout;
      this.rejectNextCheckout = false;
      const quantity = cart.items.reduce((sum, item) => sum + item.quantity, 0);
      const order: Order = {
        orderId: String(700 + this.orders.length),
        orderState: approved ? "CONFIRMED" : "CANCELLED",
        paymentState: approved ? "APPROVED" : "REJECTED",
        method: body.paymentMethod,
        total: cart.totalCurrent,
        reference: approved ? `SIM-e2e-${this.orders.length}` : null,
        quantity,
      };
      this.orders.unshift(order);
      this.checkoutAttempts.set(request.headers()["idempotency-key"], order);
      if (approved) {
        this.stock -= quantity;
        this.lines = [];
      }
      if (this.loseNextCheckoutResponse) {
        this.loseNextCheckoutResponse = false;
        return route.abort("connectionreset");
      }
      return ok({ orderId: order.orderId, orderState: order.orderState, paymentState: order.paymentState, total: order.total, paymentReference: order.reference }, 201);
    }
    if (path === "/orders") {
      return ok({ items: this.orders.map((order) => ({
        orderId: order.orderId, createdAt: "2026-09-27T21:50:06Z", orderState: order.orderState, total: order.total, paymentState: order.paymentState,
        purchaseState: order.orderState === "CANCELLED" ? "CANCELLED" : "CONFIRMED", fulfillmentMethod: "HOME_DELIVERY",
        shipmentState: order.orderState === "CANCELLED" ? "CANCELLED" : "PENDING", estimatedDeliveryFrom: null, estimatedDeliveryTo: null,
        itemCount: 1, unitCount: order.quantity, itemSummary: [{ orderItemId: "1", title: edition.title, format: "PAPERBACK", quantity: order.quantity }],
        invoiceState: null, invoicePdfAvailable: false, invoiceXmlAvailable: false,
      })), page: 0, pageSize: 5, totalCount: String(this.orders.length) });
    }
    const orderMatch = /^\/orders\/(\d+)$/.exec(path);
    if (orderMatch) {
      const order = this.orders.find((candidate) => candidate.orderId === orderMatch[1]);
      if (!order) return fail(404, "P5001", "Pedido no disponible", "No encontramos el pedido.");
      return ok({
        orderId: order.orderId,
        orderState: order.orderState,
        subtotal: order.total,
        total: order.total,
        items: [{ orderItemId: "1", editionId: "42", title: edition.title, authors: "Gabriel García Márquez", publisher: "Editorial Sur", format: "PAPERBACK", unitPrice: edition.price, quantity: order.quantity, subtotal: order.total }],
        address: { recipient: "Ana Pérez", line1: "Av. Amazonas 100", line2: null, city: "Quito", province: "Pichincha", countryCode: "EC", postalCode: null, reference: null, phone: "+593991234567" },
        payment: { method: order.method, state: order.paymentState, amount: order.total, reference: order.reference },
        stateHistory: [],
        // API v1.0.8 projections; the server, not the client, decides cancellation.
        purchaseState: order.orderState === "CANCELLED" ? "CANCELLED" : "CONFIRMED",
        fulfillment: { method: "HOME_DELIVERY" },
        shipment: {
          shipmentId: order.orderId, state: order.orderState === "CANCELLED" ? "CANCELLED" : "PENDING", carrier: null, trackingCode: null, trackingUrl: null,
          estimatedDeliveryFrom: null, estimatedDeliveryTo: null, createdAt: "2026-09-27T21:50:06Z", preparingAt: null, shippedAt: null,
          outForDeliveryAt: null, deliveredAt: null, canceledAt: null, history: [],
        },
        invoice: null,
        creditNotes: [],
        availableActions: { cancel: order.orderState === "CONFIRMED", changeShippingAddress: false },
      });
    }
    return fail(404, "NOT_FOUND", "Recurso no encontrado", path);
  }
}

async function signInAndAdd(page: Page, api: FakePliego, screenshots?: { pending: string; added: string; cart: string }) {
  await page.goto("/catalog/editions/42");
  await page.getByRole("link", { name: "Iniciar sesión para agregar" }).click();
  await page.getByLabel("Correo electrónico").fill("ana@example.com");
  await page.getByLabel("Contraseña").fill("lectura-segura");
  await page.getByRole("button", { name: "Iniciar sesión" }).click();
  await expect(page).toHaveURL(/\/catalog\/editions\/42$/);
  const addButton = page.locator("main.detail-route .button-primary");
  const pageBox = () => addButton.evaluate((button) => {
    const rect = button.getBoundingClientRect();
    return { x: rect.left + window.scrollX, y: rect.top + window.scrollY, width: rect.width, height: rect.height };
  });
  const idleBox = await pageBox();
  const addStartedAt = Date.now();
  await addButton.dblclick();
  await expect(addButton).toHaveAttribute("aria-busy", "true");
  await expect(page.getByRole("button", { name: "Agregando…" })).toBeVisible();
  const pendingBox = await pageBox();
  expect(Math.abs(pendingBox.x - idleBox.x)).toBeLessThanOrEqual(1);
  expect(Math.abs(pendingBox.y - idleBox.y)).toBeLessThanOrEqual(1);
  expect(pendingBox.width).toBeCloseTo(idleBox.width, 0);
  expect(pendingBox.height).toBeCloseTo(idleBox.height, 0);
  if (screenshots) await page.screenshot({ path: screenshots.pending, fullPage: true });
  await expect(page.getByText("Edición agregada al carrito. Ahora tienes 1 unidad de esta edición.")).toBeAttached();
  await expect(page.getByRole("button", { name: "Agregado" })).toBeVisible();
  expect(Date.now() - addStartedAt).toBeGreaterThanOrEqual(500);
  const successBox = await pageBox();
  expect(Math.abs(successBox.x - idleBox.x)).toBeLessThanOrEqual(1);
  expect(Math.abs(successBox.y - idleBox.y)).toBeLessThanOrEqual(1);
  expect(successBox.width).toBeCloseTo(idleBox.width, 0);
  expect(successBox.height).toBeCloseTo(idleBox.height, 0);
  await expect(addButton).toBeFocused();
  await expect(page.getByTestId("header-cart-count")).toHaveText("1");
  expect(api.addPosts).toBe(1);
  if (screenshots) await page.screenshot({ path: screenshots.added, fullPage: true });
  await page.getByRole("link", { name: "Ver el carrito" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Tu carrito" })).toBeVisible();
  if (screenshots) await page.screenshot({ path: screenshots.cart, fullPage: true });
}

async function saveFirstAddress(page: Page) {
  await page.getByRole("button", { name: "Añadir dirección" }).click();
  await expect(page.getByRole("dialog", { name: "Nueva dirección" })).toBeVisible();
  await page.getByLabel("Dirección", { exact: true }).fill("Av. Amazonas 100");
  await page.getByLabel("Ciudad").fill("Quito");
  await page.getByLabel("Provincia").fill("Pichincha");
  await page.getByLabel("Teléfono de contacto").fill("0991234567");
  await page.getByRole("button", { name: "Guardar dirección" }).click();
  await expect(page.locator('[data-purchase="selected-address"]')).toContainText("Av. Amazonas 100");
}

async function expectNoHorizontalOverflow(page: Page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);
}

for (const viewport of [{ name: "desktop", width: 1280, height: 900 }, { name: "tablet", width: 768, height: 1024 }, { name: "mobile", width: 390, height: 844 }, { name: "small mobile", width: 320, height: 720 }]) {
  test(`completes the CUSTOMER purchase from edition to confirmation on ${viewport.name}`, async ({ page }, testInfo) => {
    await page.setViewportSize(viewport);
    const api = new FakePliego();
    await api.install(page);

    await signInAndAdd(page, api, {
      pending: testInfo.outputPath("edition-adding.png"),
      added: testInfo.outputPath("edition-added.png"),
      cart: testInfo.outputPath("cart-open.png"),
    });
    await page.getByRole("combobox", { name: "Cantidad de Cien años de soledad" }).click();
    await page.getByRole("option", { name: "2" }).click();
    await expect(page.getByText("Cantidad actualizada: 2 unidades.")).toBeVisible();
    await expect(page.locator('[data-purchase="total"] dd')).toHaveText(/37,00/);
    await expectNoHorizontalOverflow(page);

    await page.getByRole("link", { name: "Continuar con la compra" }).click();
    await expect(page.getByRole("heading", { level: 1, name: "Finalizar compra" })).toBeVisible();
    await saveFirstAddress(page);
    await page.locator('[data-purchase="payment-method"]').filter({ hasText: "Tarjeta" }).click();
    await expect(page.getByRole("dialog", { name: "Tarjeta de crédito o débito" })).toBeVisible();
    for (const brand of ["Visa", "Mastercard", "American Express", "Diners Club"]) {
      await expect(page.getByRole("img", { name: brand })).toBeVisible();
    }
    await expectNoHorizontalOverflow(page);
    await page.screenshot({ path: testInfo.outputPath("card-ready.png"), fullPage: true });
    await page.getByLabel("Número de tarjeta").fill("4111 1111 1111 1111");
    await page.getByLabel("Caducidad (MM/AA)").fill("12/30");
    await page.getByLabel("Código de seguridad", { exact: true }).fill("123");
    await page.getByLabel("Nombre en la tarjeta").fill("Ana Pérez");
    await page.getByRole("button", { name: "Usar esta tarjeta" }).click();
    await expect(page.locator('[data-purchase="chosen-payment"]')).toContainText("Visa-1111");
    await expect(page.getByRole("button", { name: "Cambiar método de pago" })).toBeFocused();
    await expectNoHorizontalOverflow(page);
    await page.screenshot({ path: testInfo.outputPath("card-chosen.png"), fullPage: true });
    await page.getByRole("button", { name: "Hacer pedido" }).click();

    await expect(page.locator('[data-purchase="summary"] [role="status"]')).toContainText("Creando tu pedido simulado");
    await expect(page).toHaveURL(/\/orders\/700$/);
    // Confirmation separates the immediate destination/action from the commercial information below.
    await expect(page.getByRole("heading", { level: 1, name: "Es momento de celebrar" })).toBeFocused();
    await expect(page.locator('[data-confirmation="details"]')).not.toContainText("SIM-e2e-0");
    await expect(page.locator('[data-confirmation="fulfillment"]')).toContainText(edition.title);
    await expect(page.locator('[data-purchase="total"] dd')).toHaveText(/37,00/);
    await expectNoHorizontalOverflow(page);
    await page.screenshot({ path: testInfo.outputPath("confirmation.png"), fullPage: true });
    await page.getByRole("complementary", { name: "Tu pedido" }).getByRole("link", { name: "Ver pedido completo" }).click();
    await expect(page.getByRole("heading", { level: 2, name: "Pedido confirmado" })).toBeVisible();
    await expect(page.getByRole("heading", { level: 1, name: "Detalle del pedido" })).toBeVisible();
    await expect(page.getByText("SIM-e2e-0")).toHaveCount(0);
    await expect(page.getByText("4111")).toHaveCount(0);
    await expect(page.getByRole("banner").getByRole("link", { name: /^Carrito/ })).toContainText("0");
    await expectNoHorizontalOverflow(page);
    expect(api.checkoutPosts).toBe(1);
    expect(api.stock).toBe(3);
  });
}

test("advances valid card details as they are typed without moving focus for invalid values", async ({ page }) => {
  const api = new FakePliego();
  await api.install(page);
  await signInAndAdd(page, api);
  await page.getByRole("link", { name: "Continuar con la compra" }).click();
  await saveFirstAddress(page);
  await page.locator('[data-purchase="payment-method"]').filter({ hasText: "Tarjeta" }).click();

  const number = page.getByLabel("Número de tarjeta");
  const expiry = page.getByLabel("Caducidad (MM/AA)");
  const cvv = page.getByLabel("Código de seguridad", { exact: true });
  await number.pressSequentially("4111111111111110");
  await expect(number).toBeFocused();
  await number.fill("");
  await number.pressSequentially("4111111111111111");
  await expect(expiry).toBeFocused();

  await expiry.pressSequentially("1328");
  await expect(expiry).toBeFocused();
  await expiry.fill("");
  await expiry.pressSequentially("1230");
  await expect(cvv).toBeFocused();

  await cvv.pressSequentially("12");
  await expect(cvv).toBeFocused();
  await cvv.pressSequentially("3");
  await expect(page.getByLabel("Nombre en la tarjeta")).toBeFocused();
  expect(api.checkoutPosts).toBe(0);
});

test("keeps transactional feedback available with reduced motion enabled", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  const api = new FakePliego();
  await api.install(page);
  await signInAndAdd(page, api);
  await expect(page.getByRole("heading", { level: 1, name: "Tu carrito" })).toBeFocused();
});

test("keeps purchase steps and the Account family on their type systems at all target widths", async ({ page }) => {
  const api = new FakePliego();
  await api.install(page);
  await signInAndAdd(page, api);

  const viewports = [
    { width: 1280, height: 900 },
    { width: 768, height: 1024 },
    { width: 390, height: 844 },
    { width: 320, height: 720 },
  ];
  // Purchase steps and the Account family both title pages in the functional face (Account at 600).
  const verifySurface = async (heading: string, weight = "700") => {
    const title = page.getByRole("heading", { level: 1, name: heading });
    for (const viewport of viewports) {
      await page.setViewportSize(viewport);
      await expect(title).toBeVisible();
      const typography = await title.evaluate((element) => {
        const style = getComputedStyle(element);
        return { family: style.fontFamily, weight: style.fontWeight };
      });
      expect(typography.family).toContain("Roboto Flex");
      expect(typography.weight).toBe(weight);
      await expectNoHorizontalOverflow(page);
    }
  };

  await verifySurface("Tu carrito");
  await openAccountSection(page, "Perfil");
  await verifySurface("Mi perfil", "600");
  await openAccountSection(page, "Direcciones");
  await verifySurface("Direcciones", "600");
  await openAccountSection(page, "Pedidos");
  await verifySurface("Mis pedidos", "600");
});

test("a rejected simulated payment leaves the cart active for a deliberate new attempt", async ({ page }) => {
  const api = new FakePliego();
  api.rejectNextCheckout = true;
  await api.install(page);

  await signInAndAdd(page, api);
  await page.getByRole("link", { name: "Continuar con la compra" }).click();
  await saveFirstAddress(page);
  await page.locator('[data-purchase="payment-method"]').filter({ hasText: "Transferencia" }).click();
  await page.getByRole("button", { name: "Hacer pedido" }).click();

  await expect(page.getByRole("heading", { level: 1, name: "El pago no se completó" })).toBeVisible();
  await expect(page.getByText("Referencia", { exact: true })).toHaveCount(0);
  await page.getByRole("link", { name: "Revisar el carrito" }).click();
  await expect(page.getByRole("link", { name: "Cien años de soledad" })).toBeVisible();
  expect(api.stock).toBe(5);
  expect(api.checkoutPosts).toBe(1);
});

test("a lost checkout response is reconciled through orders without replaying the POST", async ({ page }) => {
  const api = new FakePliego();
  api.loseNextCheckoutResponse = true;
  await api.install(page);

  await signInAndAdd(page, api);
  await page.getByRole("link", { name: "Continuar con la compra" }).click();
  await saveFirstAddress(page);
  await page.locator('[data-purchase="payment-method"]').filter({ hasText: "Transferencia" }).click();
  await page.getByRole("button", { name: "Hacer pedido" }).click();

  const unknown = page.getByRole("heading", { name: "No pudimos confirmar si se creó tu pedido." });
  await expect(unknown).toBeVisible();
  await page.getByRole("button", { name: "Hacer pedido" }).click({ force: true });
  expect(api.checkoutPosts).toBe(1);

  await page.getByRole("button", { name: "Consultar resultado" }).click();
  await expect(page).toHaveURL(/\/orders\/700$/);
  await expect(page.getByRole("heading", { level: 1, name: "Es momento de celebrar" })).toBeVisible();
  expect(api.checkoutPosts).toBe(1);
});

test("a stock change at checkout refreshes the cart and names the affected item", async ({ page }) => {
  const api = new FakePliego();
  await api.install(page);

  await signInAndAdd(page, api);
  await page.getByRole("link", { name: "Continuar con la compra" }).click();
  await saveFirstAddress(page);
  await page.locator('[data-purchase="payment-method"]').filter({ hasText: "Transferencia" }).click();
  api.stock = 0;
  await page.getByRole("button", { name: "Hacer pedido" }).click();

  // The pre-submit read sees availability change, so nothing is sent.
  await expect(page.getByRole("heading", { name: "Tu carrito cambió." })).toBeVisible();
  await expect(page.locator("aside").getByText("No hay existencias suficientes para esta cantidad.")).toBeVisible();
  await expect(page.getByRole("link", { name: "Ajusta tu carrito" })).toBeVisible();
  expect(api.checkoutPosts).toBe(0);
});

test("a guest opening the cart returns there after signing in", async ({ page }) => {
  const api = new FakePliego();
  await api.install(page);

  await page.goto("/cart");
  await expect(page.getByRole("heading", { level: 1, name: "Inicia sesión para ver tu carrito." })).toBeVisible();
  await page.getByRole("main").getByRole("link", { name: "Iniciar sesión" }).click();
  await page.getByLabel("Correo electrónico").fill("ana@example.com");
  await page.getByLabel("Contraseña").fill("lectura-segura");
  await page.getByRole("button", { name: "Iniciar sesión" }).click();

  await expect(page).toHaveURL(/\/cart$/);
  await expect(page.getByRole("heading", { level: 1, name: "Tu carrito" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Tu carrito está vacío." })).toBeVisible();
});
