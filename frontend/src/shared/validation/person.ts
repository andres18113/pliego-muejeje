import { z } from "zod";
import { parsePhoneNumberFromString } from "libphonenumber-js/max";
import rules from "../../../../shared/validation/person-rules.json";

export * from "./personName";

const spaces = new RegExp(rules.spaceSeparatorPattern, "gu");
const outerWhitespace = new RegExp(rules.outerWhitespacePattern, "gu");
const phonePresentation = new RegExp(rules.phonePresentationPattern);
const canonicalPhone = new RegExp(rules.canonicalPhonePattern);

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
  if (!canonical.startsWith("+593")) return rules.messages.phoneCountry;
  const national = canonical.slice(4);
  if (national.startsWith("0")) return rules.messages.phoneChangedDigits;
  if (!/^[0-9]+$/.test(national)) return rules.messages.phoneCharacters;
  if (national.length > rules.maxNationalPhoneDigits) return rules.messages.phoneTooLong;
  if (national.startsWith("9") && national.length !== 9) return rules.messages.phoneMobileLength;
  if (/^[2-7]/.test(national) && national.length !== 8) return rules.messages.phoneFixedLength;
  if (!/^[2-7]|^9/.test(national)) return rules.messages.phoneStart;
  if (!canonicalPhone.test(canonical)) return rules.messages.phoneInvalid;
  const parsed = parsePhoneNumberFromString(canonical);
  if (parsed && parsed.number !== canonical) return rules.messages.phoneChangedDigits;
  return parsed?.country === "EC" && parsed.isValid() && ["FIXED_LINE", "MOBILE", "FIXED_LINE_OR_MOBILE"].includes(parsed.getType() ?? "")
    ? null : rules.messages.phoneInvalid;
}

export const optionalPhoneSchema = z.string().superRefine((value, context) => {
  const message = phoneError(value);
  if (message) context.addIssue({ code: "custom", message });
}).transform(normalizePhonePresentation);
