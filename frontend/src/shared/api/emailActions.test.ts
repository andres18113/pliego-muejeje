import { afterEach, describe, expect, it, vi } from "vitest";
import { EmailActionOutcomeUnknown, requestEmailAction, resetPassword, verifyEmail } from "./emailActions";
import { json, problem, stubApi } from "@/test/purchase";

describe("email action response contracts", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("treats malformed accepted feedback as an unknown command outcome", async () => {
    stubApi({ "POST /api/v1/auth/resend-verification": () => json({}, 202) });
    await expect(requestEmailAction("verification", "ana@example.com")).rejects.toBeInstanceOf(EmailActionOutcomeUnknown);
  });

  it("preserves backend invalid-token feedback", async () => {
    stubApi({ "POST /api/v1/auth/verify-email": () => problem(400, "EMAIL_ACTION_INVALID", "Enlace inválido", "El enlace venció o ya se utilizó.") });
    await expect(verifyEmail("x".repeat(43))).rejects.toMatchObject({ status: 400, code: "EMAIL_ACTION_INVALID" });
  });

  it("treats a reset server failure as uncertain rather than promising that the password did not change", async () => {
    stubApi({ "POST /api/v1/auth/reset-password": () => problem(503, "INTERNAL", "No disponible", "Inténtalo luego.") });
    await expect(resetPassword("x".repeat(43), "segura123")).rejects.toBeInstanceOf(EmailActionOutcomeUnknown);
  });

  it("does not accept a body response in place of the verified 204 contract", async () => {
    stubApi({ "POST /api/v1/auth/verify-email": () => json({ verified: true }) });
    await expect(verifyEmail("x".repeat(43))).rejects.toBeInstanceOf(EmailActionOutcomeUnknown);
  });
});
