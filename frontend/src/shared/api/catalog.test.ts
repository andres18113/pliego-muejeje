import { afterEach, describe, expect, it, vi } from "vitest";
import { getPublicCategories, getPublicCatalogFilterOptions, getPublicEdition, parseTotalCount, searchPublicEditions, type EditionSearch } from "./catalog";
import openApi from "../../../openapi/openapi.json";

afterEach(() => vi.unstubAllGlobals());

describe("scoped catalog discovery", () => {
  it.each(["GLOBAL", "PHYSICAL", "EBOOK", "AUDIOBOOK"] as const)("sends %s to both discovery reads and preserves the signal", async (scope) => {
    const requests: Request[] = [];
    const controller = new AbortController();
    vi.stubGlobal("fetch", vi.fn(async (request: Request) => {
      requests.push(request);
      const body = new URL(request.url).pathname.endsWith("/categories")
        ? { items: [] } : { languages: [], formats: [], minimumPrice: null, maximumPrice: null };
      return new Response(JSON.stringify(body), { headers: { "Content-Type": "application/json" } });
    }));
    await getPublicCategories(controller.signal, scope);
    await getPublicCatalogFilterOptions(controller.signal, scope);
    expect(requests.map(request => new URL(request.url).searchParams.get("scope"))).toEqual([scope, scope]);
    controller.abort();
    expect(requests.every(request => request.signal.aborted)).toBe(true);
  });

  it("keeps signal-first callers compatible with GLOBAL discovery", async () => {
    const requests: Request[] = [];
    vi.stubGlobal("fetch", vi.fn(async (request: Request) => {
      requests.push(request);
      const body = new URL(request.url).pathname.endsWith("/categories")
        ? { items: [] } : { languages: [], formats: [], minimumPrice: null, maximumPrice: null };
      return new Response(JSON.stringify(body), { headers: { "Content-Type": "application/json" } });
    }));
    await getPublicCategories();
    await getPublicCatalogFilterOptions();
    expect(requests.map(request => new URL(request.url).searchParams.get("scope"))).toEqual(["GLOBAL", "GLOBAL"]);
  });
});

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
  it("keeps the frontend sort choices aligned with the OpenAPI pattern", () => {
    const sorts = ["TITLE_ASC", "PRICE_ASC", "PRICE_DESC", "BEST_SELLING"] satisfies EditionSearch["sort"][];
    const sortParameter = openApi.paths["/api/v1/catalog/editions"].get.parameters.find(parameter => parameter.name === "sort");
    expect(sortParameter?.schema.pattern?.split("|")).toEqual(sorts);
  });

  it.each(["PHYSICAL", "EBOOK", "AUDIOBOOK"] as const)("sends BEST_SELLING unchanged with the %s media filter", async (productType) => {
    const requests: Request[] = [];
    vi.stubGlobal("fetch", vi.fn(async (request: Request) => {
      requests.push(request);
      return new Response(JSON.stringify({ items: [], page: 0, pageSize: 20, totalCount: "0" }), {
        status: 200, headers: { "Content-Type": "application/json" },
      });
    }));

    await searchPublicEditions({ query: "", category: "", minPrice: "", maxPrice: "", language: "", format: "", productType, sort: "BEST_SELLING", page: 0, pageSize: 20 });

    const query = new URL(requests[0].url).searchParams;
    expect(query.get("sort")).toBe("BEST_SELLING");
    expect(query.get("productType")).toBe(productType);
  });

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
  it("accepts all four real API formats without breaking physical catalog facets", async () => {
    const options = { languages: ["es"], formats: ["PAPERBACK", "HARDCOVER", "EBOOK", "AUDIOBOOK"], minimumPrice: "4.99", maximumPrice: "34.99" };
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify(options), { status: 200, headers: { "Content-Type": "application/json" } })));
    await expect(getPublicCatalogFilterOptions()).resolves.toEqual(options);
  });
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

describe("V032 mixed catalog compatibility", () => {
  const physical = { editionId: "34", bookId: "34", title: "Anna Karénina", authors: "Lev Tolstói", publisher: "Salamandra", isbn13: "9788478883608", price: "20.00", coverUrl: null, coverLicense: null, coverAttribution: null, format: "PAPERBACK", language: "es", available: true };
  const criteria: EditionSearch = { query: "", category: "", minPrice: "", maxPrice: "", language: "", format: "", sort: "TITLE_ASC", page: 0, pageSize: 20 };

  it("parses physical and digital rows together, keeping nullable ISBN and digital metadata", async () => {
    const items = [physical,
      { ...physical, editionId: "80", format: "EBOOK", isbn13: null, ebookFileFormat: "EPUB", audioDurationSeconds: null, narrators: [] },
      { ...physical, editionId: "81", format: "AUDIOBOOK", isbn13: null, ebookFileFormat: null, audioDurationSeconds: 1234, narrators: ["Narrador DEMO"] }];
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ items, page: 0, pageSize: 20, totalCount: "3" }), { status: 200, headers: { "Content-Type": "application/json" } })));
    const page = await searchPublicEditions(criteria);
    expect(page.items[0]).toEqual(physical);
    expect(page.items[1]).toMatchObject({ format: "EBOOK", isbn13: null, ebookFileFormat: "EPUB" });
    expect(page.items[2]).toMatchObject({ format: "AUDIOBOOK", audioDurationSeconds: 1234, narrators: ["Narrador DEMO"] });
  });

  it("rejects unknown formats and malformed digital metadata rather than treating them as physical", async () => {
    for (const invalid of [{ ...physical, format: "UNKNOWN" }, { ...physical, format: "AUDIOBOOK", audioDurationSeconds: -1, narrators: ["Narrador"] }]) {
      vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ items: [invalid], page: 0, pageSize: 20, totalCount: "1" }), { status: 200, headers: { "Content-Type": "application/json" } })));
      await expect(searchPublicEditions(criteria)).rejects.toMatchObject({ code: "INVALID_CATALOG_RESPONSE" });
    }
  });
});
