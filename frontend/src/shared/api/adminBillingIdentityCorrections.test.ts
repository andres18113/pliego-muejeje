import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setApiAccessToken } from "./client";
import { decideAdminBillingIdentityCorrection, listAdminBillingIdentityCorrections } from "./adminBillingIdentityCorrections";

const correction = {
  id: "9007199254740993", customerId: "12", customerName: "Ana Pérez", customerEmail: "ana@example.test",
  currentType: "EC_CEDULA", currentNumber: "1710034065", proposedType: "EC_RUC", proposedNumber: "1710034065001",
  reasonCode: "DOCUMENT_CHANGED", note: null, status: "PENDING", createdAt: "2026-11-01T12:00:00Z", dueAt: "2026-11-03T12:00:00Z",
  decidedAt: null, decidedBy: null, decidedByEmail: null, decisionReason: null, customerHasBilledInvoices: true,
};

function respond(body: unknown, status = 200) {
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify(body), {
    status, headers: { "Content-Type": status >= 400 ? "application/problem+json" : "application/json" },
  })));
}

describe("admin billing identity correction API", () => {
  beforeEach(() => setApiAccessToken("admin-token"));
  afterEach(() => { setApiAccessToken(null); vi.unstubAllGlobals(); });

  it("lists the filtered admin queue including billing and reviewer context", async () => {
    const controller = new AbortController(); let requested: Request | undefined;
    vi.stubGlobal("fetch", vi.fn(async (request: Request) => {
      requested = request;
      return new Response(JSON.stringify({ items: [{ ...correction, status: "APPROVED", decidedBy: "99", decidedByEmail: "admin@example.test" }], page: 1, pageSize: 50, totalCount: "51" }), {
        status: 200, headers: { "Content-Type": "application/json" },
      });
    }));
    const result = await listAdminBillingIdentityCorrections({ status: "APPROVED", page: 1, pageSize: 50 }, controller.signal);
    expect(requested?.method).toBe("GET");
    const url = new URL(requested!.url);
    expect(url.pathname).toBe("/api/v1/admin/billing-identity-corrections");
    expect(Object.fromEntries(url.searchParams)).toEqual({ status: "APPROVED", page: "1", pageSize: "50" });
    expect(requested?.headers.get("Authorization")).toBe("Bearer admin-token");
    expect(requested?.cache).toBe("no-store");
    expect(result.items[0]).toMatchObject({ id: "9007199254740993", customerHasBilledInvoices: true, decidedByEmail: "admin@example.test", proposedNumber: "1710034065001" });
    controller.abort(); expect(requested?.signal.aborted).toBe(true);
  });

  it("accepts a pending request with nullable reviewer email and no billed invoices", async () => {
    respond({ items: [{ ...correction, customerHasBilledInvoices: false }], page: 0, pageSize: 20, totalCount: "1" });
    const result = await listAdminBillingIdentityCorrections();
    expect(result.items[0]).toMatchObject({ customerHasBilledInvoices: false, decidedByEmail: null });
  });

  it.each([
    { customerHasBilledInvoices: "true" }, { decidedByEmail: 99 }, { proposedType: "PASSPORT" }, { status: "EXPIRED" },
  ])("rejects malformed correction projection %j", async invalid => {
    respond({ items: [{ ...correction, ...invalid }], page: 0, pageSize: 20, totalCount: "1" });
    await expect(listAdminBillingIdentityCorrections()).rejects.toMatchObject({ status: 502 });
  });

  it("rejects a queue page larger than fifty before requesting it", async () => {
    const fetchMock = vi.fn(); vi.stubGlobal("fetch", fetchMock);
    await expect(listAdminBillingIdentityCorrections({ pageSize: 51 })).rejects.toBeDefined();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each([
    { decision: "APPROVE" as const, decisionReason: null, status: "APPROVED" },
    { decision: "REJECT" as const, decisionReason: "  El documento no corresponde.  ", status: "REJECTED" },
  ])("sends the accepted $decision command without losing a string request ID", async ({ decision, decisionReason, status }) => {
    let requested: Request | undefined; let requestBody: unknown;
    vi.stubGlobal("fetch", vi.fn(async (request: Request) => {
      requested = request; requestBody = await request.json();
      return new Response(JSON.stringify({ id: "9007199254740993", status, decidedAt: "2026-11-01T13:00:00Z", decidedBy: "99", decisionReason: decisionReason?.trim() ?? null }), {
        status: 200, headers: { "Content-Type": "application/json" },
      });
    }));
    const result = await decideAdminBillingIdentityCorrection("9007199254740993", { decision, decisionReason });
    expect(requested?.method).toBe("POST");
    expect(new URL(requested!.url).pathname).toBe("/api/v1/admin/billing-identity-corrections/9007199254740993/decision");
    expect(requestBody).toEqual(decisionReason == null ? { decision } : { decision, decisionReason: decisionReason.trim() });
    expect(result).toMatchObject({ id: "9007199254740993", status, decidedBy: "99" });
  });

  it("requires a nonblank rejection reason before sending a decision", async () => {
    const fetchMock = vi.fn(); vi.stubGlobal("fetch", fetchMock);
    await expect(decideAdminBillingIdentityCorrection("7", { decision: "REJECT", decisionReason: "   " })).rejects.toBeDefined();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects a malformed decision response", async () => {
    respond({ id: "7", status: "PENDING", decidedAt: null, decidedBy: null, decisionReason: null });
    await expect(decideAdminBillingIdentityCorrection("7", { decision: "APPROVE" })).rejects.toMatchObject({ status: 502 });
  });

  it("preserves a confirmed server conflict when a request has already been decided", async () => {
    respond({ code: "P1111", title: "Solicitud atendida", detail: "Actualiza la lista de solicitudes." }, 409);
    await expect(decideAdminBillingIdentityCorrection("7", { decision: "APPROVE" })).rejects.toMatchObject({ status: 409, code: "P1111" });
  });
});
