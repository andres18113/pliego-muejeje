import { afterEach, describe, expect, it, vi } from "vitest";
import { AttemptStorageError, beginPendingAttempt, clearPendingAttempt, readPendingAttempt } from "./attemptStorage";

describe("durable pending attempt metadata", () => {
  afterEach(() => { vi.restoreAllMocks(); localStorage.clear(); });

  it("fails closed with Spanish feedback if a recovery key cannot be generated", async () => {
    vi.spyOn(crypto, "randomUUID").mockImplementation(() => { throw new Error("Secure random unavailable"); });
    await expect(beginPendingAttempt("checkout", "2")).rejects.toThrow(AttemptStorageError);
    expect(localStorage.length).toBe(0);
  });

  it("rejects another attempt until the original actor-scoped key is resolved", async () => {
    const key = await beginPendingAttempt("address", "2");
    expect(readPendingAttempt("address", "2")).toBe(key);
    await expect(beginPendingAttempt("address", "2")).rejects.toThrow(/intento pendiente/);
    expect(readPendingAttempt("address", "3")).toBeNull();
    clearPendingAttempt("address", "2", crypto.randomUUID());
    expect(readPendingAttempt("address", "2")).toBe(key);
    clearPendingAttempt("address", "2", key);
    expect(readPendingAttempt("address", "2")).toBeNull();
  });

  it("does not allow a new command when storage is unavailable or recovery metadata is corrupted", async () => {
    localStorage.setItem("pliego:pending:checkout:2", "damaged");
    await expect(beginPendingAttempt("checkout", "2")).rejects.toThrow(AttemptStorageError);
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("Quota exhausted"); });
    await expect(beginPendingAttempt("address", "2")).rejects.toThrow(AttemptStorageError);
  });

  it("can recover its original pending key even if another tab overwrote the shared pointer", async () => {
    const original = await beginPendingAttempt("checkout", "2");
    localStorage.setItem("pliego:pending:checkout:2", "550e8400-e29b-41d4-a716-446655440001");
    expect(readPendingAttempt("checkout", "2")).toBe(original);
  });

  it("permits only one simultaneous claim for the same actor and operation", async () => {
    const claims = await Promise.allSettled([beginPendingAttempt("address", "2"), beginPendingAttempt("address", "2")]);
    expect(claims.filter((claim) => claim.status === "fulfilled")).toHaveLength(1);
    expect(claims.filter((claim) => claim.status === "rejected")).toHaveLength(1);
    const winner = claims.find((claim) => claim.status === "fulfilled")! as PromiseFulfilledResult<string>;
    expect(readPendingAttempt("address", "2")).toBe(winner.value);
  });
});
