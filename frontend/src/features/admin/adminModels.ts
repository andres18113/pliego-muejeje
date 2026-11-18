/**
 * Presentation vocabulary for the administration area. Every state, permission and transition comes from the
 * server (ADR 0047): these helpers only word what the API reports, in the customer's own terms where they meet.
 */

export type PickupState = "PENDING" | "READY" | "COLLECTED" | "CANCELLED";

export const pickupStateFilters: { value: PickupState; label: string }[] = [
  { value: "READY", label: "Listos para retirar" },
  { value: "PENDING", label: "En preparación" },
  { value: "COLLECTED", label: "Retirados" },
  { value: "CANCELLED", label: "Cancelados" },
];

export function pickupStateLabel(state: string | null | undefined) {
  switch (state) {
    case "READY": return "Listo para retirar";
    case "PENDING": return "En preparación";
    case "COLLECTED": return "Retirado";
    case "CANCELLED": return "Cancelado";
    default: return "Estado no disponible";
  }
}

/** Pickup codes avoid 0/O and 1/I; staff type what the customer reads, so the input is normalized, never guessed. */
export function normalizePickupCode(value: string) {
  const compact = value.toUpperCase().replace(/[\s-]+/g, "");
  if (!compact) return "";
  return compact.startsWith("P") && compact.length > 1 ? `P-${compact.slice(1)}` : `P-${compact}`;
}

export type CorrectionStatus = "PENDING" | "APPROVED" | "REJECTED" | "WITHDRAWN";

export const correctionStatusFilters: { value: CorrectionStatus; label: string }[] = [
  { value: "PENDING", label: "Por revisar" },
  { value: "APPROVED", label: "Aprobadas" },
  { value: "REJECTED", label: "Rechazadas" },
  { value: "WITHDRAWN", label: "Retiradas" },
];

export function correctionStatusLabel(status: string | null | undefined) {
  switch (status) {
    case "PENDING": return "Por revisar";
    case "APPROVED": return "Aprobada";
    case "REJECTED": return "Rechazada";
    case "WITHDRAWN": return "Retirada por el cliente";
    default: return "Estado no disponible";
  }
}

/** The customer's own reasons, as the correction form offers them (IdentityCorrectionPage). */
export function correctionReasonLabel(reason: string | null | undefined) {
  switch (reason) {
    case "DOCUMENT_TYPO": return "Lo escribió mal";
    case "DOCUMENT_CHANGED": return "Ahora usa otro documento";
    default: return "Otro motivo";
  }
}

export function identityTypeLabel(type: string | null | undefined) {
  if (type === "EC_RUC") return "RUC";
  if (type === "EC_CEDULA") return "Cédula";
  return "Identificación";
}

const dateTime = new Intl.DateTimeFormat("es-EC", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
const dateOnly = new Intl.DateTimeFormat("es-EC", { day: "numeric", month: "long", year: "numeric" });

export function adminMomentLabel(value: string | null | undefined) {
  if (!value) return null;
  const at = new Date(value);
  return Number.isNaN(at.getTime()) ? null : dateTime.format(at).replace(/\.(?=\s|,|$)/g, "");
}

export function adminDateLabel(value: string | null | undefined) {
  if (!value) return null;
  const at = new Date(value);
  return Number.isNaN(at.getTime()) ? null : dateOnly.format(at);
}

/** How close a review is to its deadline: wording for the due line, never a decision. */
export function correctionUrgency(dueAt: string | null | undefined, now = Date.now()): "overdue" | "soon" | "normal" {
  const due = dueAt ? Date.parse(dueAt) : Number.NaN;
  if (!Number.isFinite(due)) return "normal";
  if (due <= now) return "overdue";
  return due - now <= 24 * 60 * 60 * 1000 ? "soon" : "normal";
}

/**
 * Domain errors arrive with the database's stable code (`P5017`); a few layers also expose the symbolic name. Match
 * either, from the approved SQLSTATE mapping (DatabaseError), never by message text.
 */
const domainCodes = {
  ORDER_INVALID_TRANSITION: "P5002", ORDER_NOT_CANCELLABLE: "P5003", PICKUP_CODE_INVALID: "P5013",
  PICKUP_NOT_FOUND: "P5016", PICKUP_ALREADY_COLLECTED: "P5017", PICKUP_NOT_READY: "P5018",
  BILLING_IDENTITY_CONFLICT: "P1105", BILLING_IDENTITY_CORRECTION_NOT_FOUND: "P1109",
  BILLING_IDENTITY_CORRECTION_INVALID_TRANSITION: "P1111",
} as const;
export type DomainErrorName = keyof typeof domainCodes;
export function isDomainError(error: unknown, name: DomainErrorName) {
  const code = (error as { code?: unknown } | null)?.code;
  return code === domainCodes[name] || code === name;
}
