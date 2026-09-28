import { expect, test, type Page, type Route } from "@playwright/test";

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

    if (path === "/auth/login") {
      return ok({ accessToken: "e2e-token", tokenType: "Bearer", expiresInSeconds: 1800, user: { userId: "100", email: "ana@example.com", role: "CUSTOMER" } });
    }
    if (path === "/me" && method === "GET") return ok({ customerId: "100", email: "ana@example.com", firstNames: "Ana", lastNames: "Pérez", phone: null, state: "ACTIVE" });
    if (path === "/reference/countries") return ok([{ code: "EC", name: "Ecuador" }, { code: "CO", name: "Colombia" }]);
    if (path === "/reference/transfer-details") return ok({ bank: "Banco PLIEGO", beneficiary: "PLIEGO Tienda", accountType: "Corriente", accountNumber: "0000000000", identification: "0000000000000" });
    if (path === "/catalog/categories") return ok({ items: [{ slug: "narrativa", name: "Narrativa", parentSlug: null }] });
    if (path === "/catalog/filter-options") return ok({ languages: ["es"], minimumPrice: "18.50", maximumPrice: "18.50" });
    if (path === "/catalog/editions/42") return ok({ ...edition, available: this.stock > 0 });
    if (path === "/catalog/editions") {
      return ok({ items: [{ ...edition, authors: "Gabriel García Márquez", publisher: "Editorial Sur", available: this.stock > 0 }], page: 0, pageSize: 20, totalCount: "1" });
    }

    if (path === "/cart" && method === "GET") return ok(this.cart());
    if (path === "/cart/items" && method === "POST") {
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
      return ok({ items: this.orders.map((order) => ({ orderId: order.orderId, orderState: order.orderState, total: order.total, paymentState: order.paymentState })), page: 0, pageSize: 5, totalCount: String(this.orders.length) });
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
      });
    }
    return fail(404, "NOT_FOUND", "Recurso no encontrado", path);
  }
}

async function signInAndAdd(page: Page) {
  await page.goto("/catalog/editions/42");
  await page.getByRole("link", { name: "Iniciar sesión para agregar" }).click();
  await page.getByLabel("Correo electrónico").fill("ana@example.com");
  await page.getByLabel("Contraseña").fill("lectura-segura");
  await page.getByRole("button", { name: "Iniciar sesión" }).click();
  await expect(page).toHaveURL(/\/catalog\/editions\/42$/);
  await page.getByRole("button", { name: "Agregar al carrito" }).click();
  await expect(page.getByText("Edición agregada al carrito. Ahora tienes 1 unidad de esta edición.")).toBeVisible();
  await page.getByRole("link", { name: "Ver el carrito" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Tu carrito" })).toBeVisible();
}

async function saveFirstAddress(page: Page) {
  await page.getByLabel("Dirección", { exact: true }).fill("Av. Amazonas 100");
  await page.getByLabel("Ciudad").fill("Quito");
  await page.getByLabel("Provincia").fill("Pichincha");
  await page.getByLabel("Teléfono de contacto").fill("0991234567");
  await page.getByRole("button", { name: "Guardar dirección" }).click();
  await expect(page.locator(".checkout-selected-address")).toContainText("Casa");
}

async function expectNoHorizontalOverflow(page: Page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);
}

for (const viewport of [{ name: "desktop", width: 1280, height: 900 }, { name: "tablet", width: 768, height: 1024 }, { name: "mobile", width: 390, height: 844 }, { name: "small mobile", width: 320, height: 720 }]) {
  test(`completes the CUSTOMER purchase from edition to confirmation on ${viewport.name}`, async ({ page }) => {
    await page.setViewportSize(viewport);
    const api = new FakePliego();
    await api.install(page);

    await signInAndAdd(page);
    await page.getByRole("button", { name: "Agregar una unidad de Cien años de soledad" }).click();
    await expect(page.getByText("Cantidad actualizada: 2 unidades.")).toBeVisible();
    await expect(page.locator(".purchase-total dd")).toHaveText(/37,00/);
    await expectNoHorizontalOverflow(page);

    await page.getByRole("link", { name: "Continuar con la compra" }).click();
    await expect(page.getByRole("heading", { level: 1, name: "Finalizar compra" })).toBeVisible();
    await saveFirstAddress(page);
    await page.locator(".payment-method-option").filter({ hasText: "Tarjeta" }).click();
    await page.getByLabel("Número de tarjeta").fill("4111 1111 1111 1111");
    await page.getByLabel("Vencimiento (MM/AA)").fill("12/30");
    await page.getByLabel("CVV").fill("123");
    await page.getByLabel("Nombre en la tarjeta").fill("Ana Pérez");
    await expectNoHorizontalOverflow(page);
    await page.getByRole("button", { name: /Pagar/ }).click();

    await expect(page).toHaveURL(/\/orders\/700$/);
    await expect(page.getByRole("heading", { level: 1, name: "Pedido n.º 700 confirmado" })).toBeFocused();
    await expect(page.getByText("SIM-e2e-0")).toBeVisible();
    await expect(page.getByText("4111")).toHaveCount(0);
    await expect(page.getByRole("link", { name: /^Carrito/ })).toContainText("0");
    await expectNoHorizontalOverflow(page);
    expect(api.checkoutPosts).toBe(1);
    expect(api.stock).toBe(3);
  });
}

test("a rejected simulated payment leaves the cart active for a deliberate new attempt", async ({ page }) => {
  const api = new FakePliego();
  api.rejectNextCheckout = true;
  await api.install(page);

  await signInAndAdd(page);
  await page.getByRole("link", { name: "Continuar con la compra" }).click();
  await saveFirstAddress(page);
  await page.locator(".payment-method-option").filter({ hasText: "Transferencia" }).click();
  await page.getByRole("button", { name: /Pagar/ }).click();

  await expect(page.getByRole("heading", { level: 1, name: "No pudimos completar el pago" })).toBeVisible();
  await expect(page.getByText("Referencia de pago")).toHaveCount(0);
  await page.getByRole("link", { name: "Revisar el carrito" }).click();
  await expect(page.getByRole("link", { name: "Cien años de soledad" })).toBeVisible();
  expect(api.stock).toBe(5);
  expect(api.checkoutPosts).toBe(1);
});

test("a lost checkout response is reconciled through orders without replaying the POST", async ({ page }) => {
  const api = new FakePliego();
  api.loseNextCheckoutResponse = true;
  await api.install(page);

  await signInAndAdd(page);
  await page.getByRole("link", { name: "Continuar con la compra" }).click();
  await saveFirstAddress(page);
  await page.locator(".payment-method-option").filter({ hasText: "Transferencia" }).click();
  await page.getByRole("button", { name: /Pagar/ }).click();

  const unknown = page.getByRole("heading", { name: "No pudimos confirmar si se creó tu pedido." });
  await expect(unknown).toBeVisible();
  await page.getByRole("button", { name: /Pagar/ }).click({ force: true });
  expect(api.checkoutPosts).toBe(1);

  await page.getByRole("button", { name: "Consultar mis pedidos" }).click();
  await expect(page).toHaveURL(/\/orders\/700$/);
  await expect(page.getByRole("heading", { level: 1, name: "Pedido n.º 700 confirmado" })).toBeVisible();
  expect(api.checkoutPosts).toBe(1);
});

test("a stock change at checkout refreshes the cart and names the affected item", async ({ page }) => {
  const api = new FakePliego();
  await api.install(page);

  await signInAndAdd(page);
  await page.getByRole("link", { name: "Continuar con la compra" }).click();
  await saveFirstAddress(page);
  await page.locator(".payment-method-option").filter({ hasText: "Transferencia" }).click();
  api.stock = 0;
  await page.getByRole("button", { name: /Pagar/ }).click();

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
