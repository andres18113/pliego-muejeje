import { afterEach, expect, it, vi } from "vitest";
import { json } from "@/test/purchase";
import { getDigitalEligibility } from "./digitalEligibility";

afterEach(() => vi.unstubAllGlobals());
const item = { editionId: "42", owned: false, ownedItemId: null, pendingOrder: true, pendingOrderId: "900", inCart: false, purchasable: false };
it("reads the authenticated batch contract including a nullable blocking order ID", async () => {
  vi.stubGlobal("fetch", vi.fn(async (request: Request) => {
    expect(new URL(request.url).searchParams.get("editionIds")).toBe("42");
    return json([item]);
  }));
  await expect(getDigitalEligibility(["42"])).resolves.toEqual([item]);
});
it.each([[], [item, item], [{ ...item, editionId: "99" }], [{ ...item, pendingOrderId: "abc" }], [{ ...item, pendingOrderId: undefined }]].map(response => ({ response })))("rejects incomplete, mismatched or malformed eligibility $response", async ({ response }) => {
  vi.stubGlobal("fetch", vi.fn(async () => json(response)));
  await expect(getDigitalEligibility(["42"])).rejects.toMatchObject({ status: 502 });
});
it("preserves authorization errors", async () => {
  vi.stubGlobal("fetch", vi.fn(async () => json({ code: "FORBIDDEN" }, 403)));
  await expect(getDigitalEligibility(["42"])).rejects.toMatchObject({ status: 403 });
});
