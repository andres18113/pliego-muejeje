import { afterEach, expect, it, vi } from "vitest";
import { getCustomerFavoriteStatus } from "./favorites";
import { json, stubApi } from "@/test/purchase";
afterEach(() => vi.unstubAllGlobals());
it.each([
  { items: [{ editionId: "43", favorite: false }] },
  { items: [{ editionId: "42", favorite: false }, { editionId: "42", favorite: false }] },
  { items: [] },
])("rejects an incomplete or mismatched authoritative favorite snapshot", async ({ items }) => {
  stubApi({ "GET /api/v1/me/favorites/status": () => json(items) });
  await expect(getCustomerFavoriteStatus(["42"])).rejects.toMatchObject({ status: 502 });
});
