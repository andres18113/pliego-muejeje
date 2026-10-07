import { describe, expect, it } from "vitest";
import type { CartDetail, CartLine } from "@/shared/api/cart";
import { toCartPricingViewModel } from "./cartPricingViewModel";

function line(overrides: Partial<CartLine> = {}): CartLine {
  return {
    cartItemId: "100", editionId: "42", title: "Libro", authors: "Autora", sku: "PLG-42", coverUrl: null,
    quantity: 3, currentPrice: "18.49", currentSubtotal: "55.47", available: true,
    requiresPhysicalFulfillment: true, quantityEditable: true, format: "PAPERBACK", unavailabilityReason: null,
    ...overrides,
  };
}

function cart(items: CartLine[] = [line()], overrides: Partial<CartDetail> = {}): CartDetail {
  return {
    cartId: "40", requiresPhysicalFulfillment: true, physicalItemCount: 1, digitalItemCount: 0,
    state: "ACTIVE", items, totalCurrent: "67.30", ...overrides,
  };
}

describe("cart pricing presentation", () => {
  it("maps supplied offer prices for physical quantities, ebooks and audiobooks without deriving amounts", () => {
    const model = toCartPricingViewModel(cart([
      line({ originalPrice: "25.00", unitSavings: "6.51", originalSubtotal: "75.00", lineSavings: "19.53" }),
      line({ cartItemId: "101", format: "EBOOK", requiresPhysicalFulfillment: false, quantityEditable: false, quantity: 1,
        currentPrice: "9.37", currentSubtotal: "9.36", originalPrice: "12.00", unitSavings: "2.64", originalSubtotal: "12.00", lineSavings: "2.63" }),
      line({ cartItemId: "102", format: "AUDIOBOOK", requiresPhysicalFulfillment: false, quantityEditable: false, quantity: 1,
        currentPrice: "18.50", currentSubtotal: "18.50", originalPrice: "18.50", unitSavings: "0.00", originalSubtotal: "18.50", lineSavings: "0.00" }),
    ], { digitalItemCount: 2, originalSubtotal: "105.50", savingsTotal: "22.16", currentSubtotal: "83.33", subtotal: "83.33" }));

    expect(model.hasOfferProjection).toBe(true);
    expect(model.lines.map(item => item.cartItemId)).toEqual(["100", "101", "102"]);
    expect(model.lines[0].currentPrice).toMatchObject({ label: "Precio unitario", rawValue: "18.49", formattedValue: "$ 18,49" });
    expect(model.lines[0].originalPrice).toMatchObject({ label: "Precio original", rawValue: "25.00" });
    expect(model.lines[0].unitSavings).toMatchObject({ label: "Ahorro por unidad", rawValue: "6.51" });
    expect(model.lines[0].originalSubtotal).toMatchObject({ label: "Subtotal original", rawValue: "75.00" });
    expect(model.lines[0].lineSavings).toMatchObject({ label: "Ahorro", rawValue: "19.53" });
    // These deliberately differ from price × quantity and original − current: the API is authoritative.
    expect(model.lines[1].currentSubtotal.rawValue).toBe("9.36");
    expect(model.lines[1].unitSavings?.rawValue).toBe("2.64");
    expect(model.lines[1].lineSavings?.rawValue).toBe("2.63");
    expect(model.lines[2].lineSavings?.rawValue).toBe("0.00");
    expect(model.summary.originalSubtotal).toMatchObject({ label: "Subtotal", rawValue: "105.50" });
    expect(model.summary.savingsTotal).toMatchObject({ label: "Ahorro total hoy", rawValue: "22.16" });
    expect(model.summary.currentSubtotal).toMatchObject({ label: "Subtotal con descuentos", rawValue: "83.33" });
  });

  it("retains zero savings when the server reports a cart without offers", () => {
    const model = toCartPricingViewModel(cart([
      line({ originalPrice: "18.49", unitSavings: "0.00", originalSubtotal: "55.47", lineSavings: "0.00" }),
    ], { originalSubtotal: "55.47", savingsTotal: "0.00", currentSubtotal: "55.47" }));
    expect(model.hasOfferProjection).toBe(true);
    expect(model.lines[0].hasOfferProjection).toBe(true);
    expect(model.lines[0].unitSavings?.formattedValue).toBe("$ 0,00");
    expect(model.summary.savingsTotal?.rawValue).toBe("0.00");
  });

  it("falls back to legacy current prices and breakdown without fabricating discounts", () => {
    const model = toCartPricingViewModel(cart(undefined, {
      subtotal: "55.47", taxRate: "15.00", taxAmount: "8.32", shippingAmount: "3.51", total: "67.31",
    }));
    expect(model.hasOfferProjection).toBe(false);
    expect(model.lines[0]).toMatchObject({ hasOfferProjection: false, originalPrice: null, unitSavings: null, originalSubtotal: null, lineSavings: null });
    expect(model.lines[0].currentSubtotal.rawValue).toBe("55.47");
    expect(model.summary).toMatchObject({ hasOfferProjection: false, originalSubtotal: null, savingsTotal: null });
    expect(model.summary.currentSubtotal).toMatchObject({ label: "Subtotal", rawValue: "55.47" });
    expect(model.summary.tax).toMatchObject({ label: "IVA (15 %)", rawValue: "8.32" });
    expect(model.summary.shipping).toMatchObject({ label: "Envío", rawValue: "3.51" });
    expect(model.summary.total).toMatchObject({ label: "Total", rawValue: "67.31" });
  });

  it("keeps missing legacy breakdown rows absent instead of summing line prices", () => {
    const model = toCartPricingViewModel(cart());
    expect(model.summary.currentSubtotal).toBeNull();
    expect(model.summary.tax).toBeNull();
    expect(model.summary.shipping).toBeNull();
    expect(model.summary.total.rawValue).toBe("67.30");
  });

  it("retains partial supplied pricing while marking the projection incomplete", () => {
    const model = toCartPricingViewModel(cart([line({ originalPrice: "25.00" })], { savingsTotal: "19.53", subtotal: "55.47" }));
    expect(model.hasOfferProjection).toBe(false);
    expect(model.lines[0].hasOfferProjection).toBe(false);
    expect(model.lines[0].originalPrice?.rawValue).toBe("25.00");
    expect(model.lines[0].unitSavings).toBeNull();
    expect(model.summary.hasOfferProjection).toBe(false);
    expect(model.summary.savingsTotal?.rawValue).toBe("19.53");
    expect(model.summary.originalSubtotal).toBeNull();
    expect(model.summary.currentSubtotal?.rawValue).toBe("55.47");
  });

  it("uses the explicit discounted subtotal and preserves amounts beyond floating-point precision", () => {
    const model = toCartPricingViewModel(cart([
      line({ currentPrice: "9007199254740993.01", currentSubtotal: "9007199254740993.02" }),
    ], { currentSubtotal: "9007199254740993.03", subtotal: "55.47", total: "9007199254740993.04" }));
    expect(model.lines[0].currentPrice.rawValue).toBe("9007199254740993.01");
    expect(model.lines[0].currentPrice.formattedValue).toBe("$ 9.007.199.254.740.993,01");
    expect(model.lines[0].currentSubtotal.rawValue).toBe("9007199254740993.02");
    expect(model.summary.currentSubtotal?.rawValue).toBe("9007199254740993.03");
    expect(model.summary.total.rawValue).toBe("9007199254740993.04");
  });
});
