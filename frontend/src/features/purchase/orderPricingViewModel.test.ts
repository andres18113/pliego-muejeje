import { describe, expect, it } from "vitest";
import type { CheckoutResult } from "@/shared/api/orders";
import { orderDetailFixture, orderSummaryFixture } from "@/test/orders";
import { toOrderPricingViewModel } from "./orderPricingViewModel";

const snapshot = { originalSubtotal: "83.00", savingsTotal: "15.13", currentSubtotal: "67.87", pricingSnapshotAvailable: true };

describe("historical order pricing presentation", () => {
  it("preserves stored prices in a mixed order despite quantities and catalog changes", () => {
    const base = orderDetailFixture().items[0];
    const model = toOrderPricingViewModel(orderDetailFixture("DELIVERED", {
      ...snapshot, subtotal: "67.87", taxAmount: "10.18", total: "78.05",
      items: [
        { ...base, quantity: 2, unitPrice: "18.49", subtotal: "36.98", originalPrice: "25.00", unitSavings: "6.51", originalSubtotal: "50.00", lineSavings: "13.02", pricingSnapshotAvailable: true },
        { ...base, orderItemId: "2", format: "EBOOK", requiresPhysicalFulfillment: false, quantity: 1, unitPrice: "9.37", subtotal: "9.39",
          originalPrice: "12.00", unitSavings: "2.64", originalSubtotal: "12.00", lineSavings: "2.63", pricingSnapshotAvailable: true },
        { ...base, orderItemId: "3", format: "AUDIOBOOK", requiresPhysicalFulfillment: false, quantity: 1, unitPrice: "21.50", subtotal: "21.50",
          originalPrice: "21.50", unitSavings: "0.00", originalSubtotal: "21.50", lineSavings: "0.00", pricingSnapshotAvailable: true },
      ],
    }));
    expect(model.pricingSnapshotAvailable).toBe(true);
    expect(model.lines.map(line => line.orderItemId)).toEqual(["1", "2", "3"]);
    expect(model.lines[0].unitPrice).toMatchObject({ rawValue: "18.49", formattedValue: "$ 18,49" });
    expect(model.lines[0].subtotal.rawValue).toBe("36.98");
    expect(model.lines[0].originalPrice?.rawValue).toBe("25.00");
    expect(model.lines[0].originalSubtotal?.rawValue).toBe("50.00");
    // Supplied values intentionally differ from multiplication/subtraction; presentation must not recompute them.
    expect(model.lines[1].subtotal.rawValue).toBe("9.39");
    expect(model.lines[1].unitSavings?.rawValue).toBe("2.64");
    expect(model.lines[1].lineSavings?.rawValue).toBe("2.63");
    expect(model.lines[2].lineSavings?.rawValue).toBe("0.00");
    expect(model.summary.originalSubtotal).toMatchObject({ label: "Subtotal", rawValue: "83.00" });
    expect(model.summary.savingsTotal).toMatchObject({ label: "Ahorro total", rawValue: "15.13" });
    expect(model.summary.currentSubtotal?.rawValue).toBe("67.87");
    expect(model.summary.tax?.rawValue).toBe("10.18");
    expect(model.summary.total.rawValue).toBe("78.05");
  });

  it("maps confirmation and list snapshot totals without inventing item prices for truncated summaries", () => {
    const confirmation: CheckoutResult = { orderId: "700", orderState: "CONFIRMED", paymentState: "APPROVED", total: "78.05", ...snapshot };
    const confirmed = toOrderPricingViewModel(confirmation);
    const listed = toOrderPricingViewModel(orderSummaryFixture({ ...snapshot, total: "78.05", taxRate: "15.00", taxAmount: "10.18" }));
    for (const model of [confirmed, listed]) {
      expect(model.orderId).toBe("700");
      expect(model.pricingSnapshotAvailable).toBe(true);
      expect(model.lines).toEqual([]);
      expect(model.summary.originalSubtotal?.rawValue).toBe("83.00");
      expect(model.summary.savingsTotal?.rawValue).toBe("15.13");
      expect(model.summary.currentSubtotal?.rawValue).toBe("67.87");
    }
    expect(listed.summary.tax).toMatchObject({ label: "IVA (15 %)", rawValue: "10.18", formattedValue: "$ 10,18" });
  });

  it("preserves paid prices for legacy null snapshots and hides unknown original prices and savings", () => {
    const detail = orderDetailFixture();
    const model = toOrderPricingViewModel({ ...detail, originalSubtotal: null, savingsTotal: null, currentSubtotal: "37.00", pricingSnapshotAvailable: false,
      items: detail.items.map(item => ({ ...item, originalPrice: null, unitSavings: null, originalSubtotal: null, lineSavings: null, pricingSnapshotAvailable: false })) });
    expect(model.pricingSnapshotAvailable).toBe(false);
    expect(model.lines[0]).toMatchObject({ pricingSnapshotAvailable: false, originalPrice: null, unitSavings: null, originalSubtotal: null, lineSavings: null });
    expect(model.lines[0].unitPrice.rawValue).toBe("18.50");
    expect(model.lines[0].subtotal.rawValue).toBe("37.00");
    expect(model.summary.originalSubtotal).toBeNull();
    expect(model.summary.savingsTotal).toBeNull();
    expect(model.summary.currentSubtotal).toMatchObject({ label: "Subtotal pagado", rawValue: "37.00" });
  });

  it("keeps pre-snapshot responses usable without synthesizing a subtotal", () => {
    const detail = toOrderPricingViewModel(orderDetailFixture());
    expect(detail.pricingSnapshotAvailable).toBe(false);
    expect(detail.summary.currentSubtotal?.rawValue).toBe("37.00");
    expect(detail.summary.savingsTotal).toBeNull();
    const summary = toOrderPricingViewModel(orderSummaryFixture());
    expect(summary.pricingSnapshotAvailable).toBe(false);
    expect(summary.summary.currentSubtotal).toBeNull();
    expect(summary.summary.tax).toBeNull();
    expect(summary.summary.total.rawValue).toBe("42.55");
  });

  it("requires both the server snapshot flag and complete amounts before exposing historical savings", () => {
    const incomplete = toOrderPricingViewModel(orderSummaryFixture({ ...snapshot, originalSubtotal: null }));
    expect(incomplete.pricingSnapshotAvailable).toBe(false);
    expect(incomplete.summary.savingsTotal).toBeNull();
    const unconfirmed = toOrderPricingViewModel(orderSummaryFixture({ ...snapshot, pricingSnapshotAvailable: undefined }));
    expect(unconfirmed.pricingSnapshotAvailable).toBe(false);
    expect(unconfirmed.summary.originalSubtotal).toBeNull();
    const detail = orderDetailFixture();
    const partialLine = toOrderPricingViewModel({ ...detail, ...snapshot, items: detail.items.map(item => ({ ...item, pricingSnapshotAvailable: true, originalPrice: "25.00" })) });
    expect(partialLine.pricingSnapshotAvailable).toBe(false);
    expect(partialLine.summary.pricingSnapshotAvailable).toBe(true);
    expect(partialLine.lines[0].originalPrice).toBeNull();
    expect(partialLine.lines[0].unitPrice.rawValue).toBe("18.50");
  });

  it("keeps explicit no-offer snapshots distinguishable from unknown legacy savings", () => {
    const model = toOrderPricingViewModel(orderSummaryFixture({ originalSubtotal: "37.00", savingsTotal: "0.00", currentSubtotal: "37.00", pricingSnapshotAvailable: true }));
    expect(model.pricingSnapshotAvailable).toBe(true);
    expect(model.summary.savingsTotal).toMatchObject({ rawValue: "0.00", formattedValue: "$ 0,00" });
  });

  it("formats immutable amounts without floating-point precision loss", () => {
    const model = toOrderPricingViewModel(orderSummaryFixture({ ...snapshot, currentSubtotal: "9007199254740993.03", total: "9007199254740993.04" }));
    expect(model.summary.currentSubtotal?.rawValue).toBe("9007199254740993.03");
    expect(model.summary.total.formattedValue).toBe("$ 9.007.199.254.740.993,04");
  });
});
