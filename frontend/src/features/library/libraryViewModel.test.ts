import { describe, expect, it } from "vitest";
import type { OwnedItem } from "@/shared/api/library";
import { toOwnedItemViewModel } from "./libraryViewModel";

const item: OwnedItem = {
  ownedItemId: "8", editionId: "42", coverUrl: null, title: "Libro propio", authors: "Autora",
  productType: "EBOOK", acquiredAt: "2026-10-05T10:00:00Z", ownershipState: "OWNED",
  accessState: "OWNERSHIP_ONLY", contentAccessSupported: false,
  metadata: { isbn: null, publisher: "Editorial", language: "es", pageCount: 120,
    publicationDate: "2020-01-01", ebookFileFormat: "EPUB", audioDurationSeconds: null, narrators: [] },
  sourcePurchases: [], availableActions: [],
};

describe("library source purchase presentation", () => {
  it.each([
    ["CONFIRMED", "APPROVED", "ACTIVE", "Confirmado", "Aprobado", "Vigente"],
    ["CANCELLED", "REFUNDED", "REVOKED", "Cancelado", "Reembolsado", "Revocada"],
  ] as const)("projects Spanish labels for %s / %s / %s without changing the API states", (orderState, paymentState, grantState, orderStateLabel, paymentStateLabel, grantStateLabel) => {
    const source = { orderId: "700", orderItemId: "1", acquiredAt: item.acquiredAt, orderState, paymentState, grantState };
    const original: OwnedItem = { ...item, sourcePurchases: [source] };
    const result = toOwnedItemViewModel(original).sourcePurchases[0];

    expect(result).toEqual({ ...source, orderStateLabel, paymentStateLabel, grantStateLabel });
    expect(original.sourcePurchases[0]).toEqual(source);
    expect(result).not.toBe(source);
  });

  it("uses the shared Spanish fallback for unrecognized order and payment states", () => {
    const result = toOwnedItemViewModel({ ...item, sourcePurchases: [{ orderId: "700", orderItemId: "1", acquiredAt: item.acquiredAt, orderState: "FUTURE_ORDER", paymentState: "FUTURE_PAYMENT", grantState: "ACTIVE" }] });

    expect(result.sourcePurchases[0]).toMatchObject({ orderStateLabel: "Estado no reconocido", paymentStateLabel: "Estado no reconocido", grantStateLabel: "Vigente" });
  });
});
