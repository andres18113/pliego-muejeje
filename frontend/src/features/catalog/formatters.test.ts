import { describe, expect, it } from "vitest";
import { formatAuthorNames, formatEdition, formatLanguage, formatNarrators, formatPageCount, formatPublicationDate, formatUsd } from "./formatters";

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
    expect(formatEdition("EBOOK")).toBe("Ebook");
    expect(formatEdition("AUDIOBOOK")).toBe("Audiolibro");
    expect(formatEdition("EDITION_FORMAT_ADDED_LATER")).toBe("Formato no reconocido");
    expect(formatEdition(null)).toBe("No especificado");
  });
});

describe("formatAuthorNames", () => {
  it("removes editorial role marks and keeps every contributor", () => {
    expect(formatAuthorNames("Rodríguez, Armando (coord.); Morales Domínguez, José Francisco (coord.); Delgado Rodríguez, Naira (coord.); Betancort Rodríguez, Verónica (coord.)"))
      .toBe("Rodríguez, Armando; Morales Domínguez, José Francisco; Delgado Rodríguez, Naira; Betancort Rodríguez, Verónica");
    expect(formatAuthorNames("Pérez, Ana (ed.); Gómez, Luis (eds.)")).toBe("Pérez, Ana; Gómez, Luis");
  });
  it("leaves names and institutional parentheses untouched", () => {
    expect(formatAuthorNames("Gabriel García Márquez")).toBe("Gabriel García Márquez");
    expect(formatAuthorNames("Universidad Nacional Autónoma de México (UNAM)")).toBe("Universidad Nacional Autónoma de México (UNAM)");
  });

  it("says demo narrators once in customer words and keeps real names", () => {
    const demo = "Narrador DEMO PLIEGO (sin identidad bibliográfica)";
    expect(formatNarrators([demo])).toBe("Voz de demostración");
    expect(formatNarrators([demo, demo])).toBe("Voz de demostración");
    expect(formatNarrators(["Ana Voz", demo])).toBe("Ana Voz, voz de demostración");
    expect(formatNarrators(["Ana Voz", "Luis Voz"])).toBe("Ana Voz, Luis Voz");
    expect(formatNarrators(["Demóstenes Ruiz"])).toBe("Demóstenes Ruiz");
    expect(formatNarrators([])).toBeNull();
    expect(formatNarrators(null)).toBeNull();
  });
});
