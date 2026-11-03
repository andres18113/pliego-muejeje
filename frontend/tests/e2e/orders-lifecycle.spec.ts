import { expect, test, type Page } from "@playwright/test";
import { orderDetailFixture, orderSummaryFixture } from "../../src/test/orders";
import { pickupOrder } from "../../src/test/pickup";

async function install(page: Page, detail: ReturnType<typeof orderDetailFixture>) {
  const reads: string[] = [];
  await page.route("https://www.openstreetmap.org/**", route => route.fulfill({ contentType: "text/html",body: "<html><body>Mapa de prueba</body></html>" }));
  await page.route("https://tile.openstreetmap.org/**", route => route.fulfill({ contentType: "image/png", body: Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=", "base64") }));
  await page.route("**/api/v1/**",route => {
    const path = new URL(route.request().url()).pathname;
    if (path === "/api/v1/auth/refresh" || path === "/api/v1/auth/login") return route.fulfill({ json: {
      accessToken: "orders-contract-token",tokenType: "Bearer",expiresInSeconds: 1800,
      user: { userId: "100",email: "ana@example.com",role: "CUSTOMER" },
    } });
    if (path === "/api/v1/me") return route.fulfill({ json: { customerId: "100",email: "ana@example.com",firstNames: "Ana",lastNames: "Pérez",phone: null,state: "ACTIVE",version: "0" } });
    if (path === "/api/v1/orders") return route.fulfill({ json: {
      items: [orderSummaryFixture({ fulfillmentMethod: detail.fulfillment?.method ?? null,shipmentState: "PREPARING" })],page: 0,pageSize: 10,totalCount: "1",
    } });
    if (path === "/api/v1/orders/700") {
      reads.push(path);
      return route.fulfill({ json: detail });
    }
    if (path === "/api/v1/cart") return route.fulfill({ json: { cartId: null,state: null,totalCurrent: "0.00",items: [] } });
    if (path.includes("/catalog/editions/")) return route.fulfill({ status: 404,json: { code: "P2041",title: "No disponible",detail: "Edición no disponible." } });
    return route.fulfill({ json: { items: [],page: 0,pageSize: 20,totalCount: "0" } });
  });
  return reads;
}

for (const [state,label] of [["PREPARING","En preparación"],["IN_TRANSIT","En camino"],["OUT_FOR_DELIVERY","En reparto"],["DELIVERED","Entregado"],["PENDING","Pedido confirmado"],["SHIPPED","En camino"]]) {
  test(`Mis pedidos consumes authoritative ${state} and current cancel availability`,async ({ page }) => {
    const cancel = state === "PREPARING";
    const detail = orderDetailFixture(state,{ availableActions: { cancel,changeShippingAddress: false } });
    const reads = await install(page,detail);
    await page.goto("/orders");
    const row = page.getByRole("link",{ name: new RegExp(`${label}.*Pedido #700`) });
    await expect(row).toBeVisible();
    await expect(row).toContainText("2 unidades");
    await row.click();
    await expect(page.getByRole("heading",{ level: 2,name: label })).toBeVisible();
    if (state === "DELIVERED") {
      // Delivered reads as one completed state, not the five stage labels.
      await expect(page.getByRole("group",{ name: "Progreso del envío" })).toContainText("Entregado");
      await expect(page.getByRole("list",{ name: "Progreso del envío" })).toHaveCount(0);
    } else await expect(page.getByRole("list",{ name: "Progreso del envío" }).locator('[aria-current="step"]')).toContainText(state === "PENDING" ? "Confirmado" : label);
    await expect(page.getByRole("button",{ name: "Cancelar pedido" })).toHaveCount(cancel ? 1 : 0);
    expect(reads.length).toBeGreaterThanOrEqual(1); // Shared cache may deduplicate a detail request already in flight.
  });
}

for (const [state,label] of [["PENDING","En preparación"],["READY","Listo para retirar"],["COLLECTED","Retirado"],["CANCELLED","Pedido cancelado"]]) {
  test(`Mis pedidos preserves STORE_PICKUP ${state}`,async ({ page }) => {
    const detail = { ...pickupOrder,orderState: state === "COLLECTED" ? "DELIVERED" : state === "CANCELLED" ? "CANCELLED" : "CONFIRMED",
      purchaseState: state === "CANCELLED" ? "CANCELLED" : "CONFIRMED",
      fulfillment: { ...pickupOrder.fulfillment,state },availableActions: { cancel: state === "PENDING",changeShippingAddress: false } };
    await install(page,detail);
    await page.goto("/orders");
    await page.getByRole("link",{ name: new RegExp(`${label}.*Pedido #700`) }).click();
    await expect(page.getByRole("heading",{ level: 2,name: label })).toBeVisible();
    await expect(page.getByRole("list",{ name: "Progreso del envío" })).toHaveCount(0);
    await expect(page.getByRole("button",{ name: "Cancelar pedido" })).toHaveCount(state === "PENDING" ? 1 : 0);
  });
}

test("PREPARING alone cannot make cancellation available",async ({ page }) => {
  await install(page,orderDetailFixture("PREPARING",{ availableActions: { cancel: false,changeShippingAddress: false } }));
  await page.goto("/orders/700");
  await expect(page.getByRole("heading",{ level: 2,name: "En preparación" })).toBeVisible();
  await expect(page.getByRole("button",{ name: "Cancelar pedido" })).toHaveCount(0);
});

test("cancelled home delivery remains a cancelled purchase",async ({ page }) => {
  const detail = orderDetailFixture("CANCELLED",{ orderState: "CANCELLED",purchaseState: "CANCELLED",
    payment: { method: "CARD",state: "REFUNDED",amount: "42.55",reference: "SIM-1" },availableActions: { cancel: false,changeShippingAddress: false } });
  await install(page,detail);
  await page.goto("/orders");
  const unit = page.getByRole("link",{ name: /Pedido cancelado.*Pedido #700/ });
  // A cancelled order reads at a finished order's prominence (display face, 650) in neutral ink, never the success green.
  const listState = await unit.locator("strong").first().evaluate(element => { const style = getComputedStyle(element); return { weight: style.fontWeight, family: style.fontFamily, color: style.color }; });
  expect(listState.weight).toBe("650");
  expect(listState.family).toMatch(/Bricolage/);
  expect(listState.color).toBe("rgb(37, 39, 64)");
  await page.screenshot({ path: test.info().outputPath("cancelled-order-list.png"),fullPage: true,animations: "disabled" });
  await unit.click();
  await expect(page.getByRole("heading",{ level: 2,name: "Pedido cancelado" })).toBeVisible();
  expect(await page.getByRole("heading",{ level: 2,name: "Pedido cancelado" }).evaluate(element => getComputedStyle(element).color)).toBe("rgb(37, 39, 64)");
  await page.screenshot({ path: test.info().outputPath("cancelled-order-detail.png"),fullPage: true,animations: "disabled" });
  await expect(page.getByRole("list",{ name: "Progreso del envío" })).toHaveCount(0);
  await expect(page.getByRole("button",{ name: "Cancelar pedido" })).toHaveCount(0);
});

test("opening detail revalidates a previously cached PREPARING snapshot",async ({ page }) => {
  const detail = orderDetailFixture();
  const reads = await install(page,detail);
  await page.goto("/orders");
  const row = page.getByRole("link",{ name: /En preparación.*Pedido #700/ });
  await expect(row).toBeVisible();
  await expect.poll(() => reads.length).toBe(1);
  await expect(page.getByText("Actualizando tus pedidos…")).toHaveCount(0);
  Object.assign(detail,orderDetailFixture("IN_TRANSIT",{ availableActions: { cancel: false,changeShippingAddress: false } }));
  await row.click();
  await expect(page.getByRole("heading",{ level: 2,name: "En camino" })).toBeVisible();
  await expect(page.getByRole("button",{ name: "Cancelar pedido" })).toHaveCount(0);
  expect(reads.length).toBe(2);
});

for (const [purchaseState,paymentState,label] of [["CONFIRMED","APPROVED","Compra confirmada"],["PENDING_PAYMENT","PENDING","Pendiente de pago"],["CANCELLED","REFUNDED","Pedido cancelado"],["CANCELLED","REJECTED","Pago no completado"]]) {
  test(`Mis pedidos preserves commercial ${purchaseState}/${paymentState} without inventing shipping`,async ({ page }) => {
    const detail = orderDetailFixture("PREPARING",{ orderState: purchaseState,purchaseState,fulfillment: null,shipment: null,
      payment: { method: "CARD",state: paymentState,amount: "42.55",reference: null },availableActions: { cancel: false,changeShippingAddress: false } });
    await install(page,detail);
    await page.goto("/orders");
    await page.getByRole("link",{ name: new RegExp(`${label}.*Pedido #700`) }).click();
    await expect(page.getByRole("heading",{ level: 2,name: label })).toBeVisible();
    await expect(page.getByRole("list",{ name: "Progreso del envío" })).toHaveCount(0);
    await expect(page.getByRole("button",{ name: "Cancelar pedido" })).toHaveCount(0);
  });
}
