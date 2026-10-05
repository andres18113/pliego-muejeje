import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setApiAccessToken } from "./client";
import { ApiRequestError } from "./errors";
import { CancellationOutcomeUnknown, CheckoutOutcomeUnknown, cancelOrder, getOrder, listOrders, isNewerOrderId, submitCheckout } from "./orders";
import { orderDetailFixture, orderSummaryFixture } from "@/test/orders";

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

describe("checkout API", () => {
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
