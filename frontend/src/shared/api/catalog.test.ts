import { afterEach, describe, expect, it, vi } from "vitest";
import { getPublicCatalogFilterOptions, getPublicEdition, parseTotalCount, searchPublicEditions, type EditionSearch } from "./catalog";

afterEach(() => vi.unstubAllGlobals());

describe("edition availability boundary", () => {
  it.each([true, false])("preserves a confirmed availability of %s", async (available) => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ editionId: "42", available }), { status: 200, headers: { "Content-Type": "application/json" } })));
    expect((await getPublicEdition("42")).available).toBe(available);
  });

  it.each([undefined, null, "false", 0])("rejects incomplete availability instead of rendering a false stock status (%s)", async (available) => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ editionId: "42", available }), { status: 200, headers: { "Content-Type": "application/json" } })));
    await expect(getPublicEdition("42")).rejects.toMatchObject({ code: "INVALID_CATALOG_RESPONSE", status: 502 });
  });
});

describe("parseTotalCount", () => {
  it("accepts the API's string count without losing precision", () => {
    expect(parseTotalCount("0")).toBe(0n);
    expect(parseTotalCount("9223372036854775807")).toBe(9_223_372_036_854_775_807n);
  });

  it.each([null, undefined, 12, "", "-1", "1.5", "12books", "9223372036854775808", "12345678901234567890"])(
    "rejects an invalid count without throwing (%s)",
    (value) => {
      expect(() => parseTotalCount(value)).not.toThrow();
      expect(parseTotalCount(value)).toBeNull();
    },
  );
});

describe("searchPublicEditions", () => {
  it("keeps decimal money values as URL strings", async () => {
    const requests: Request[] = [];
    vi.stubGlobal("fetch", vi.fn(async (request: Request) => {
      requests.push(request);
      return new Response(JSON.stringify({ items: [], page: 0, pageSize: 20, totalCount: "0" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }));

    const search: EditionSearch = {
      query: "Cien años",
      category: "",
      minPrice: "10.50",
      maxPrice: "20.00",
      language: "",
      format: "",
      sort: "TITLE_ASC",
      page: 0,
      pageSize: 20,
    };
    await searchPublicEditions(search);

    const query = new URL(requests[0].url).searchParams;
    expect(query.get("que")).toBe("Cien años");
    expect(query.has("title")).toBe(false);
    expect(query.has("author")).toBe(false);
    expect(query.has("isbn13")).toBe(false);
    expect(query.get("minPrice")).toBe("10.50");
    expect(query.get("maxPrice")).toBe("20.00");
  });
});

describe("getPublicCatalogFilterOptions", () => {
  it("returns the language codes and price bounds from the public catalog API", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({
      languages: ["en", "es"], formats: [],
      minimumPrice: "7.25",
      maximumPrice: "38.00",
    }), { status: 200, headers: { "Content-Type": "application/json" } })));

    await expect(getPublicCatalogFilterOptions()).resolves.toEqual({
      languages: ["en", "es"], formats: [],
      minimumPrice: "7.25",
      maximumPrice: "38.00",
    });
  });

  it("rejects invalid price bounds from the public catalog API", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({
      languages: ["es"], formats: [],
      minimumPrice: "40.00",
      maximumPrice: "10.00",
    }), { status: 200, headers: { "Content-Type": "application/json" } })));

    await expect(getPublicCatalogFilterOptions()).rejects.toThrow("Recibimos una respuesta incompleta. Vuelve a intentarlo.");
  });
});
