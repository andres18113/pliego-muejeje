import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setApiAccessToken } from "./client";
import { deleteAddress, updateProfile } from "./customer";

describe("customer API", () => {
  beforeEach(() => setApiAccessToken("customer-token"));
  afterEach(() => { setApiAccessToken(null); vi.unstubAllGlobals(); });

  it("sends only the profile fields supported by PUT /me", async () => {
    const fetchMock = vi.fn(async (request: Request) => {
      expect(await request.json()).toEqual({ firstNames: "Ana", lastNames: "Pérez", phone: null });
      return new Response(null, { status: 204 });
    });
    vi.stubGlobal("fetch", fetchMock);
    await updateProfile({ firstNames: "Ana", lastNames: "Pérez", phone: null });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("preserves PostgreSQL's P1103 when an address is gone", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({
      code: "P1103", title: "Dirección no disponible", detail: "No encontramos esta dirección.",
    }), { status: 404, headers: { "Content-Type": "application/problem+json" } })));
    await expect(deleteAddress("15")).rejects.toMatchObject({ status: 404, code: "P1103" });
  });
});
