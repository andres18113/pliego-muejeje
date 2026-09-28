import type { CartLine } from "@/shared/api/cart";

const orderStates: Record<string, string> = {
  PENDING_PAYMENT: "Pendiente de pago",
  CONFIRMED: "Confirmado",
  PREPARING: "En preparación",
  SHIPPED: "Enviado",
  DELIVERED: "Entregado",
  CANCELLED: "Cancelado",
};

const paymentStates: Record<string, string> = {
  PENDING: "Pendiente",
  APPROVED: "Aprobado",
  REJECTED: "Rechazado",
  REFUNDED: "Reembolsado",
};

const paymentMethods: Record<string, string> = {
  CARD: "Tarjeta",
  TRANSFER: "Transferencia",
};

export function orderStateLabel(state: string) {
  return orderStates[state] ?? "Estado no reconocido";
}

export function paymentStateLabel(state: string) {
  return paymentStates[state] ?? "Estado no reconocido";
}

export function paymentMethodLabel(method: string) {
  return paymentMethods[method] ?? "Método no reconocido";
}

export function orderDateLabel(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.valueOf()) ? "Fecha no disponible" : new Intl.DateTimeFormat("es-EC", {
    dateStyle: "long", timeZone: "America/Guayaquil",
  }).format(date);
}

export function orderMomentLabel(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.valueOf()) ? "Fecha no disponible" : new Intl.DateTimeFormat("es-EC", {
    dateStyle: "medium", timeStyle: "short", timeZone: "America/Guayaquil",
  }).format(date);
}

/** `reason` is the canonical SQLSTATE reported by `GET /cart` (API amendment v1.0.3). */
export function unavailabilityText(reason: CartLine["unavailabilityReason"]) {
  if (reason === "P3002") return "No hay existencias suficientes para esta cantidad.";
  if (reason === "P2042") return "Esta edición ya no está a la venta.";
  if (reason === "P2043") return "Este libro ya no está a la venta.";
  return "No está disponible por ahora.";
}

/** Inactive editions and books cannot change quantity; only removal is meaningful. */
export function canChangeQuantity(reason: CartLine["unavailabilityReason"]) {
  return reason !== "P2042" && reason !== "P2043";
}

export function unitsLabel(count: number) {
  const formatted = new Intl.NumberFormat("es-EC").format(count);
  return count === 1 ? "1 unidad" : `${formatted} unidades`;
}

export function isLuhnValid(digits: string) {
  if (!/^[0-9]{12,19}$/.test(digits)) return false;
  let sum = 0;
  let double = false;
  for (let index = digits.length - 1; index >= 0; index -= 1) {
    let digit = digits.charCodeAt(index) - 48;
    if (double) {
      digit *= 2;
      if (digit > 9) digit -= 9;
    }
    sum += digit;
    double = !double;
  }
  return sum % 10 === 0;
}

export function normalizeCardNumber(value: string) {
  return value.replace(/[\s-]/g, "");
}

export type CardBrand = "visa" | "mastercard" | "amex" | "diners";

export function detectCardBrand(value: string): CardBrand | null {
  const digits = normalizeCardNumber(value);
  if (/^4/.test(digits)) return "visa";
  if (/^5[1-5]/.test(digits)) return "mastercard";
  if (/^2[2-7]\d{2}/.test(digits) && Number(digits.slice(0, 4)) <= 2720) return "mastercard";
  if (/^(34|37)/.test(digits)) return "amex";
  if (/^(30[0-5]|3095|36|38|39)/.test(digits)) return "diners";
  return null;
}

export function formatCardNumber(value: string) {
  const brand = detectCardBrand(value);
  const digits = value.replace(/\D/g, "").slice(0, brand === "amex" ? 15 : 19);
  if (brand === "amex") return [digits.slice(0, 4), digits.slice(4, 10), digits.slice(10, 15)].filter(Boolean).join(" ");
  return digits.match(/.{1,4}/g)?.join(" ") ?? "";
}
