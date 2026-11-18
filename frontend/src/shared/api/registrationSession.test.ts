import { describe, expect, it } from "vitest";
import { registrationSessionSchema, registrationSessionStateSchema } from "./registrationSession";

const session = { accessToken: "test-access", tokenType: "Bearer", expiresInSeconds: 1800,
  user: { userId: "10", email: "ana@example.com", role: "CUSTOMER" }, returnTo: "/checkout" };

describe("registration continuation runtime schemas", () => {
  it.each(["PENDING_VERIFICATION", "REFRESH_REQUIRED"])("validates %s without accepting authentication", state => {
    expect(registrationSessionStateSchema.parse({ state })).toEqual({ state });
    expect(registrationSessionSchema.safeParse({ state }).success).toBe(false);
  });
  it("accepts complete session fields and local destinations", () => {
    expect(registrationSessionSchema.parse(session)).toEqual(session);
    expect(registrationSessionSchema.parse({ ...session, returnTo: null }).returnTo).toBeNull();
    expect(registrationSessionSchema.safeParse({ ...session, returnTo: "/cart?source=edition#items" }).success).toBe(true);
  });
  it.each(["https://evil.test", "//evil.test", "/admin", "/checkout\\evil", "/checkout\n"])("rejects unsafe returnTo %j", returnTo => {
    expect(registrationSessionSchema.safeParse({ ...session, returnTo }).success).toBe(false);
  });
  it("rejects incomplete sessions and unknown states", () => {
    expect(registrationSessionSchema.safeParse({ accessToken: "partial" }).success).toBe(false);
    expect(registrationSessionStateSchema.safeParse({ state: "AUTHENTICATED" }).success).toBe(false);
  });
});
