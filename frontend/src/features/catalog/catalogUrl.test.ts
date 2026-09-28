import { describe, expect, it } from "vitest";
import {
  catalogHref,
  readCatalogCriteria,
  safeCatalogReturnHref,
  safeExternalHttpHref,
  writeCatalogCriteria,
} from "./catalogUrl";

describe("catalog URL helpers", () => {
  it("round-trips supported criteria using the existing zero-based page URL semantics", () => {
    const criteria = readCatalogCriteria(
      "?q=Julio+Verne&scope=author&category=ciencia-ficcion&minPrice=7.2&maxPrice=38&language=ES&format=HARDCOVER&sort=PRICE_DESC&page=2&pageSize=40",
    );

    expect(criteria).toEqual({
      query: "Julio Verne",
      scope: "author",
      category: "ciencia-ficcion",
      minPrice: "7.20",
      maxPrice: "38.00",
      language: "es",
      format: "HARDCOVER",
      sort: "PRICE_DESC",
      page: 2,
      pageSize: 40,
    });
    expect(readCatalogCriteria(writeCatalogCriteria(criteria).toString())).toEqual(criteria);
    expect(catalogHref(criteria)).toMatch(/^\/catalog\?/);
    expect(catalogHref(criteria)).toContain("page=2");
    expect(catalogHref(readCatalogCriteria(""))).toBe("/catalog");
  });

  it("drops malformed criteria and normalizes valid ISBN and reversed price bounds before requests", () => {
    expect(readCatalogCriteria(
      "?q=978-0-306-40615-7&scope=isbn13&category=../admin&minPrice=NaN&maxPrice=9.5&language=English&format=OTHER&sort=RECENT&page=1e3&pageSize=51",
    )).toEqual({
      query: "9780306406157",
      scope: "isbn13",
      category: "",
      minPrice: "",
      maxPrice: "9.50",
      language: "",
      format: "",
      sort: "TITLE_ASC",
      page: 0,
      pageSize: 20,
    });

    expect(readCatalogCriteria("?q=no-es-isbn&scope=isbn13&minPrice=38&maxPrice=7.25")).toMatchObject({
      query: "",
      scope: "title",
      minPrice: "7.25",
      maxPrice: "38.00",
    });
  });

  it("keeps return destinations on the catalog or a catalog edition route", () => {
    expect(safeCatalogReturnHref("/?q=Julio&page=1")).toBe("/?q=Julio&page=1");
    expect(safeCatalogReturnHref("/catalog?q=Julio&page=1")).toBe("/catalog?q=Julio&page=1");
    expect(safeCatalogReturnHref("/catalog/editions/42?from=%2Fcatalog%3Fq%3DJulio#facts"))
      .toBe("/catalog/editions/42?from=%2Fcatalog%3Fq%3DJulio#facts");
  });

  it.each([
    "//evil.example",
    "///evil.example",
    "https://evil.example/",
    "/\\evil.example",
    "/admin",
    "/catalog/editions/0",
    "/catalog/%2e%2e/admin",
  ])("rejects adversarial return URL %s", (candidate) => {
    expect(safeCatalogReturnHref(candidate)).toBe("/catalog");
  });

  it("contains nested return parameters within the app and rejects the nested external destination", () => {
    const safeDetailReturn = safeCatalogReturnHref(
      "/catalog/editions/42?from=%2F%2Fevil.example%2Fsteal",
    );
    expect(safeDetailReturn).toBe("/catalog/editions/42?from=%2F%2Fevil.example%2Fsteal");

    const nested = new URL(safeDetailReturn, window.location.origin);
    expect(safeCatalogReturnHref(nested.searchParams.get("from"))).toBe("/catalog");
  });

  it("allows only absolute HTTP(S) cover-source links without embedded credentials", () => {
    expect(safeExternalHttpHref("https://books.example/covers/42"))
      .toBe("https://books.example/covers/42");
    expect(safeExternalHttpHref("http://books.example/source"))
      .toBe("http://books.example/source");
    expect(safeExternalHttpHref("javascript:alert(1)")).toBeNull();
    expect(safeExternalHttpHref("data:text/html,unsafe")).toBeNull();
    expect(safeExternalHttpHref("//books.example/source")).toBeNull();
    expect(safeExternalHttpHref("https://user:secret@books.example/source")).toBeNull();
    expect(safeExternalHttpHref("https://%zz")).toBeNull();
  });
});
