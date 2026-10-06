import { describe, expect, it } from "vitest";
import { durationLabel, languageLabel, publicationDateLabel, titlesCountLabel } from "./libraryPresentation";

describe("library presentation values", () => {
  it("reads audiobook durations as hours and minutes", () => {
    expect(durationLabel(20)).toBe("Menos de 1 min");
    expect(durationLabel(2700)).toBe("45 min");
    expect(durationLabel(7200)).toBe("2 h");
    expect(durationLabel(31320)).toBe("8 h 42 min");
  });
  it("keeps publication dates on their calendar day and leaves unknown shapes untouched", () => {
    expect(publicationDateLabel("2020-01-01")).toBe("1 de enero de 2020");
    expect(publicationDateLabel("2020")).toBe("2020");
  });
  it("names language codes in Spanish and keeps free text", () => {
    expect(languageLabel("es")).toBe("Español");
    expect(languageLabel("Castellano antiguo")).toBe("Castellano antiguo");
  });
  it("counts titles from the server total", () => {
    expect(titlesCountLabel("1")).toBe("1 título");
    expect(titlesCountLabel("23")).toBe("23 títulos");
  });
});
