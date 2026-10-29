import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setApiAccessToken } from "./client";
import { getInvoiceAccess } from "./billing";

describe("invoice document access API", () => {
  beforeEach(() => setApiAccessToken("customer-token"));
  afterEach(() => { setApiAccessToken(null); vi.unstubAllGlobals(); });

  it("returns the authenticated API stream instruction and forwards abort signals", async () => {
    const controller = new AbortController();
    const forwardedSignals: AbortSignal[] = [];
    const fetchMock = vi.fn(async (request: Request) => {
      expect(new URL(request.url).pathname).toBe("/api/v1/orders/42/invoice/files/PDF/access");
      expect(request.headers.get("Authorization")).toBe("Bearer customer-token");
      expect(request.cache).toBe("no-store");
      forwardedSignals.push(request.signal);
      return new Response(JSON.stringify({
        delivery: "API_STREAM",
        url: "/api/v1/orders/42/invoice/files/PDF?disposition=inline",
        expiresAt: null,
      }), { status: 200, headers: { "Content-Type": "application/json" } });
    });
    vi.stubGlobal("fetch", fetchMock);
    await expect(getInvoiceAccess("42", controller.signal)).resolves.toEqual({
      delivery: "API_STREAM",
      url: "/api/v1/orders/42/invoice/files/PDF?disposition=inline",
      expiresAt: null,
    });
    controller.abort();
    expect(forwardedSignals[0]?.aborted).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("sends the optional disposition only when supplied", async () => {
    const requested: URL[] = [];
    const fetchMock = vi.fn(async (request: Request) => {
      requested.push(new URL(request.url));
      return new Response(JSON.stringify({ delivery: "API_STREAM", url: "/invoice.pdf", expiresAt: null }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    await getInvoiceAccess("42", undefined, "attachment");
    await getInvoiceAccess("42");

    expect(requested[0]?.searchParams.get("disposition")).toBe("attachment");
    expect(requested[1]?.searchParams.has("disposition")).toBe(false);
  });
});
