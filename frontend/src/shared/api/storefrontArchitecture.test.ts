import { afterEach, describe, expect, it, vi } from "vitest";
import { getStorefrontNavigation } from "./storefront";
import { getHelpArticle, searchHelpArticles } from "./help";
import { getOwnedItem, listOwnedItems } from "./library";

const owned = {
  ownedItemId: "8", editionId: "42", coverUrl: null, title: "Libro adquirido", authors: "Autora",
  productType: "EBOOK", acquiredAt: "2026-10-05T10:00:00Z", ownershipState: "OWNED", accessState: "OWNERSHIP_ONLY", contentAccessSupported: false,
  metadata: { isbn: "9780306406157", publisher: "Editorial", language: "es", pageCount: 120, publicationDate: "2020-01-01", ebookFileFormat: "EPUB", audioDurationSeconds: null, narrators: [] },
  sourcePurchases: [{ orderId: "700", orderItemId: "1", acquiredAt: "2026-10-05T10:00:00Z", paymentState: "APPROVED", orderState: "CONFIRMED", grantState: "ACTIVE" }],
  availableActions: [{ type: "VIEW_ORDER", label: "Ver pedido", href: "/orders/700" }, { type: "HELP", label: "Ayuda", href: "/ayuda/ebooks" }],
};
function transport(body: unknown, status = 200) {
  const requests: Request[] = [];
  vi.stubGlobal("fetch", vi.fn(async (request: Request) => { requests.push(request); return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } }); }));
  return requests;
}
afterEach(() => vi.unstubAllGlobals());
describe("ownership-only storefront contracts", () => {
  it("keeps owned metadata, purchase links and server-filtered pagination", async () => {
    const requests = transport({ items: [owned], page: 0, pageSize: 20, totalCount: "1" });
    const result = await listOwnedItems({ productType: "EBOOK", page: 0, pageSize: 20 });
    expect(result.items[0].availableActions).toEqual([{ type: "VIEW_ORDER", label: "Ver pedido", href: "/orders/700" }, { type: "HELP", label: "Ayuda", href: "/ayuda/ebooks" }]);
    expect(new URL(requests[0].url).searchParams.get("productType")).toBe("EBOOK");
  });
  it("fails closed on invented content access and unsafe actions", async () => {
    transport({ ...owned, contentAccessSupported: true });
    await expect(getOwnedItem("8")).rejects.toMatchObject({ status: 502, code: "INVALID_LIBRARY_RESPONSE" });
    transport({ ...owned, availableActions: [{ type: "VIEW_ORDER", label: "Ver pedido", href: "https://example.com/order" }] });
    await expect(getOwnedItem("8")).rejects.toMatchObject({ status: 502, code: "INVALID_LIBRARY_RESPONSE" });
  });
  it("preserves ownership revocation without offering a fake reader", async () => {
    transport({ ...owned, ownershipState: "REVOKED", accessState: "REVOKED" });
    expect((await getOwnedItem("8")).ownershipState).toBe("REVOKED");
  });
  it("does not turn another customer's inaccessible item into catalog data", async () => {
    transport({ code: "RESOURCE_NOT_FOUND", title: "No encontrado", detail: "No disponible" }, 404);
    await expect(getOwnedItem("8")).rejects.toMatchObject({ status: 404 });
  });
  it("uses published Help search with server applicability", async () => {
    const requests = transport({ items: [], page: 0, pageSize: 20, totalCount: "0" });
    expect((await searchHelpArticles({ query: "eBooks", category: "compras", applicability: "EBOOK", page: 0, pageSize: 20 })).items).toEqual([]);
    expect(new URL(requests[0].url).searchParams.get("que")).toBe("eBooks");
    expect(new URL(requests[0].url).searchParams.get("applicability")).toBe("EBOOK");
  });
  it("keeps unpublished Help unavailable", async () => {
    transport({ code: "RESOURCE_NOT_FOUND" }, 404);
    await expect(getHelpArticle("draft")).rejects.toMatchObject({ status: 404 });
  });
  it("keeps storefront destinations, featured order and counts as supplied", async () => {
    transport({ sections: [{ key: "AUDIOBOOK", label: "Audiolibros", href: "/catalog?productType=AUDIOBOOK", featured: [], categories: [], allHref: "/catalog?productType=AUDIOBOOK", bestSellingHref: "/catalog?productType=AUDIOBOOK&sort=BEST_SELLING", offersHref: null, activeOfferCount: "0" }] });
    const result = await getStorefrontNavigation();
    expect(result.sections[0].bestSellingHref).toBe("/catalog?productType=AUDIOBOOK&sort=BEST_SELLING");
    expect(result.sections[0].activeOfferCount).toBe("0");
  });
});
