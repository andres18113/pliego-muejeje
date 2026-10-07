import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cartBody, json } from "@/test/purchase";
import { setApiAccessToken } from "./client";
import { ApiRequestError } from "./errors";
import { addEditionToCart, getActiveCart, getCartDetail } from "./cart";

describe("cart API", () => {
  beforeEach(() => setApiAccessToken("customer-token"));

  afterEach(() => {
    setApiAccessToken(null);
    vi.unstubAllGlobals();
  });

  it("adds one edition through the authenticated REST contract", async () => {
    const fetchMock = vi.fn(async (request: Request) => {
      expect(request.method).toBe("POST");
      expect(request.url).toContain("/api/v1/cart/items");
      expect(request.headers.get("Authorization")).toBe("Bearer customer-token");
      expect(await request.json()).toEqual({ editionId: "42", quantity: 1 });
      return new Response(JSON.stringify({ cartId: "7", cartItemId: "13", quantity: 2 }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(addEditionToCart("42")).resolves.toEqual({ cartItemId: "13", quantity: 2 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("preserves stable API validation codes and Spanish recovery copy", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({
      title: "Edición no disponible",
      detail: "Esta edición ya no está disponible para agregar al carrito.",
      code: "P2042",
    }), {
      status: 400,
      headers: { "Content-Type": "application/problem+json" },
    })));

    await expect(addEditionToCart("42")).rejects.toMatchObject({
      name: "ApiRequestError",
      status: 400,
      code: "P2042",
      detail: "Esta edición ya no está disponible para agregar al carrito.",
    } satisfies Partial<ApiRequestError>);
  });

  it("reads server cart state to reconcile an uncertain add", async () => {
    vi.stubGlobal("fetch", vi.fn(async (request: Request) => {
      expect(request.method).toBe("GET");
      expect(request.url).toContain("/api/v1/cart");
      expect(request.headers.get("Authorization")).toBe("Bearer customer-token");
      return new Response(JSON.stringify({
        cartId: "7",
        requiresPhysicalFulfillment: true,
        state: "ACTIVE",
        items: [{ editionId: "42", quantity: 2 }],
        totalCurrent: "37.00",
      }), { status: 200, headers: { "Content-Type": "application/json" } });
    }));

    await expect(getActiveCart()).resolves.toEqual({ items: [{ editionId: "42", quantity: 2 }] });
  });
});

it("rejects missing cart capabilities rather than inferring them from display formats", async () => {
  const body = cartBody([{ format: "EBOOK" }]);
  vi.stubGlobal("fetch", vi.fn(async () => json({ ...body, physicalItemCount: undefined })));
  await expect(getCartDetail()).rejects.toMatchObject({ status: 502 });
  vi.stubGlobal("fetch", vi.fn(async () => json({ ...body, items: body.items.map(item => ({ ...item, requiresPhysicalFulfillment: undefined })) })));
  await expect(getCartDetail()).rejects.toMatchObject({ status: 502 });
  vi.unstubAllGlobals();
});

describe("cart offer pricing contract", () => {
  afterEach(() => vi.unstubAllGlobals());

  const linePricing = {
    originalPrice: "25.00", unitSavings: "6.51", originalSubtotal: "75.00", lineSavings: "19.53",
  };
  const summaryPricing = { originalSubtotal: "75.00", savingsTotal: "19.53", currentSubtotal: "55.47" };

  it.each(["PAPERBACK", "HARDCOVER", "EBOOK", "AUDIOBOOK"])("preserves authoritative offer amounts for %s", async (format) => {
    const body = cartBody([{ format, quantity: format === "PAPERBACK" || format === "HARDCOVER" ? 3 : 1, currentPrice: "18.49", currentSubtotal: "55.47" }], "67.30");
    vi.stubGlobal("fetch", vi.fn(async () => json({
      ...body, items: body.items.map(item => ({ ...item, ...linePricing })), ...summaryPricing,
      subtotal: "55.47", taxRate: "15.00", taxAmount: "8.32", shippingAmount: "3.51", total: "67.30",
    })));

    const cart = await getCartDetail();
    expect(cart.items[0]).toMatchObject({ ...linePricing, currentPrice: "18.49", currentSubtotal: "55.47" });
    expect(cart).toMatchObject({ ...summaryPricing, subtotal: "55.47", totalCurrent: "67.30", taxAmount: "8.32", total: "67.30" });
  });

  it("keeps explicit zero savings for lines without an offer in a mixed cart", async () => {
    const body = cartBody([{ format: "PAPERBACK", quantity: 3 }, { format: "EBOOK" }, { format: "AUDIOBOOK" }], "92.47");
    vi.stubGlobal("fetch", vi.fn(async () => json({
      ...body,
      items: body.items.map((item, index) => ({
        ...item,
        ...(index === 0 ? linePricing : { originalPrice: "18.50", unitSavings: "0.00", originalSubtotal: "18.50", lineSavings: "0.00" }),
      })),
      ...summaryPricing,
    })));

    const cart = await getCartDetail();
    expect(cart.items[1]).toMatchObject({ format: "EBOOK", unitSavings: "0.00", lineSavings: "0.00" });
    expect(cart.items[2]).toMatchObject({ format: "AUDIOBOOK", originalPrice: "18.50", originalSubtotal: "18.50" });
    expect(cart.savingsTotal).toBe("19.53");
  });

  it("accepts legacy responses without inventing pricing fields", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => json({ ...cartBody(), subtotal: "18.50" })));
    const cart = await getCartDetail();
    expect(cart.items[0]).toMatchObject({ currentPrice: "18.50", currentSubtotal: "18.50" });
    expect(cart.items[0]).not.toHaveProperty("originalPrice");
    expect(cart.items[0]).not.toHaveProperty("unitSavings");
    expect(cart.items[0]).not.toHaveProperty("originalSubtotal");
    expect(cart.items[0]).not.toHaveProperty("lineSavings");
    expect(cart).not.toHaveProperty("originalSubtotal");
    expect(cart).not.toHaveProperty("savingsTotal");
    expect(cart).not.toHaveProperty("currentSubtotal");
    expect(cart.subtotal).toBe("18.50");
  });

  it.each(["originalPrice", "unitSavings", "originalSubtotal", "lineSavings"])("rejects malformed present line %s", async (field) => {
    const body = cartBody();
    for (const value of [18.5, null, "18.5", "-1.00", "18.500", " 18.50", ""]) {
      vi.stubGlobal("fetch", vi.fn(async () => json({
        ...body, items: body.items.map(item => ({ ...item, [field]: value })),
      })));
      await expect(getCartDetail(), `${field}=${JSON.stringify(value)}`).rejects.toMatchObject({ status: 502 });
    }
  });

  it.each(["originalSubtotal", "savingsTotal", "currentSubtotal"])("rejects malformed present summary %s", async (field) => {
    for (const value of [18.5, null, "18.5", "-1.00", "18.500", " 18.50", ""]) {
      vi.stubGlobal("fetch", vi.fn(async () => json({ ...cartBody(), [field]: value })));
      await expect(getCartDetail(), `${field}=${JSON.stringify(value)}`).rejects.toMatchObject({ status: 502 });
    }
  });
});
