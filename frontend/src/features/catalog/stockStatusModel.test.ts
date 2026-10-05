import { describe, expect, it } from "vitest";
import { availabilityConflictMessage, resolveStockStatus, type StockAvailability } from "./stockStatusModel";

describe("StockStatus contract", () => {
  it("lets an invalid digital quantity be corrected without allowing more units", () => {
    const state = resolveStockStatus({ available: false, unavailabilityReason: "P4004" });
    expect(state.canChangeQuantity).toBe(true);
    expect(state.canIncreaseQuantity).toBe(false);
    expect(state.explanation).toContain("una unidad");
  });
  it("keeps an insufficient cart quantity separate from the edition's confirmed read", () => {
    expect(availabilityConflictMessage("P3002")).toBe("No hay existencias suficientes para esta cantidad en tu carrito.");
    expect(resolveStockStatus({ available: true }).label).toBe("Disponible");
    expect(availabilityConflictMessage("P3001")).toBe("No pudimos confirmar la disponibilidad de esta edición.");
    expect(availabilityConflictMessage("UNAUTHORIZED")).toBeNull();
    expect(availabilityConflictMessage("P4004")).toBeNull();
  });
  it.each<{ input: StockAvailability; label: string; explanation: string | null }>([
    { input: { available: true }, label: "Disponible", explanation: null },
    { input: { available: false }, label: "No disponible", explanation: null },
    { input: { available: false, unavailabilityReason: "P3002" }, label: "No disponible", explanation: "No hay existencias suficientes para esta cantidad." },
    { input: { available: false, unavailabilityReason: "P2042" }, label: "No disponible", explanation: "Esta edición ya no está a la venta." },
    { input: { available: false, unavailabilityReason: "P2043" }, label: "No disponible", explanation: "Este libro ya no está a la venta." },
  ])("maps the API input $input to the approved Spanish meaning", ({ input, label, explanation }) => {
    expect(resolveStockStatus(input)).toMatchObject({ label, explanation, tone: input.available ? "success" : "danger" });
  });

  it.each(["P2042", "P2043", "P3002"] as const)("keeps availability authoritative when %s is stale", (reason) => {
    expect(resolveStockStatus({ available: true, unavailabilityReason: reason })).toMatchObject({ state: "available", label: "Disponible", icon: "check_circle", explanation: null });
  });

  it("does not infer an out-of-stock cause when the API provides no reason", () => {
    const status = resolveStockStatus({ available: false, unavailabilityReason: null });
    expect(status).toMatchObject({ state: "unavailable", label: "No disponible", icon: "block", explanation: null });
    expect(status.label).not.toContain("Agotado");
  });
});

it("permits recovery by reducing an insufficient quantity, and only removal for inactive editions", () => {
  expect(resolveStockStatus({ available: false, unavailabilityReason: "P3002" })).toMatchObject({ canAddToCart: false, canChangeQuantity: true, canIncreaseQuantity: false });
  expect(resolveStockStatus({ available: false, unavailabilityReason: "P2042" })).toMatchObject({ canAddToCart: false, canChangeQuantity: false, canIncreaseQuantity: false });
});
