import { z } from "zod";
import { parsePhoneNumberFromString } from "libphonenumber-js/max";
import rules from "../../../../shared/validation/person-rules.json";

const namePattern = new RegExp(rules.namePattern, "u");
const spaces = new RegExp(rules.spaceSeparatorPattern, "gu");
const outerWhitespace = new RegExp(rules.outerWhitespacePattern, "gu");
const phonePresentation = new RegExp(rules.phonePresentationPattern);
const canonicalPhone = new RegExp(rules.canonicalPhonePattern);
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

export function normalizePhonePresentation(value: string) {
  const normalized = value.replace(spaces, " ").replace(outerWhitespace, "");
  return phonePresentation.test(normalized) ? normalized.replace(/[ ().\-\t\n\r]/g, "") : normalized;
}

export function phoneCharactersError(value: string) {
  const presentation=value.replace(spaces," ").replace(outerWhitespace,"");
  return !presentation || phonePresentation.test(presentation) ? null : rules.messages.phoneCharacters;
}

export function phoneError(value: string, required = false) {
  const presentation = value.replace(spaces, " ").replace(outerWhitespace, "");
  if (!presentation) return required ? "Escribe un teléfono de contacto." : null;
  if (!phonePresentation.test(presentation)) return rules.messages.phoneCharacters;
  const canonical = normalizePhonePresentation(presentation);
  if (!canonical.startsWith("+")) return rules.messages.phonePrefix;
  if (!canonicalPhone.test(canonical)) return rules.messages.phoneInvalid;
  const parsed = parsePhoneNumberFromString(canonical);
  if (parsed && parsed.number !== canonical) return rules.messages.phoneChangedDigits;
  return parsed?.isValid() ? null : rules.messages.phoneInvalid;
}

export const optionalPhoneSchema = z.string().superRefine((value, context) => {
  const message = phoneError(value);
  if (message) context.addIssue({ code: "custom", message });
}).transform(normalizePhonePresentation);

export function recipientError(value: string) {
  if (!value.trim()) return recipientEmptyMessage;
  return [...value.trim()].length > maxRecipientLength ? recipientTooLongMessage : null;
}
