import { describe, expect, it } from "vitest";
import { offerEndLabel, offersCountLabel, offerUrgencyLabel, savingsPercentLabel } from "./offersPresentation";

describe("offers presentation values", () => {
  it("words the server's days left as an urgency chip only within five days", () => {
    expect(offerUrgencyLabel(0)).toBe("Termina hoy");
    expect(offerUrgencyLabel(1)).toBe("Queda 1 día");
    expect(offerUrgencyLabel(3)).toBe("Quedan 3 días");
    expect(offerUrgencyLabel(5)).toBe("Quedan 5 días");
    expect(offerUrgencyLabel(6)).toBeNull();
  });
  it("reads the end exactly as the API wrote it, whatever the browser zone", () => {
    expect(offerEndLabel("2026-10-12T23:59:00-05:00")).toBe("12 de octubre, 23:59");
    expect(offerEndLabel("2027-01-03T00:00:00.000-05:00")).toBe("3 de enero, 00:00");
    expect(offerEndLabel("pronto")).toBe("pronto");
  });
  it("shows the server percentage without recalculating it", () => {
    expect(savingsPercentLabel("20.00")).toBe("20 %");
    expect(savingsPercentLabel("12.50")).toBe("12,5 %");
    expect(savingsPercentLabel(null)).toBeNull();
  });
  it("counts offers from the server total", () => {
    expect(offersCountLabel("1")).toBe("1 oferta");
    expect(offersCountLabel("14")).toBe("14 ofertas");
  });
});
