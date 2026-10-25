import { expect, test, type Page } from "@playwright/test";
import { storefrontNavigationFixture } from "../../src/test/storefrontFixture";

/** Synthetic orders shaped like GET /api/v1/orders/{id} (V077 per-line digitalAccess), never real account data. */
const physical = { orderItemId: "1", editionId: "42", sku: "P42", isbn: "9780306406157", title: "Crónica matemática", authors: "Mejía, Selene",
  publisher: "Editorial Sur", requiresPhysicalFulfillment: true, format: "PAPERBACK", language: "es", unitPrice: "14.95", quantity: 1, subtotal: "14.95", digitalAccess: null };
const audiobook = { ...physical, orderItemId: "2", editionId: "108", sku: "A108", title: "Cómo comportarse en la multitud: una novela", authors: "Bordas, Camille",
  requiresPhysicalFulfillment: false, format: "AUDIOBOOK", unitPrice: "26.99", subtotal: "26.99", digitalAccess: { state: "AVAILABLE", ownedItemId: "81" } };
const address = { recipient: "Lectora Prueba", line1: "Av. Amazonas 100", line2: null, city: "Quito", province: "Pichincha", countryCode: "EC", postalCode: null, reference: null, phone: "+593991234567" };
const shipment = { shipmentId: "1", state: "PREPARING", carrier: null, trackingCode: null, trackingUrl: null, estimatedDeliveryFrom: "2026-10-27", estimatedDeliveryTo: "2026-10-29",
  createdAt: "2026-10-24T18:08:30Z", preparingAt: "2026-10-24T18:09:00Z", shippedAt: null, outForDeliveryAt: null, deliveredAt: null, cancelledAt: null, history: [] };
const invoice = { invoiceId: "5", documentNumber: "999-999-000000001", state: "ISSUED", buyerName: "Lectora Prueba", identityType: "NATIONAL_ID", identityNumber: "1751550656",
  buyerEmail: null, currency: "USD", subtotal: "41.94", taxTotal: "0.00", total: "41.94", issuedAt: "2026-10-24T18:08:31Z",
  billingAddress: { line1: "Av. Amazonas 100", line2: null, city: "Quito", province: "Pichincha", countryCode: "EC", postalCode: null },
  items: [], electronicIssuance: null, pdfAvailable: true, xmlAvailable: true };

function order(kind: "mixed" | "physical" | "digital") {
  const items = kind === "mixed" ? [audiobook, physical] : kind === "physical" ? [physical] : [audiobook];
  const total = items.reduce((sum, item) => sum + Number(item.subtotal), 0).toFixed(2);
  const digitalOnly = kind === "digital";
  return {
    orderId: "281", orderState: "CONFIRMED", purchaseState: "CONFIRMED", subtotal: total, total, taxRate: "0.00", taxAmount: "0.00", shippingAmount: "0.00",
    createdAt: "2026-10-24T18:08:30Z", updatedAt: "2026-10-24T18:08:30Z", items,
    address: digitalOnly ? null : address,
    payment: { paymentId: "9", method: "CARD", state: "APPROVED", amount: total, reference: "SIM-1", resultDetail: null, createdAt: "2026-10-24T18:08:30Z", updatedAt: "2026-10-24T18:08:30Z" },
    stateHistory: [{ historyId: "1", actorUserId: null, origin: "SYSTEM", previousState: null, newState: "CONFIRMED", at: "2026-10-24T18:08:30Z" }],
    fulfillment: digitalOnly ? null : { method: "HOME_DELIVERY" },
    shipment: digitalOnly ? null : shipment,
    invoice: { ...invoice, subtotal: total, total },
    creditNotes: [],
    availableActions: digitalOnly
      ? { cancel: true, changeShippingAddress: false, canCancel: true, cancellationDeadline: "2026-10-24T18:14:30Z", lifecycleState: "CANCELLATION_WINDOW", libraryAccessState: "OWNERSHIP_ONLY" }
      : { cancel: true, changeShippingAddress: false, canCancel: true, cancellationDeadline: null, lifecycleState: "CONFIRMED", libraryAccessState: kind === "mixed" ? "OWNERSHIP_ONLY" : "NOT_APPLICABLE" },
  };
}

async function mock(page: Page, kind: "mixed" | "physical" | "digital", pdf: "READY" | "PROCESSING" = "READY") {
  await page.route("**/api/v1/**", route => {
    const path = new URL(route.request().url()).pathname;
    const json = (body: unknown, status = 200) => route.fulfill({ status, json: body });
    if (path.endsWith("/auth/refresh")) return json({ accessToken: "t", tokenType: "Bearer", expiresInSeconds: 1800, user: { userId: "100", email: "c@example.invalid", role: "CUSTOMER" } });
    if (path.endsWith("/storefront/navigation")) return json(storefrontNavigationFixture);
    if (path.endsWith("/orders/281")) return json(order(kind));
    if (path.endsWith("/orders/281/invoice")) return json({ invoiceId: "5", orderId: "281", state: "ISSUED", provenance: "SIMULATED", documentNumber: "999-999-000000001", files: [{ type: "PDF", state: pdf }, { type: "XML", state: pdf }] });
    if (path.endsWith("/orders/281/invoice/files/PDF")) return route.fulfill({ status: 200, contentType: "application/pdf", body: "%PDF-1.7\n%PLIEGO\n" });
    if (path.endsWith("/cart")) return json({ cartId: null, state: null, items: [], requiresPhysicalFulfillment: false, physicalItemCount: 0, digitalItemCount: 0, totalCurrent: "0.00" });
    return json({ title: "No encontrado", status: 404 }, 404);
  });
}

/** The confirmation is what checkout hands over: the order route with `purchased` in its navigation state. */
async function openConfirmation(page: Page) {
  await page.goto("/orders/281");
  await expect(page.getByRole("heading", { name: "Pago" })).toBeVisible();
  await page.evaluate(() => {
    window.history.pushState({ usr: { purchased: true }, key: "purchased", idx: (window.history.state?.idx ?? 0) + 1 }, "", "/orders/281");
    window.dispatchEvent(new PopStateEvent("popstate", { state: window.history.state }));
  });
  await expect(page.getByRole("heading", { level: 1, name: "Es momento de celebrar" })).toBeVisible();
}

for (const width of [1280, 360]) {
  for (const kind of ["mixed", "physical", "digital"] as const) {
    test(`${kind} order: one invoice action and separated fulfillment on the order and its confirmation at ${width}px`, async ({ page }, testInfo) => {
      await page.setViewportSize({ width, height: 900 });
      await mock(page, kind);
      await page.goto("/orders/281");
      const main = page.getByRole("main");
      await expect(main.getByRole("heading", { name: "Pago" })).toBeVisible();
      await expect(main.getByRole("button", { name: "Ver factura" })).toBeVisible();
      await expect(main.getByRole("button", { name: /factura/i })).toHaveCount(1);
      await expect(main.getByText(/Documentos de facturación|Factura comercial|Descargar (PDF|XML)|Actualizar documentos|SIMULACIÓN ACADÉMICA/)).toHaveCount(0);
      const digital = main.getByRole("region", { name: "Acceso digital" });
      if (kind === "mixed") {
        await expect(main.getByRole("list", { name: "Libros impresos del pedido" }).getByText(physical.title)).toBeVisible();
        await expect(main.getByRole("list", { name: "Libros impresos del pedido" }).getByText(audiobook.title)).toHaveCount(0);
        await expect(digital.getByText(audiobook.title)).toBeVisible();
        await expect(digital.getByRole("link", { name: "Ver en Mi biblioteca" })).toHaveAttribute("href", "/biblioteca/81");
      } else {
        await expect(digital).toHaveCount(0);
      }
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
      await page.screenshot({ path: testInfo.outputPath(`order-${kind}-${width}.png`), fullPage: true });

      await openConfirmation(page);
      await expect(main.getByRole("button", { name: "Ver factura" })).toBeVisible();
      await expect(main.getByText(/Documentos de facturación|Descargar (PDF|XML)|Actualizar documentos|SIMULACIÓN ACADÉMICA/)).toHaveCount(0);
      if (kind !== "physical") await expect(main.getByRole("region", { name: "Compras digitales" }).getByText("Ya está en Mi biblioteca")).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
      await page.screenshot({ path: testInfo.outputPath(`confirmation-${kind}-${width}.png`), fullPage: true });
    });
  }
}

test("Ver factura opens the PDF in a new tab, and waits quietly while it is prepared", async ({ page, context }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await mock(page, "mixed");
  await page.goto("/orders/281");
  // The press opens a tab and asks for the PDF to view inline. (Showing it needs a browser PDF viewer, which
  // headless Chromium lacks; OrderPage.test.tsx checks the blob is handed to the opened tab.)
  const [tab, request] = await Promise.all([
    context.waitForEvent("page"),
    page.waitForRequest((candidate) => candidate.url().includes("/api/v1/orders/281/invoice/files/PDF")),
    page.getByRole("button", { name: "Ver factura" }).click(),
  ]);
  expect(new URL(request.url()).searchParams.get("disposition")).toBe("inline");
  expect((await request.response())?.status()).toBe(200);
  await expect(page.getByRole("button", { name: "Ver factura" })).toBeEnabled();
  await expect(page.getByRole("status")).toHaveCount(0);
  await tab.close();

  await page.unroute("**/api/v1/**");
  await mock(page, "mixed", "PROCESSING");
  await page.goto("/orders/281");
  await expect(page.getByRole("button", { name: "Preparando factura…" })).toHaveAttribute("aria-disabled", "true");
});
