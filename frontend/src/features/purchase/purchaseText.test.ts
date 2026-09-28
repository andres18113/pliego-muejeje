import { describe, expect, it } from "vitest";
import { safeAuthReturnHref } from "@/features/auth/authLocation";
import { canChangeQuantity, detectCardBrand, formatCardNumber, isLuhnValid, normalizeCardNumber, unavailabilityText } from "./purchaseText";

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

  it("explains canonical cart unavailability SQLSTATEs", () => {
    expect(unavailabilityText("P3002")).toBe("No hay existencias suficientes para esta cantidad.");
    expect(unavailabilityText("P2042")).toBe("Esta edición ya no está a la venta.");
    expect(unavailabilityText("P2043")).toBe("Este libro ya no está a la venta.");
    expect(canChangeQuantity("P3002")).toBe(true);
    expect(canChangeQuantity("P2042")).toBe(false);
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
