import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setApiAccessToken } from "./client";
import { ApiRequestError } from "./errors";
import { addEditionToCart, getActiveCart } from "./cart";

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
