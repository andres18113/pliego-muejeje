import { afterEach, describe, expect, it, vi } from "vitest";
import { json, stubApi } from "@/test/purchase";
import { CHECK_GAP_MS, exchangeRegistrationSession, forgetRegistrationPacing, logoutSession, refreshSession, register, retryAtFrom } from "./auth";
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

describe("registration continuation exchange", () => {
  afterEach(() => { forgetRegistrationPacing(); vi.useRealTimers(); vi.unstubAllGlobals(); });
  const retryLater = (retryAfter: string | null) => () => new Response(JSON.stringify({ state: "RETRY_LATER" }), {
    status: 202, headers: { "Content-Type": "application/json", ...(retryAfter === null ? {} : { "Retry-After": retryAfter }) },
  });

  it.each([
    ["PENDING_VERIFICATION", "pending"],
    ["REFRESH_REQUIRED", "refresh"],
  ] as const)("maps 202 %s to %s", async (state, kind) => {
    stubApi({ "POST /api/v1/auth/registration-session": () => json({ state }, 202) });
    await expect(exchangeRegistrationSession()).resolves.toEqual({ kind });
  });

  it("ends the continuation only on 204, leaving no pacing mark behind", async () => {
    stubApi({ "POST /api/v1/auth/registration-session": () => new Response(null, { status: 204 }) });
    await expect(exchangeRegistrationSession()).resolves.toEqual({ kind: "ended" });
    expect(localStorage.getItem("pliego.registrationLastCheckAt")).toBeNull();
  });

  // ADR 0050: a spent quota keeps the continuation, and nothing in this browser asks again before Retry-After.
  it("honours Retry-After for every later check, across this browser's tabs, then asks again", async () => {
    vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(new Date("2026-11-02T12:00:00Z"));
    const api = stubApi({ "POST /api/v1/auth/registration-session": [retryLater("300"), () => json({ state: "PENDING_VERIFICATION" }, 202)] });
    const retryAt = Date.parse("2026-11-02T12:05:00Z");
    await expect(exchangeRegistrationSession()).resolves.toEqual({ kind: "retry", retryAt });
    expect(localStorage.getItem("pliego.registrationRetryAt")).toBe(String(retryAt));
    vi.setSystemTime(new Date("2026-11-02T12:04:59Z"));
    await expect(exchangeRegistrationSession()).resolves.toEqual({ kind: "retry", retryAt });
    await expect(exchangeRegistrationSession()).resolves.toEqual({ kind: "retry", retryAt });
    expect(api.count("POST", "/api/v1/auth/registration-session")).toBe(1);
    vi.setSystemTime(new Date("2026-11-02T12:05:00Z"));
    await expect(exchangeRegistrationSession()).resolves.toEqual({ kind: "pending" });
    expect(api.count("POST", "/api/v1/auth/registration-session")).toBe(2);
    expect(localStorage.getItem("pliego.registrationRetryAt")).toBeNull();
  });

  // PPA-02: ordinary checks are paced for the whole browser, whatever triggers them.
  it("asks at most once per check gap, whatever triggers it, and lets the next ask once the gap ends", async () => {
    vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(new Date("2026-11-02T12:00:00Z"));
    const api = stubApi({ "POST /api/v1/auth/registration-session": () => json({ state: "PENDING_VERIFICATION" }, 202) });
    await expect(exchangeRegistrationSession()).resolves.toEqual({ kind: "pending" });
    const nextAt = Date.parse("2026-11-02T12:00:00Z") + CHECK_GAP_MS;
    for (const ms of [0, 388, 736, 1090, CHECK_GAP_MS - 1]) {
      vi.setSystemTime(Date.parse("2026-11-02T12:00:00Z") + ms);
      await expect(exchangeRegistrationSession()).resolves.toEqual({ kind: "wait", nextAt });
    }
    expect(api.count("POST", "/api/v1/auth/registration-session")).toBe(1);
    vi.setSystemTime(nextAt);
    await expect(exchangeRegistrationSession()).resolves.toEqual({ kind: "pending" });
    expect(api.count("POST", "/api/v1/auth/registration-session")).toBe(2);
  });

  it("counts another tab's check: this tab waits for the same gap", async () => {
    vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(new Date("2026-11-02T12:00:00Z"));
    const api = stubApi({ "POST /api/v1/auth/registration-session": () => json({ state: "PENDING_VERIFICATION" }, 202) });
    localStorage.setItem("pliego.registrationLastCheckAt", String(Date.now() - 5_000));
    await expect(exchangeRegistrationSession()).resolves.toEqual({ kind: "wait", nextAt: Date.now() + 7_000 });
    expect(api.count("POST", "/api/v1/auth/registration-session")).toBe(0);
  });

  it("counts a check that failed, since the server counted the attempt", async () => {
    vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(new Date("2026-11-02T12:00:00Z"));
    stubApi({ "POST /api/v1/auth/registration-session": () => json({ title: "Error", detail: "Fallo" }, 503) });
    await expect(exchangeRegistrationSession()).rejects.toMatchObject({ status: 503 });
    await expect(exchangeRegistrationSession()).resolves.toEqual({ kind: "wait", nextAt: Date.now() + CHECK_GAP_MS });
  });

  it("ignores marks a moved clock made impossible, instead of waiting for them", async () => {
    vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(new Date("2026-11-02T12:00:00Z"));
    const api = stubApi({ "POST /api/v1/auth/registration-session": () => json({ state: "PENDING_VERIFICATION" }, 202) });
    localStorage.setItem("pliego.registrationLastCheckAt", String(Date.now() + 24 * 60 * 60_000));
    localStorage.setItem("pliego.registrationRetryAt", String(Date.now() + 2 * 60 * 60_000));
    await expect(exchangeRegistrationSession()).resolves.toEqual({ kind: "pending" });
    expect(api.count("POST", "/api/v1/auth/registration-session")).toBe(1);
  });

  it("keeps the gap when storage can be read but no longer written", async () => {
    vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(new Date("2026-11-02T12:00:00Z"));
    const api = stubApi({ "POST /api/v1/auth/registration-session": () => json({ state: "PENDING_VERIFICATION" }, 202) });
    // An old shared mark stays readable while every write fails (quota exceeded, blocked site data).
    localStorage.setItem("pliego.registrationLastCheckAt", String(Date.now() - 60_000));
    const setItem = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new DOMException("full", "QuotaExceededError"); });
    try {
      await expect(exchangeRegistrationSession()).resolves.toEqual({ kind: "pending" });
      vi.setSystemTime(Date.now() + 7);
      await expect(exchangeRegistrationSession()).resolves.toMatchObject({ kind: "wait" });
      expect(api.count("POST", "/api/v1/auth/registration-session")).toBe(1);
    } finally {
      setItem.mockRestore();
    }
  });

  it("sends and counts nothing for a check whose page went away while it waited", async () => {
    const api = stubApi({ "POST /api/v1/auth/registration-session": () => json({ state: "PENDING_VERIFICATION" }, 202) });
    const gone = new AbortController(); gone.abort();
    await expect(exchangeRegistrationSession(gone.signal)).rejects.toMatchObject({ name: "AbortError" });
    expect(api.count("POST", "/api/v1/auth/registration-session")).toBe(0);
    expect(localStorage.getItem("pliego.registrationLastCheckAt")).toBeNull();
  });

  it("stays at half the server's 600-per-hour quota even if asked every second for an hour", async () => {
    vi.useFakeTimers({ toFake: ["Date"] }); const start = Date.parse("2026-11-02T12:00:00Z");
    const api = stubApi({ "POST /api/v1/auth/registration-session": () => json({ state: "PENDING_VERIFICATION" }, 202) });
    for (let second = 0; second < 3600; second += 1) {
      vi.setSystemTime(start + second * 1000);
      await exchangeRegistrationSession();
    }
    expect(api.count("POST", "/api/v1/auth/registration-session")).toBe(300);
  });

  it("waits a minute when Retry-After is missing", async () => {
    vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(new Date("2026-11-02T12:00:00Z"));
    stubApi({ "POST /api/v1/auth/registration-session": retryLater(null) });
    await expect(exchangeRegistrationSession()).resolves.toEqual({ kind: "retry", retryAt: Date.parse("2026-11-02T12:01:00Z") });
  });

  it.each([
    ["120", 120_000],
    ["Mon, 02 Nov 2026 12:10:00 GMT", 600_000],
    ["0", 60_000],
    ["-5", 60_000],
    ["soon", 60_000],
    ["Mon, 02 Nov 2026 11:00:00 GMT", 60_000],
    ["999999", 3_600_000],
  ])("reads Retry-After %s as a bounded wait", (header, wait) => {
    const now = Date.parse("2026-11-02T12:00:00Z");
    expect(retryAtFrom(header, now) - now).toBe(wait);
  });
});
