import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { orderDetailFixture, orderSummaryFixture } from "@/test/orders";
import { pickupOrder } from "@/test/pickup";
import { setApiAccessToken } from "./client";
import { CheckoutOutcomeUnknown, getOrder, listOrders, listRecentOrders, resolveCheckout, submitCheckout, type CheckoutCommand } from "./orders";
import { fulfillmentSchema } from "./pickup";

function respond(status: number, body: unknown) {
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify(body), {
    status, headers: { "Content-Type": "application/json" },
  })));
}

const checkoutCommand: CheckoutCommand = {
  billingRecipient: "ACCOUNT", billingIdentity: { type: "EC_CEDULA", number: "1710034065" }, buyerName: "Ana Pérez",
  billingAddress: { line1: "Calle 1", line2: null, provinceId: "1", cityId: "1", countryCode: "EC", postalCode: null },
  fulfillmentMethod: "DIGITAL_ONLY", paymentMethod: "TRANSFER",
};
const confirmation = { orderId: "700", orderState: "CONFIRMED", paymentState: "APPROVED", total: "42.55" };

describe("public order reference compatibility", () => {
  beforeEach(() => setApiAccessToken("customer-token"));
  afterEach(() => { setApiAccessToken(null); vi.unstubAllGlobals(); });

  it.each(["PL-7J4P-6W8C", null, undefined])("preserves reference %s in customer details and both order lists", async orderReference => {
    respond(200, { ...orderDetailFixture(), orderReference });
    expect((await getOrder("700")).orderReference).toBe(orderReference);
    respond(200, { items: [{ ...orderSummaryFixture(), orderReference }], page: 0, pageSize: 10, totalCount: "1" });
    expect((await listOrders(0)).items[0].orderReference).toBe(orderReference);
    expect((await listRecentOrders())[0].orderReference).toBe(orderReference);
  });

  it.each(["PL-7J4P-6W8C", null, undefined])("preserves reference %s in checkout and attempt replays", async orderReference => {
    respond(201, { ...confirmation, orderReference });
    expect((await submitCheckout(checkoutCommand, "reference-key")).orderReference).toBe(orderReference);
    respond(200, { state: "CREATED", order: { ...confirmation, orderReference } });
    const replay = await resolveCheckout("reference-key");
    expect(replay.state).toBe("CREATED");
    expect(replay.order?.orderReference).toBe(orderReference);
  });

  it("rejects a malformed reference through every customer order projection", async () => {
    respond(200, { ...orderDetailFixture(), orderReference: 700 });
    await expect(getOrder("700")).rejects.toMatchObject({ status: 502 });
    respond(200, { items: [{ ...orderSummaryFixture(), orderReference: 700 }], page: 0, pageSize: 10, totalCount: "1" });
    await expect(listOrders(0)).rejects.toMatchObject({ status: 502 });
    await expect(listRecentOrders()).rejects.toMatchObject({ status: 502 });
    respond(201, { ...confirmation, orderReference: 700 });
    await expect(submitCheckout(checkoutCommand, "reference-key")).rejects.toBeInstanceOf(CheckoutOutcomeUnknown);
    respond(200, { state: "CREATED", order: { ...confirmation, orderReference: 700 } });
    await expect(resolveCheckout("reference-key")).rejects.toBeInstanceOf(CheckoutOutcomeUnknown);
  });
});

describe("customer pickup states", () => {
  it.each(["PENDING", "READY", "COLLECTED", "CANCELLED"])("accepts authoritative %s pickup state", state => {
    expect(fulfillmentSchema.parse({ ...pickupOrder.fulfillment, state }).state).toBe(state);
  });

  it("rejects shipment states in a store pickup projection", () => {
    expect(fulfillmentSchema.safeParse({ ...pickupOrder.fulfillment, state: "SHIPPED" }).success).toBe(false);
    expect(fulfillmentSchema.safeParse({ method: "HOME_DELIVERY", state: "SHIPPED" }).success).toBe(true);
  });
});
