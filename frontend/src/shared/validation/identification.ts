/**
 * Ecuadorian cédula and RUC by algorithm only (ADR 0041); it never proves existence or ownership.
 * Same rules as PostgreSQL fn_is_valid_ec_identification and Java EcuadorianIdentification, checked against
 * shared/validation/ec-identification-cases.json.
 *  Cédula: 10 digits, not all equal, province 01–24 or 30, third digit 0–5, modulo 10.
 *  RUC: 13 digits. Third digit 0–5: a valid cédula + establishment 001–999. 6 (public sector): modulo 11 over
 *  8 digits, check at digit 9, establishment 0001–9999. 9 (private company): modulo 11 over 9 digits, check at
 *  digit 10, establishment 001–999.
 */
export type IdentificationType = "EC_CEDULA" | "EC_RUC";
export type LiveCheck = { tone: "help" | "error" | "success"; message: string; type: IdentificationType | null };

export const identificationMessage = "Ingresa una cédula (10 dígitos) o un RUC (13 dígitos) válidos";
const PUBLIC_WEIGHTS = [3, 2, 7, 6, 5, 4, 3, 2];
const PRIVATE_WEIGHTS = [4, 3, 2, 7, 6, 5, 4, 3, 2];

/** Same ASCII-space trimming as the server; nothing else is rewritten in the customer's identity. */
export function normalizeIdentification(value: string) { return value.replace(/^ +| +$/g, ""); }

/** The kind a complete number has: 10 digits are a cédula, 13 a RUC. */
export function identificationType(value: string): IdentificationType | null {
  const number = normalizeIdentification(value);
  return number.length === 10 ? "EC_CEDULA" : number.length === 13 ? "EC_RUC" : null;
}

function provinceValid(number: string) { const province = Number(number.slice(0, 2)); return province >= 1 && province <= 24 || province === 30; }
function moduloTen(number: string) {
  let sum = 0;
  for (let index = 0; index < 9; index++) {
    const product = Number(number[index]) * (index % 2 === 0 ? 2 : 1);
    sum += product > 9 ? product - 9 : product;
  }
  return (10 - sum % 10) % 10;
}
/** -1 when the remainder leaves no valid check digit. */
function moduloEleven(number: string, weights: number[]) {
  const check = 11 - weights.reduce((sum, weight, index) => sum + Number(number[index]) * weight, 0) % 11;
  return check === 11 ? 0 : check === 10 ? -1 : check;
}
function cedulaValid(number: string) {
  return /^[0-9]{10}$/.test(number) && !/^(\d)\1{9}$/.test(number) && provinceValid(number) && Number(number[2]) < 6 && moduloTen(number) === Number(number[9]);
}

export function isValidIdentification(type: unknown, value: unknown): boolean {
  if (typeof value !== "string" || (type !== "EC_CEDULA" && type !== "EC_RUC")) return false;
  const number = normalizeIdentification(value);
  if (type === "EC_CEDULA") return cedulaValid(number);
  if (!/^[0-9]{13}$/.test(number) || !provinceValid(number)) return false;
  const third = Number(number[2]);
  if (third < 6) return cedulaValid(number.slice(0, 10)) && number.slice(10) !== "000";
  if (third === 6) return moduloEleven(number, PUBLIC_WEIGHTS) === Number(number[8]) && number.slice(9) !== "0000";
  if (third === 9) return moduloEleven(number, PRIVATE_WEIGHTS) === Number(number[9]) && number.slice(10) !== "000";
  return false;
}

const missing = (count: number) => count === 1 ? "falta 1 dígito" : `faltan ${count} dígitos`;

/**
 * What the field says while the customer types, digit by digit. Every fact that can already be judged is judged
 * (only digits, province, third digit, check digit, establishment); what cannot yet be judged is counted, never
 * reported as an error. One message at a time.
 */
export function liveIdentificationCheck(value: string): LiveCheck {
  const number = normalizeIdentification(value);
  if (!number) return { tone: "help", message: "Cédula: 10 dígitos. RUC: 13 dígitos.", type: null };
  if (/[^0-9]/.test(number)) return { tone: "error", message: "Usa solo números, sin espacios ni guiones.", type: null };
  if (number.length > 13) return { tone: "error", message: "Sobran dígitos: la cédula tiene 10 y el RUC 13.", type: null };
  if (number.length >= 2 && !provinceValid(number)) return { tone: "error", message: "Los dos primeros dígitos deben ser una provincia: del 01 al 24, o 30.", type: null };
  if (number.length < 3) return { tone: "help", message: `Cédula: ${missing(10 - number.length)}. RUC: ${missing(13 - number.length)}.`, type: null };
  const third = Number(number[2]);
  if (third === 7 || third === 8) return { tone: "error", message: "El tercer dígito no corresponde a una cédula ni a un RUC.", type: null };
  if (third < 6) {
    if (number.length < 10) return { tone: "help", message: `Cédula: ${missing(10 - number.length)}.`, type: "EC_CEDULA" };
    if (!cedulaValid(number.slice(0, 10))) return { tone: "error", message: /^(\d)\1{9}/.test(number) ? "La cédula no puede repetir un solo dígito." : "El dígito verificador no coincide. Revisa los números.", type: number.length === 10 ? "EC_CEDULA" : "EC_RUC" };
    if (number.length === 10) return { tone: "success", message: "Cédula válida.", type: "EC_CEDULA" };
    if (number.length < 13) return { tone: "help", message: `RUC: ${missing(13 - number.length)}.`, type: "EC_RUC" };
    return number.endsWith("000")
      ? { tone: "error", message: "El establecimiento del RUC no puede ser 000.", type: "EC_RUC" }
      : { tone: "success", message: "RUC de persona natural válido.", type: "EC_RUC" };
  }
  const isPublic = third === 6, checkAt = isPublic ? 9 : 10, kind = isPublic ? "de entidad pública" : "de sociedad";
  if (number.length >= checkAt && moduloEleven(number, isPublic ? PUBLIC_WEIGHTS : PRIVATE_WEIGHTS) !== Number(number[checkAt - 1])) {
    return { tone: "error", message: "El dígito verificador del RUC no coincide. Revisa los números.", type: "EC_RUC" };
  }
  if (number.length < 13) return { tone: "help", message: `RUC ${kind}: ${missing(13 - number.length)}.`, type: "EC_RUC" };
  return number.slice(checkAt) === "0".repeat(13 - checkAt)
    ? { tone: "error", message: `El establecimiento del RUC no puede ser ${"0".repeat(13 - checkAt)}.`, type: "EC_RUC" }
    : { tone: "success", message: `RUC ${kind} válido.`, type: "EC_RUC" };
}

/** The final judgement on leaving the field or submitting: null when valid. */
export function identificationError(value: string): string | null {
  const number = normalizeIdentification(value);
  if (!number) return "Escribe tu cédula o RUC.";
  const live = liveIdentificationCheck(number);
  if (live.tone === "error") return live.message;
  if (live.tone === "help") return "Completa la cédula (10 dígitos) o el RUC (13 dígitos).";
  return null;
}
