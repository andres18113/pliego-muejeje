
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

export function orderShortDateLabel(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.valueOf()) ? "Fecha no disponible" : new Intl.DateTimeFormat("es-EC", {
    day: "numeric", month: "short", year: "numeric", timeZone: "America/Guayaquil",
  }).format(date);
}

export function orderMomentLabel(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.valueOf()) ? "Fecha no disponible" : new Intl.DateTimeFormat("es-EC", {
    dateStyle: "medium", timeStyle: "short", timeZone: "America/Guayaquil",
  }).format(date);
}

const shipmentStates: Record<string, string> = {
  PENDING: "Por preparar",
  PREPARING: "En preparación",
  IN_TRANSIT: "En camino",
  SHIPPED: "Enviado",
  OUT_FOR_DELIVERY: "En reparto",
  DELIVERED: "Entregado",
  CANCELLED: "Envío cancelado",
};

const purchaseStates: Record<string, string> = {
  PENDING_PAYMENT: "Pendiente de pago",
  CONFIRMED: "Compra confirmada",
  COMPLETED: "Compra completada",
  CANCELLED: "Compra cancelada",
};

const identityTypes: Record<string, string> = {
  NATIONAL_ID: "Cédula",
  TAX_ID: "RUC",
  PASSPORT: "Pasaporte",
  OTHER: "Identificación",
};

const electronicStates: Record<string, string> = {
  SUBMITTED: "Enviado para autorización",
  AUTHORIZED: "Autorizado",
  REJECTED: "Rechazado por el sistema de autorización",
};

export function shipmentStateLabel(state: string) {
  return shipmentStates[state] ?? "Estado no reconocido";
}

export function purchaseStateLabel(state: string) {
  return purchaseStates[state] ?? "Estado no reconocido";
}

export function identityTypeLabel(type: string) {
  return identityTypes[type] ?? "Identificación";
}

export function electronicIssuanceLabel(state: string) {
  return electronicStates[state] ?? "Estado no reconocido";
}

const dayFormat = new Intl.DateTimeFormat("es-EC", { weekday: "long", day: "numeric", month: "long", timeZone: "America/Guayaquil" });

/** "el martes 6 de octubre" or "entre el martes 6 y el miércoles 7 de octubre"; null when the server sent no window. */
export function deliveryWindowLabel(from: string | null, to: string | null) {
  if (!from || !to) return null;
  const start = new Date(from), end = new Date(to);
  if (Number.isNaN(start.valueOf()) || Number.isNaN(end.valueOf())) return null;
  const startLabel = dayFormat.format(start), endLabel = dayFormat.format(end);
  return startLabel === endLabel ? `el ${startLabel}` : `entre el ${startLabel} y el ${endLabel}`;
}

export function booksLabel(count: number) {
  const formatted = new Intl.NumberFormat("es-EC").format(count);
  return count === 1 ? "1 libro" : `${formatted} libros`;
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

/** Names the tax with the rate the backend applied; the rate is displayed, never used to calculate. */
export function ivaLabel(rate: string | null | undefined) {
  const percent = rate ? Number(rate) : NaN;
  return Number.isFinite(percent) ? `IVA (${new Intl.NumberFormat("es-EC", { maximumFractionDigits: 2 }).format(percent)} %)` : "IVA";
}

const shortMonths = ["Ene", "Feb", "Mar", "Abr", "May", "Jun", "Jul", "Ago", "Sep", "Oct", "Nov", "Dic"] as const;

/**
 * Formats the delivery window the server computed, given as calendar dates (`YYYY-MM-DD`, already in the store's
 * Ecuador calendar): "5 Oct - 7 Oct", with the years when the window crosses one ("31 Dic 2026 - 2 Ene 2027").
 * The dates are read as written — never through `Date`, so the viewer's time zone cannot move them — and nothing
 * is derived here: without both dates there is no label.
 */
export function deliveryDateRangeLabel(from: string | null | undefined, to: string | null | undefined) {
  const start = parseCalendarDate(from), end = parseCalendarDate(to);
  if (!start || !end) return null;
  const withYear = start.year !== end.year;
  const label = (date: { year: number; month: number; day: number }) =>
    `${date.day} ${shortMonths[date.month - 1]}${withYear ? ` ${date.year}` : ""}`;
  return `${label(start)} - ${label(end)}`;
}

function parseCalendarDate(value: string | null | undefined) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value ?? "");
  if (!match) return null;
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  return month >= 1 && month <= 12 && day >= 1 && day <= 31 ? { year, month, day } : null;
}
