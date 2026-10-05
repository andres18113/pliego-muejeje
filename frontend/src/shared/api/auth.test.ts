import { afterEach, describe, expect, it, vi } from "vitest";
import { json, stubApi } from "@/test/purchase";
import { register } from "./auth";

const registration = { email: "ana@example.com", password: "lecturaSegura123", firstNames: "Ana", lastNames: "Pérez" };

describe("registration response contract", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("accepts the backend verification-pending state instead of rejecting a successful registration", async () => {
    stubApi({ "POST /api/v1/auth/register": () => json({ userId: "10", customerId: "21", state: "PENDING_VERIFICATION" }, 201) });
    await expect(register(registration)).resolves.toEqual({ userId: "10", customerId: "21", state: "PENDING_VERIFICATION" });
  });

  it("rejects a stale immediate-active response that omits required verification", async () => {
    stubApi({ "POST /api/v1/auth/register": () => json({ userId: "10", customerId: "21", state: "ACTIVE" }, 201) });
    await expect(register(registration)).rejects.toMatchObject({ status: 502 });
  });
});
