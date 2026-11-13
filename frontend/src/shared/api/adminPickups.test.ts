import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setApiAccessToken } from "./client";
import { adminPickupDetailSchema, getAdminPickup, verifyAdminPickupCode, collectAdminPickup, listAdminPickups, lookupAdminPickup } from "./adminPickups";

const pickup = {
  orderId: "9007199254740993", orderReference: "PL-7J4P-6W8C", state: "READY", orderState: "CONFIRMED", paymentState: "APPROVED",
  createdAt: "2026-11-01T12:00:00Z", readyAt: "2026-11-01T12:30:00Z", collectedAt: null,
  collectedBy: null, identityVerified: null,
  location: { id: "8", name: "Librería Centro", address: "Calle 1", city: "Quito" },
  customer: { customerId: "12", name: "Ana Pérez", email: "ana@example.test", identityType: "EC_CEDULA", identityNumber: "1710034065" },
  items: [{ orderItemId: "23", title: "Pedro Páramo", format: "PAPERBACK", quantity: 2 }], unitCount: 2, total: "42.55",
};

function respond(body: unknown, status = 200) {
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify(body), {
    status, headers: { "Content-Type": status >= 400 ? "application/problem+json" : "application/json" },
  })));
}

describe("admin pickup API", () => {
  beforeEach(() => setApiAccessToken("admin-token"));
  afterEach(() => { setApiAccessToken(null); vi.unstubAllGlobals(); });

  it("looks up the code in a POST body and returns full admin identity without returning a code", async () => {
    let requested: Request | undefined;
    let requestBody: unknown;
    vi.stubGlobal("fetch", vi.fn(async (request: Request) => {
      requested = request; requestBody = await request.json();
      return new Response(JSON.stringify({ ...pickup, pickupCode: "secret-code", customer: { ...pickup.customer, pickupCode: "secret-code" } }), {
        status: 200, headers: { "Content-Type": "application/json" },
      });
    }));

    const result = await lookupAdminPickup("P-7J4P6W8C2D9M");
    expect(requested?.method).toBe("POST");
    expect(new URL(requested!.url).pathname).toBe("/api/v1/admin/pickups/lookup");
    expect(new URL(requested!.url).search).toBe("");
    expect(requestBody).toEqual({ code: "P-7J4P6W8C2D9M" });
    expect(requested?.headers.get("Authorization")).toBe("Bearer admin-token");
    expect(requested?.cache).toBe("no-store");
    expect(result.customer.identityNumber).toBe("1710034065");
    expect(result.orderId).toBe("9007199254740993");
    expect(JSON.stringify(result)).not.toContain("pickupCode");
  });

  it("lists by state and query with bounded pagination and forwards abort signals", async () => {
    const controller = new AbortController();
    let requested: Request | undefined;
    vi.stubGlobal("fetch", vi.fn(async (request: Request) => {
      requested = request;
      return new Response(JSON.stringify({ items: [pickup], page: 2, pageSize: 50, totalCount: "101" }), {
        status: 200, headers: { "Content-Type": "application/json" },
      });
    }));
    const page = await listAdminPickups({ state: "READY", q: "PL-7J4P", page: 2, pageSize: 50 }, controller.signal);
    expect(requested?.method).toBe("GET");
    const url = new URL(requested!.url);
    expect(url.pathname).toBe("/api/v1/admin/pickups");
    expect(Object.fromEntries(url.searchParams)).toEqual({ state: "READY", q: "PL-7J4P", page: "2", pageSize: "50" });
    expect(requested?.cache).toBe("no-store");
    expect(page.totalCount).toBe("101");
    expect(page.items[0].orderReference).toBe("PL-7J4P-6W8C");
    controller.abort();
    expect(requested?.signal.aborted).toBe(true);
  });

  it("uses server pagination defaults without sending absent filters", async () => {
    let url: URL | undefined;
    vi.stubGlobal("fetch", vi.fn(async (request: Request) => {
      url = new URL(request.url);
      return new Response(JSON.stringify({ items: [], page: 0, pageSize: 20, totalCount: "0" }), {
        status: 200, headers: { "Content-Type": "application/json" },
      });
    }));
    await listAdminPickups();
    expect(Object.fromEntries(url!.searchParams)).toEqual({ page: "0", pageSize: "20" });
  });

  it("AC-4.3 requires explicit identity verification before sending a collection command", async () => {
    const fetchMock = vi.fn(); vi.stubGlobal("fetch", fetchMock);
    await expect(collectAdminPickup("7", { pickupCode: "P-7J4P6W8C2D9M", identityVerified: false as true })).rejects.toBeDefined();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("AC-5.2 collects the exact string order ID with verified identity and returns the audit snapshot", async () => {
    let requested: Request | undefined;
    let requestBody: unknown;
    vi.stubGlobal("fetch", vi.fn(async (request: Request) => {
      requested = request; requestBody = await request.json();
      return new Response(JSON.stringify({ ...pickup, state: "COLLECTED", collectedAt: "2026-11-01T13:00:00Z",
        collectedBy: { userId: "99", email: "admin@example.test" }, identityVerified: true, pickupCode: "secret-code" }), {
        status: 200, headers: { "Content-Type": "application/json" },
      });
    }));
    const result = await collectAdminPickup("9007199254740993", { pickupCode: "P-7J4P6W8C2D9M", identityVerified: true });
    expect(requested?.method).toBe("POST");
    expect(new URL(requested!.url).pathname).toBe("/api/v1/admin/orders/9007199254740993/pickup/collect");
    expect(requestBody).toEqual({ pickupCode: "P-7J4P6W8C2D9M", identityVerified: true });
    expect(result).toMatchObject({ state: "COLLECTED", identityVerified: true, collectedBy: { userId: "99", email: "admin@example.test" } });
    expect(JSON.stringify(result)).not.toContain("pickupCode");
  });

  it("rejects page sizes above fifty before making a request", async () => {
    const fetchMock = vi.fn(); vi.stubGlobal("fetch", fetchMock);
    await expect(listAdminPickups({ pageSize: 51 })).rejects.toBeDefined();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each(["lookup", "collect"])("rejects a %s code longer than the server maximum before requesting it", async operation => {
    const fetchMock = vi.fn(); vi.stubGlobal("fetch", fetchMock);
    const request = operation === "lookup"
      ? lookupAdminPickup("P".repeat(65))
      : collectAdminPickup("7", { pickupCode: "P".repeat(65), identityVerified: true });
    await expect(request).rejects.toBeDefined();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects a search longer than one hundred characters before requesting it", async () => {
    const fetchMock = vi.fn(); vi.stubGlobal("fetch", fetchMock);
    await expect(listAdminPickups({ q: "P".repeat(101) })).rejects.toBeDefined();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("accepts codes and search text at the server length limits", async () => {
    respond(pickup);
    await expect(lookupAdminPickup("P".repeat(64))).resolves.toMatchObject({ orderId: "9007199254740993" });
    await expect(collectAdminPickup("7", { pickupCode: "P".repeat(64), identityVerified: true })).resolves.toMatchObject({ orderId: "9007199254740993" });
    respond({ items: [pickup], page: 0, pageSize: 20, totalCount: "1" });
    await expect(listAdminPickups({ q: "P".repeat(100) })).resolves.toMatchObject({ totalCount: "1" });
  });

  it.each([
    { state: "SHIPPED" }, { orderId: 7 }, { total: 42.55 }, { identityVerified: "true" },
    { items: [{ orderItemId: "23", title: "Pedro Páramo", format: "PAPERBACK", quantity: 0 }] },
  ])("rejects malformed pickup projection %j", async invalid => {
    respond({ ...pickup, ...invalid });
    await expect(lookupAdminPickup("P-7J4P6W8C2D9M")).rejects.toMatchObject({ status: 502 });
  });

  it("accepts null admin identity and audit fields while keeping them explicit", async () => {
    respond({ ...pickup, readyAt: null, customer: { ...pickup.customer, identityType: null, identityNumber: null } });
    await expect(lookupAdminPickup("P-7J4P6W8C2D9M")).resolves.toMatchObject({ readyAt: null, collectedBy: null, identityVerified: null,
      customer: { identityType: null, identityNumber: null } });
  });

  it("AC-6.2 preserves the server rejection when a pickup has already been collected", async () => {
    respond({ code: "P5017", title: "Pedido retirado", detail: "Este pedido ya fue retirado." }, 409);
    await expect(collectAdminPickup("7", { pickupCode: "P-7J4P6W8C2D9M", identityVerified: true }))
      .rejects.toMatchObject({ status: 409, code: "P5017" });
  });
});

const detail = { ...pickup, paymentMethod: "TRANSFER", availableActions: { cancel: true, cancellationDeadline: "2026-11-01T12:06:00Z" } };

describe("admin pickup handover detail", () => {
  beforeEach(() => setApiAccessToken("admin-token"));
  afterEach(() => { setApiAccessToken(null); vi.unstubAllGlobals(); });

  it("AC-2.1 AC-2.2 AC-2.3 AC-2.4 AC-8.1 reads exact string IDs and server actions, strips codes, forwards abort", async () => {
    const controller = new AbortController();
    let requested: Request | undefined;
    vi.stubGlobal("fetch", vi.fn(async (request: Request) => {
      requested = request;
      return new Response(JSON.stringify({ ...detail, pickupCode: "secret" }), { headers: { "Content-Type": "application/json" } });
    }));
    const result = await getAdminPickup(pickup.orderId, controller.signal);
    expect(new URL(requested!.url).pathname).toBe(`/api/v1/admin/pickups/${pickup.orderId}`);
    expect(requested?.method).toBe("GET");
    expect(requested?.cache).toBe("no-store");
    expect(requested?.headers.get("Authorization")).toBe("Bearer admin-token");
    expect(result).toEqual(detail);
    controller.abort();
    expect(requested?.signal.aborted).toBe(true);
  });

  it("AC-3.2 AC-3.3 verifies against the order with the code only in a POST body", async () => {
    let requested: Request | undefined;
    let body: unknown;
    vi.stubGlobal("fetch", vi.fn(async (request: Request) => {
      requested = request; body = await request.json();
      return new Response(JSON.stringify(detail), { headers: { "Content-Type": "application/json" } });
    }));
    expect(await verifyAdminPickupCode(pickup.orderId, " p-ab234567 ")).toEqual(detail);
    expect(new URL(requested!.url).pathname).toBe(`/api/v1/admin/pickups/${pickup.orderId}/verify-code`);
    expect(new URL(requested!.url).search).toBe("");
    expect(requested?.method).toBe("POST");
    expect(requested?.cache).toBe("no-store");
    expect(body).toEqual({ code: "p-ab234567" });
  });

  it.each(["", " ", "A".repeat(65)])("AC-3.2 rejects invalid input before sending %j", async code => {
    const fetchMock = vi.fn(); vi.stubGlobal("fetch", fetchMock);
    await expect(verifyAdminPickupCode("7", code)).rejects.toBeDefined();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each([400, 401, 403, 404])("AC-2.5 AC-3.2 AC-7.1 preserves server rejection %i", async status => {
    const code = status === 400 ? "P5013" : status === 404 ? "P5016" : "AUTH_REQUIRED";
    respond({ code, detail: "No autorizado" }, status);
    await expect(getAdminPickup("7")).rejects.toMatchObject({ status, code });
    await expect(verifyAdminPickupCode("7", "wrong")).rejects.toMatchObject({ status, code });
  });

  it.each([{ paymentMethod: undefined }, { availableActions: undefined },
    { availableActions: { cancel: "true", cancellationDeadline: null } },
    { availableActions: { cancel: false, cancellationDeadline: "tomorrow" } }])("AC-8.1 rejects incomplete or malformed detail %j", async invalid => {
    respond({ ...detail, ...invalid });
    await expect(getAdminPickup("7")).rejects.toMatchObject({ status: 502 });
    await expect(verifyAdminPickupCode("7", "code")).rejects.toMatchObject({ status: 502 });
  });

  it("AC-8.1 AC-8.2 accepts explicit null payment method and deadline", () => {
    expect(adminPickupDetailSchema.parse({ ...detail, paymentMethod: null, availableActions: { cancel: false, cancellationDeadline: null } }))
      .toMatchObject({ paymentMethod: null, availableActions: { cancel: false, cancellationDeadline: null } });
  });
});
