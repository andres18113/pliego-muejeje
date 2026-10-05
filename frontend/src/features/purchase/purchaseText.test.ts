import { describe, expect, it, vi } from "vitest";
import { safeAuthReturnHref } from "@/features/auth/authLocation";
import { detectCardBrand, formatCardNumber, isLuhnValid, normalizeCardNumber } from "./purchaseText";

describe("purchase text and validation", () => {
  it("validates card numbers with Luhn and the 12–19 digit contract", () => {
    expect(isLuhnValid("4111111111111111")).toBe(true);
    expect(isLuhnValid("4111111111111112")).toBe(false);
    expect(isLuhnValid("79927398713")).toBe(false);
    expect(isLuhnValid(normalizeCardNumber("4111 1111-1111 1111"))).toBe(true);
  });

  it("formats numbers and identifies only recognized card prefixes", () => {
    expect(formatCardNumber("4111111111111111")).toBe("4111 1111 1111 1111");
    expect(detectCardBrand("4111 1111 1111 1111")).toBe("visa");
    expect(detectCardBrand("5555555555554444")).toBe("mastercard");
    expect(formatCardNumber("378282246310005")).toBe("3782 822463 10005");
    expect(detectCardBrand("378282246310005")).toBe("amex");
    expect(detectCardBrand("30569309025904")).toBe("diners");
    expect(detectCardBrand("6011000990139424")).toBeNull();
  });


});

describe("sign-in return intent", () => {
  it("keeps catalog and customer purchase destinations", () => {
    expect(safeAuthReturnHref("/cart")).toBe("/cart");
    expect(safeAuthReturnHref("/checkout")).toBe("/checkout");
    expect(safeAuthReturnHref("/orders/700")).toBe("/orders/700");
    expect(safeAuthReturnHref("/catalog/editions/42?from=%2Fcatalog")).toBe("/catalog/editions/42?from=%2Fcatalog");
  });

  it("falls back to the catalog for anything else", () => {
    expect(safeAuthReturnHref("//evil.example/cart")).toBe("/catalog");
    expect(safeAuthReturnHref("https://evil.example/checkout")).toBe("/catalog");
    expect(safeAuthReturnHref("/admin")).toBe("/catalog");
    expect(safeAuthReturnHref("/orders/abc")).toBe("/catalog");
    expect(safeAuthReturnHref(null)).toBe("/catalog");
  });
});

describe("deliveryDateRangeLabel", () => {
  it("formats the server's window as day and capitalised short month, joined by a hyphen", async () => {
    const { deliveryDateRangeLabel } = await import("./purchaseText");
    expect(deliveryDateRangeLabel("2026-10-05", "2026-10-07")).toBe("5 Oct - 7 Oct");
    expect(deliveryDateRangeLabel("2026-01-09", "2026-01-11")).toBe("9 Ene - 11 Ene");
  });

  it("names both months across a month boundary", async () => {
    const { deliveryDateRangeLabel } = await import("./purchaseText");
    expect(deliveryDateRangeLabel("2026-11-30", "2026-12-02")).toBe("30 Nov - 2 Dic");
    expect(deliveryDateRangeLabel("2028-02-28", "2028-03-01")).toBe("28 Feb - 1 Mar");
  });

  it("adds the years across a year boundary", async () => {
    const { deliveryDateRangeLabel } = await import("./purchaseText");
    expect(deliveryDateRangeLabel("2026-12-31", "2027-01-02")).toBe("31 Dic 2026 - 2 Ene 2027");
  });

  it("reads the dates as written, whatever time zone the viewer is in", async () => {
    const { deliveryDateRangeLabel } = await import("./purchaseText");
    try {
      for (const zone of ["Pacific/Kiritimati", "Pacific/Pago_Pago", "UTC", "America/Guayaquil"]) {
        vi.stubEnv("TZ", zone);
        expect(new Intl.DateTimeFormat().resolvedOptions().timeZone).toBe(zone);
        expect(deliveryDateRangeLabel("2026-12-31", "2027-01-02")).toBe("31 Dic 2026 - 2 Ene 2027");
        expect(deliveryDateRangeLabel("2026-10-05", "2026-10-07")).toBe("5 Oct - 7 Oct");
      }
    } finally { vi.unstubAllEnvs(); }
  });

  it("states nothing without a complete, well-formed server window", async () => {
    const { deliveryDateRangeLabel } = await import("./purchaseText");
    expect(deliveryDateRangeLabel(null, "2026-10-07")).toBeNull();
    expect(deliveryDateRangeLabel("2026-10-05", undefined)).toBeNull();
    expect(deliveryDateRangeLabel("2026-13-05", "2026-10-07")).toBeNull();
    expect(deliveryDateRangeLabel("05/10/2026", "07/10/2026")).toBeNull();
  });
});
