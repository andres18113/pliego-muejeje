import { z } from "zod";
import rules from "../../../../shared/validation/person-rules.json";

// Name and recipient rules only: kept apart from phone validation so modules on the
// public first-load path (billing schemas via the profile query) do not pull in libphonenumber.
const namePattern = new RegExp(rules.namePattern, "u");
const spaces = new RegExp(rules.spaceSeparatorPattern, "gu");
const outerWhitespace = new RegExp(rules.outerWhitespacePattern, "gu");
export const maxRecipientLength = rules.maxRecipientCodePoints;
export const recipientEmptyMessage = rules.messages.recipientEmpty;
export const recipientTooLongMessage = rules.messages.recipientTooLong;

export function normalizePersonName(value: string) {
  return value.normalize("NFC").replace(spaces, " ").replace(outerWhitespace, "");
}

export function personNameError(value: string, label: "nombres" | "apellidos") {
  const normalized = normalizePersonName(value);
  const message = !normalized ? rules.messages.nameEmpty
    : [...normalized].length > rules.maxNameCodePoints ? rules.messages.nameTooLong
    : !namePattern.test(normalized) ? rules.messages.nameCharacters : null;
  return message?.replace("{label}", label) ?? null;
}

export const personNameSchema = (label: "nombres" | "apellidos") => z.string()
  .transform(normalizePersonName)
  .superRefine((value, context) => {
    const message = personNameError(value, label);
    if (message) context.addIssue({ code: "custom", message });
  });

/** Allow partial names while editing, preserving the pinned Unicode repertoire. */
export function personNameInputError(value: string, maxLength = rules.maxNameCodePoints) {
  if ([...value.normalize("NFC")].length > maxLength) return `No puedes escribir más de ${maxLength} caracteres.`;
  const letters = normalizePersonName(value).replace(/[ '’‐‑-]/gu, "");
  return letters && !namePattern.test(letters) ? "Usa solo letras, espacios, apóstrofes y guiones." : null;
}

export function recipientError(value: string) {
  if (!value.trim()) return recipientEmptyMessage;
  if ([...normalizePersonName(value)].length > maxRecipientLength) return recipientTooLongMessage;
  return namePattern.test(normalizePersonName(value)) ? null : rules.messages.recipientCharacters;
}
