import { describe, expect, it } from "vitest";
import { formatEdition, formatLanguage, formatPageCount, formatPublicationDate, formatUsd } from "./formatters";

describe("catalog formatters", () => {
  it("uses consistent es-EC labels for language and currency", () => {
    expect(formatLanguage("es")).toBe("Español");
    expect(formatUsd("18.50")).toContain("18,50");
    expect(formatUsd("18.50")).toMatch(/^\$\s/);
  });

  it("formats page counts and publication dates for es-EC", () => {
    expect(formatPageCount(1245)).toBe("1.245");
    expect(formatPublicationDate("1967-05-30")).toBe("30 de mayo de 1967");
  });

  it("names unknown edition formats explicitly", () => {
    expect(formatEdition("PAPERBACK")).toBe("Rústica");
    expect(formatEdition("HARDCOVER")).toBe("Tapa dura");
    expect(formatEdition("EDITION_FORMAT_ADDED_LATER")).toBe("Formato no reconocido");
    expect(formatEdition(null)).toBe("No especificado");
  });
});
