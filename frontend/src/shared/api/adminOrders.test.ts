import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setApiAccessToken } from "./client";
import { cancelAdminOrder } from "./adminOrders";

const cancellation = { orderId: "9007199254740993", previousState: "CONFIRMED", orderState: "CANCELLED", paymentState: "REFUNDED", restoredUnits: 2 };
function respond(body: unknown, status = 200) {
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } })));
}

describe("admin order cancellation", () => {
  beforeEach(() => setApiAccessToken("admin-token"));
  afterEach(() => { setApiAccessToken(null); vi.unstubAllGlobals(); });

  it("AC-8.1 uses the existing admin cancel endpoint with an exact string ID and no body", async () => {
    let requested: Request | undefined;
    vi.stubGlobal("fetch", vi.fn(async (request: Request) => {
      requested = request;
      return new Response(JSON.stringify(cancellation), { headers: { "Content-Type": "application/json" } });
    }));
    expect(await cancelAdminOrder(cancellation.orderId)).toEqual(cancellation);
    expect(new URL(requested!.url).pathname).toBe(`/api/v1/admin/orders/${cancellation.orderId}/cancel`);
    expect(requested?.method).toBe("POST");
    expect(requested?.cache).toBe("no-store");
    expect(requested?.headers.get("Authorization")).toBe("Bearer admin-token");
    expect(await requested?.text()).toBe("");
  });

  it("AC-8.1 accepts pending payment cancellation without a refund or restored units", async () => {
    respond({ ...cancellation, previousState: "PENDING_PAYMENT", paymentState: "REJECTED", restoredUnits: 0 });
    await expect(cancelAdminOrder("7")).resolves.toMatchObject({ paymentState: "REJECTED", restoredUnits: 0 });
  });

  it.each([401, 403, 409])("AC-7.1 AC-8.2 preserves server status and codes %i", async status => {
    respond({ code: "P5003", detail: "El pedido no se puede cancelar." }, status);
    await expect(cancelAdminOrder("7")).rejects.toMatchObject({ status, code: "P5003" });
  });

  it.each([{ orderId: 7 }, { paymentState: undefined }, { restoredUnits: -1 }, { restoredUnits: "2" }])(
    "AC-8.1 rejects a malformed cancellation record %j", async invalid => {
      respond({ ...cancellation, ...invalid });
      await expect(cancelAdminOrder("7")).rejects.toMatchObject({ status: 502 });
    });
});
