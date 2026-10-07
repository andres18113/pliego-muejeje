import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setApiAccessToken } from "./client";
import { ApiRequestError } from "./errors";
import { CancellationOutcomeUnknown, CheckoutOutcomeUnknown, cancelOrder, getOrder, listOrders, listRecentOrders, isNewerOrderId, resolveCheckout, submitCheckout } from "./orders";
import { orderDetailFixture, orderSummaryFixture } from "@/test/orders";
import { json, stubApi } from "@/test/purchase";

function respond(status: number, body: unknown) {
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": status >= 400 ? "application/problem+json" : "application/json" },
  })));
}

describe("order lifecycle API projections", () => {
  beforeEach(() => setApiAccessToken("customer-token"));
  afterEach(() => { setApiAccessToken(null); vi.unstubAllGlobals(); });

  it.each(["PREPARING","IN_TRANSIT","OUT_FOR_DELIVERY","DELIVERED","PENDING","SHIPPED","CANCELLED"])("consumes %s with server actions, timestamps and history intact", async state => {
    respond(200,orderDetailFixture(state,{ availableActions: { cancel: false,changeShippingAddress: false } }));
    const detail = await getOrder("700");
    expect(detail.shipment?.state).toBe(state);
    expect(detail.shipment?.history[0].newState).toBe(state);
    expect(detail.shipment?.preparingAt).toBe("2026-10-04T15:00:00Z");
    expect(detail.availableActions.cancel).toBe(false);
    expect(detail.taxAmount).toBe("5.55");
  });

  it("does not offer cancellation when the action projection is absent", async () => {
    respond(200,{ ...orderDetailFixture(),availableActions: undefined });
    expect((await getOrder("700")).availableActions.cancel).toBe(false);
  });

  it("retains optional list price/action fields without inventing them for current responses", async () => {
    respond(200,{ items: [orderSummaryFixture({ subtotal: "37.00",taxAmount: "5.55",shippingAmount: "0.00",availableActions: { cancel: false,changeShippingAddress: false } })],page: 0,pageSize: 10,totalCount: "1" });
    expect((await listOrders(0)).items[0]).toMatchObject({ subtotal: "37.00",taxAmount: "5.55",availableActions: { cancel: false } });
    respond(200,{ items: [orderSummaryFixture()],page: 0,pageSize: 10,totalCount: "1" });
    expect((await listOrders(0)).items[0].taxAmount).toBeUndefined();
  });
});

describe("historical order pricing snapshots", () => {
  beforeEach(() => setApiAccessToken("customer-token"));
  afterEach(() => { setApiAccessToken(null); vi.unstubAllGlobals(); });

  const summaryPricing = { originalSubtotal: "83.00", savingsTotal: "15.13", currentSubtotal: "67.87", pricingSnapshotAvailable: true };
  const itemPricing = { originalPrice: "25.00", unitSavings: "6.51", originalSubtotal: "50.00", lineSavings: "13.02", pricingSnapshotAvailable: true };
  const confirmation = { orderId: "700", orderState: "CONFIRMED", paymentState: "APPROVED", subtotal: "67.87", total: "78.05", ...summaryPricing };
  const command = { fulfillmentMethod: "DIGITAL_ONLY" as const, paymentMethod: "TRANSFER" as const };

  it("preserves checkout and resolved-confirmation snapshots", async () => {
    respond(201, confirmation);
    expect(await submitCheckout(command, "snapshot-key")).toMatchObject({ ...summaryPricing, subtotal: "67.87", total: "78.05" });
    respond(200, { state: "CREATED", order: confirmation });
    expect(await resolveCheckout("snapshot-key")).toMatchObject({ state: "CREATED", order: summaryPricing });
  });

  it("retains snapshot totals and the authoritative tax rate in both paginated and recent-order lists", async () => {
    const body = { items: [{ ...orderSummaryFixture(), ...summaryPricing, taxRate: "15.00", taxAmount: "10.18" }], page: 0, pageSize: 10, totalCount: "1" };
    respond(200, body);
    expect((await listOrders(0)).items[0]).toMatchObject({ ...summaryPricing, taxRate: "15.00", taxAmount: "10.18" });
    respond(200, body);
    expect((await listRecentOrders())[0]).toMatchObject({ ...summaryPricing, taxRate: "15.00", taxAmount: "10.18" });
  });

  it("accepts null or absent historical summary tax rates but rejects a present numeric rate", async () => {
    for (const taxRate of [null, undefined]) {
      respond(200, { items: [{ ...orderSummaryFixture(), taxRate }], page: 0, pageSize: 10, totalCount: "1" });
      expect((await listOrders(0)).items[0].taxRate).toBe(taxRate);
    }
    respond(200, { items: [{ ...orderSummaryFixture(), taxRate: 15 }], page: 0, pageSize: 10, totalCount: "1" });
    await expect(listOrders(0)).rejects.toMatchObject({ status: 502 });
    await expect(listRecentOrders()).rejects.toMatchObject({ status: 502 });
  });

  it("reads physical quantity two and digital snapshots only from the historical order endpoint", async () => {
    const body = orderDetailFixture();
    const items = [
      { ...body.items[0], ...itemPricing, quantity: 2, unitPrice: "18.49", subtotal: "36.98" },
      { ...body.items[0], orderItemId: "2", format: "EBOOK", requiresPhysicalFulfillment: false, quantity: 1,
        unitPrice: "9.37", subtotal: "9.39", originalPrice: "12.00", unitSavings: "2.64", originalSubtotal: "12.00", lineSavings: "2.63", pricingSnapshotAvailable: true },
      { ...body.items[0], orderItemId: "3", format: "AUDIOBOOK", requiresPhysicalFulfillment: false, quantity: 1,
        unitPrice: "21.50", subtotal: "21.50", originalPrice: "21.50", unitSavings: "0.00", originalSubtotal: "21.50", lineSavings: "0.00", pricingSnapshotAvailable: true },
    ];
    const fetchMock = vi.fn(async (request: Request) => {
      expect(new URL(request.url).pathname).toBe("/api/v1/orders/700");
      return new Response(JSON.stringify({ ...body, ...summaryPricing, items }), { status: 200, headers: { "Content-Type": "application/json" } });
    });
    vi.stubGlobal("fetch", fetchMock);
    const detail = await getOrder("700");
    expect(detail).toMatchObject(summaryPricing);
    expect(detail.items[0]).toMatchObject({ ...itemPricing, unitPrice: "18.49", subtotal: "36.98" });
    expect(detail.items[1]).toMatchObject({ unitPrice: "9.37", subtotal: "9.39", unitSavings: "2.64", lineSavings: "2.63" });
    expect(detail.items[2]).toMatchObject({ unitSavings: "0.00", lineSavings: "0.00" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("retains null legacy snapshots and paid subtotals without inventing savings", async () => {
    const legacy = { originalSubtotal: null, savingsTotal: null, currentSubtotal: "37.00", pricingSnapshotAvailable: false };
    const body = orderDetailFixture();
    respond(200, { ...body, ...legacy, items: body.items.map(item => ({ ...item, originalPrice: null, unitSavings: null, originalSubtotal: null, lineSavings: null, pricingSnapshotAvailable: false })) });
    const detail = await getOrder("700");
    expect(detail).toMatchObject(legacy);
    expect(detail.items[0]).toMatchObject({ originalPrice: null, unitSavings: null, originalSubtotal: null, lineSavings: null, pricingSnapshotAvailable: false, unitPrice: "18.50", subtotal: "37.00" });
    respond(200, { items: [{ ...orderSummaryFixture(), ...legacy }], page: 0, pageSize: 10, totalCount: "1" });
    expect((await listOrders(0)).items[0]).toMatchObject(legacy);
    respond(201, { ...confirmation, ...legacy });
    expect(await submitCheckout(command, "legacy-key")).toMatchObject(legacy);
  });

  it.each(["originalPrice", "unitSavings", "originalSubtotal", "lineSavings", "pricingSnapshotAvailable"])("rejects malformed detail item %s without dropping it", async field => {
    const body = orderDetailFixture();
    respond(200, { ...body, items: body.items.map(item => ({ ...item, [field]: field === "pricingSnapshotAvailable" ? "true" : "18.5" })) });
    await expect(getOrder("700")).rejects.toMatchObject({ status: 502 });
  });

  it.each(["originalSubtotal", "savingsTotal", "currentSubtotal", "pricingSnapshotAvailable"])("rejects malformed %s across confirmation, list and detail", async field => {
    const invalid = { [field]: field === "pricingSnapshotAvailable" ? "true" : "18.5" };
    respond(201, { ...confirmation, ...invalid });
    await expect(submitCheckout(command, "invalid-key")).rejects.toBeInstanceOf(CheckoutOutcomeUnknown);
    respond(200, { items: [{ ...orderSummaryFixture(), ...invalid }], page: 0, pageSize: 10, totalCount: "1" });
    await expect(listOrders(0)).rejects.toMatchObject({ status: 502 });
    respond(200, { ...orderDetailFixture(), ...invalid });
    await expect(getOrder("700")).rejects.toMatchObject({ status: 502 });
  });
});

describe("checkout API", () => {
  it("forwards the accepted quote fingerprint with the original idempotency key", async () => {
    const api = stubApi({ "POST /api/v1/checkout": () => json({ orderId: "701", orderState: "CONFIRMED", paymentState: "APPROVED", total: "9.99", paymentReference: "SIM-1" },201) });
    await submitCheckout({ addressId: "15", paymentMethod: "TRANSFER", expectedCartId: "40", expectedQuoteFingerprint: "a".repeat(64) }, "550e8400-e29b-41d4-a716-446655440000");
    expect(api.calls[0].body).toMatchObject({ expectedCartId: "40", expectedQuoteFingerprint: "a".repeat(64) });
    expect(api.calls[0].headers.get("Idempotency-Key")).toBe("550e8400-e29b-41d4-a716-446655440000");
  });
  beforeEach(() => setApiAccessToken("customer-token"));
  afterEach(() => {
    setApiAccessToken(null);
    vi.unstubAllGlobals();
  });

  it("never sends a card number for TRANSFER", async () => {
    const fetchMock = vi.fn(async (request: Request) => {
      expect(await request.json()).toEqual({ fulfillmentMethod: "HOME_DELIVERY", addressId: "15", paymentMethod: "TRANSFER", simulationOutcome: "APPROVED" });
      return new Response(JSON.stringify({ orderId: "701", orderState: "CONFIRMED", paymentState: "APPROVED", total: "9.99", paymentReference: "SIM-1" }), {
        status: 201, headers: { "Content-Type": "application/json" },
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(submitCheckout({
      addressId: "15", paymentMethod: "TRANSFER", cardNumber: "4111111111111111",
    }, "550e8400-e29b-41d4-a716-446655440000")).resolves.toMatchObject({ orderId: "701", paymentState: "APPROVED" });
  });

  it("treats a lost response as an unknown outcome", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new TypeError("Failed to fetch"); }));
    await expect(submitCheckout({ addressId: "15", paymentMethod: "TRANSFER" }, "550e8400-e29b-41d4-a716-446655440000"))
      .rejects.toBeInstanceOf(CheckoutOutcomeUnknown);
  });

  it("treats an unexpected 5xx as an unknown outcome", async () => {
    respond(502, { code: "INTERNAL_SERVER_ERROR", title: "Error", detail: "Falla." });
    await expect(submitCheckout({ addressId: "15", paymentMethod: "TRANSFER" }, "550e8400-e29b-41d4-a716-446655440000"))
      .rejects.toBeInstanceOf(CheckoutOutcomeUnknown);
  });

  it("treats P5007 as a known, rolled-back failure", async () => {
    respond(500, { code: "P5007", title: "Error interno", detail: "No se completó." });
    await expect(submitCheckout({ addressId: "15", paymentMethod: "TRANSFER" }, "550e8400-e29b-41d4-a716-446655440000"))
      .rejects.toMatchObject({ name: "ApiRequestError", status: 500, code: "P5007" } satisfies Partial<ApiRequestError>);
  });

  it("surfaces canonical domain codes unchanged", async () => {
    respond(409, { code: "P3002", title: "Existencias insuficientes", detail: "Uno o más libros ya no tienen existencias suficientes." });
    await expect(submitCheckout({ addressId: "15", paymentMethod: "TRANSFER" }, "550e8400-e29b-41d4-a716-446655440000"))
      .rejects.toMatchObject({ status: 409, code: "P3002" });
  });

  it("compares order identifiers numerically", () => {
    expect(isNewerOrderId("1000", "999")).toBe(true);
    expect(isNewerOrderId("999", "999")).toBe(false);
    expect(isNewerOrderId("5", null)).toBe(true);
  });

  it("keeps the database conflict code when cancellation is ineligible", async () => {
    respond(409, { code: "P5003", title: "Pedido no cancelable", detail: "El pedido ya fue enviado." });
    await expect(cancelOrder("700")).rejects.toMatchObject({ status: 409, code: "P5003" });
  });

  it("treats a lost cancellation response as unknown without retrying", async () => {
    const fetchMock = vi.fn(async () => { throw new TypeError("Failed to fetch"); });
    vi.stubGlobal("fetch", fetchMock);
    await expect(cancelOrder("700")).rejects.toBeInstanceOf(CancellationOutcomeUnknown);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
