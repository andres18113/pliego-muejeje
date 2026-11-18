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
    { input: { available: false, unavailabilityReason: "OUT_OF_STOCK" }, label: "Agotado", explanation: "No quedan ejemplares de esta edición." },
    { input: { available: false, unavailabilityReason: "P2042" }, label: "Fuera de venta", explanation: "Esta edición ya no está a la venta." },
    { input: { available: false, unavailabilityReason: "P2043" }, label: "Fuera de venta", explanation: "Este libro ya no está a la venta." },
  ])("maps the API input $input to the approved Spanish meaning", ({ input, label, explanation }) => {
    expect(resolveStockStatus(input)).toMatchObject({ label, explanation, tone: input.available ? "success" : "danger" });
  });

  it.each(["P2042", "P2043", "P3002", "OUT_OF_STOCK"] as const)("keeps availability authoritative when %s is stale", (reason) => {
    expect(resolveStockStatus({ available: true, unavailabilityReason: reason })).toMatchObject({ state: "available", label: "Disponible", icon: "check_circle", explanation: null });
  });

  it("does not infer an out-of-stock cause when the API provides no reason", () => {
    const status = resolveStockStatus({ available: false, unavailabilityReason: null });
    expect(status).toMatchObject({ state: "unavailable", label: "No disponible", icon: "block", explanation: null });
    expect(status.label).not.toContain("Agotado");
  });

  it("tells out of stock from no longer for sale, and neither promises a restock nor declares it gone for good", () => {
    const outOfStock = resolveStockStatus({ available: false, unavailabilityReason: "OUT_OF_STOCK" });
    const inactive = resolveStockStatus({ available: false, unavailabilityReason: "P2042" });
    expect(outOfStock.label).not.toBe(inactive.label);
    for (const status of [outOfStock, inactive, resolveStockStatus({ available: false, unavailabilityReason: "P2043" })]) {
      expect(`${status.label} ${status.explanation}`).not.toMatch(/pronto|volver|repon|próximamente|avis|nunca|definitiv/i);
      expect(status).toMatchObject({ canAddToCart: false, canChangeQuantity: false, canIncreaseQuantity: false });
    }
  });
});

it("permits recovery by reducing an insufficient quantity, and only removal for inactive editions", () => {
  expect(resolveStockStatus({ available: false, unavailabilityReason: "P3002" })).toMatchObject({ canAddToCart: false, canChangeQuantity: true, canIncreaseQuantity: false });
  expect(resolveStockStatus({ available: false, unavailabilityReason: "P2042" })).toMatchObject({ canAddToCart: false, canChangeQuantity: false, canIncreaseQuantity: false });
});

it.each([
  ["P6002", "Ya está en tu biblioteca"],
  ["P6003", "Tienes un pedido abierto con esta edición"],
] as const)("explains %s consistently for reads and command conflicts", (code, message) => {
  expect(availabilityConflictMessage(code)).toBe(message);
  expect(resolveStockStatus({ available: false, unavailabilityReason: code })).toMatchObject({ explanation: message, canAddToCart: false, canChangeQuantity: false });
});
