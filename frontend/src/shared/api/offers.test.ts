import { afterEach, describe, expect, it, vi } from "vitest";
import { getOffersFilterOptions, getPublicOffers } from "./catalog";

const offer = { offerId: "1", originalPrice: "20.00", effectivePrice: "16.00", discountAmount: "4.00", savingsAmount: "4.00", savingsPercent: "20.00", startsAt: "2026-10-01T00:00:00-05:00", endsAt: "2026-10-07T23:59:59-05:00", daysRemaining: 2, endingSoon: true, offerCopy: null, terms: null };
const edition = { editionId: "42", bookId: "1", title: "Oferta", authors: "Autora", publisher: "Editorial", isbn13: null, price: "16.00", coverUrl: null, coverLicense: null, coverAttribution: null, format: "EBOOK", language: "es", available: true, offer };
function json(body: unknown) { return new Response(JSON.stringify(body), { headers: { "Content-Type": "application/json" } }); }
afterEach(() => vi.unstubAllGlobals());
describe("Offers API contract", () => {
  it("forwards server filter/sort criteria and preserves authoritative price and validity", async () => {
    let url!: URL;
    vi.stubGlobal("fetch", vi.fn(async (request: Request) => { url = new URL(request.url); return json({ items: [edition], page: 2, pageSize: 20, totalCount: "42" }); }));
    const page = await getPublicOffers(2, 20, undefined, { page: 2, pageSize: 20, productType: "EBOOK", category: "literatura", sort: "ENDING_SOON" });
    expect(Object.fromEntries(url.searchParams)).toEqual({ page: "2", pageSize: "20", productType: "EBOOK", category: "literatura", sort: "ENDING_SOON" });
    expect(page.items[0].offer).toEqual(offer);
    expect(page.items[0].price).toBe("16.00");
    expect(page.totalCountValue).toBe(42n);
  });
  it.each([{ daysRemaining: -1 }, { daysRemaining: 1.5 }, { endingSoon: undefined }, { effectivePrice: 16 }])("rejects incomplete or malformed backend validity/pricing (%j)", async patch => {
    vi.stubGlobal("fetch", vi.fn(async () => json({ items: [{ ...edition, offer: { ...offer, ...patch } }], page: 0, pageSize: 20, totalCount: "1" })));
    await expect(getPublicOffers(0)).rejects.toMatchObject({ code: "INVALID_CATALOG_RESPONSE" });
  });
  it("rejects malformed facet counts instead of inventing applicable chips", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => json({ productTypes: [{ code: "EBOOK", label: "eBooks", count: "unknown" }], categories: [], sorts: [{ code: "RELEVANCE", label: "Relevancia" }], totalCount: "1", timezone: "America/Guayaquil", endingSoonDays: 3 })));
    await expect(getOffersFilterOptions()).rejects.toMatchObject({ code: "INVALID_CATALOG_RESPONSE" });
  });
});
