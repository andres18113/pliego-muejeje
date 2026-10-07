import { afterEach, describe, expect, it, vi } from "vitest";
import { json, stubApi } from "@/test/purchase";
import { logoutSession, refreshSession, register } from "./auth";
import { apiClient, setApiAccessToken } from "./client";

const registration = { email: "ana@example.com", password: "lecturaSegura123", firstNames: "Ana", lastNames: "Pérez" };

describe("registration response contract", () => {
  afterEach(() => { setApiAccessToken(null); vi.unstubAllGlobals(); });

  it("accepts the backend verification-pending state instead of rejecting a successful registration", async () => {
    stubApi({ "POST /api/v1/auth/register": () => json({ userId: "10", customerId: "21", state: "PENDING_VERIFICATION" }, 201) });
    await expect(register(registration)).resolves.toEqual({ userId: "10", customerId: "21", state: "PENDING_VERIFICATION" });
  });

  it("rejects a stale immediate-active response that omits required verification", async () => {
    stubApi({ "POST /api/v1/auth/register": () => json({ userId: "10", customerId: "21", state: "ACTIVE" }, 201) });
    await expect(register(registration)).rejects.toMatchObject({ status: 502 });
  });
});

describe("cookie session recovery with an expired access token", () => {
  afterEach(() => { setApiAccessToken(null); vi.unstubAllGlobals(); });

  it.each(["refresh", "logout"] as const)("allows %s to use its refresh cookie without an expired bearer", async (operation) => {
    setApiAccessToken("expired-access-token");
    const api = stubApi({
      [`POST /api/v1/auth/${operation}`]: (request) => request.headers.has("Authorization")
        ? json({ title: "Sesión vencida", detail: "Vuelve a iniciar sesión." }, 401)
        : new Response(null, { status: 204 }),
    });
    if (operation === "refresh") await expect(refreshSession()).resolves.toBeNull();
    else await expect(logoutSession()).resolves.toBeUndefined();
    expect(api.calls[0].headers.get("X-PLIEGO-SESSION-REQUEST")).toBe("1");
    expect(api.calls[0].headers.has("Authorization")).toBe(false);
  });

  it("preserves bearer authorization on private endpoints", async () => {
    setApiAccessToken("current-access-token");
    const api = stubApi({});
    await apiClient.GET("/api/v1/me");
    expect(api.calls[0].headers.get("Authorization")).toBe("Bearer current-access-token");
  });

  it("does not treat a late 401 for a replaced bearer as expiry of the renewed session", async () => {
    setApiAccessToken("previous-token");
    let release!: (response: Response) => void;
    const pending = new Promise<Response>(resolve => { release = resolve; });
    const api = stubApi({ "GET /api/v1/me": () => pending });
    const request = apiClient.GET("/api/v1/me");
    const outcome = expect(request).rejects.toMatchObject({ name: "SessionRenewedError" });
    await vi.waitFor(() => expect(api.count("GET", "/api/v1/me")).toBe(1));
    setApiAccessToken("renewed-token");
    release(json({ title: "Sesión vencida", detail: "Vuelve a iniciar sesión." }, 401));
    await outcome;
  });

  it("preserves genuine 401 responses for the current bearer and public credential commands", async () => {
    setApiAccessToken("current-token");
    const denied = () => json({ title: "Sesión vencida", detail: "Vuelve a iniciar sesión." }, 401);
    stubApi({ "GET /api/v1/me": denied, "POST /api/v1/auth/login": denied });
    expect((await apiClient.GET("/api/v1/me")).response.status).toBe(401);
    expect((await apiClient.POST("/api/v1/auth/login", { body: { email: "ana@example.com", password: "invalid" } })).response.status).toBe(401);
  });
});
