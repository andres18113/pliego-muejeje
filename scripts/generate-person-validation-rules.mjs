import { writeFileSync } from "node:fs";

// Pin the accepted repertoire; the resulting literal pattern is shared by JS,
// Java and PostgreSQL rather than inheriting their differing Unicode/locale data.
if (process.versions.unicode !== "17.0") throw new Error("Generate this contract with Unicode 17.0.");
function ranges(property) {
  const match = new RegExp(`\\p{${property}}`, "u");
  const parts = []; let first = null, last = null;
  const flush = () => {
    if (first === null) return;
    parts.push(first === last ? String.fromCodePoint(first) : `${String.fromCodePoint(first)}-${String.fromCodePoint(last)}`);
    first = last = null;
  };
  for (let code = 0; code <= 0x10ffff; code++) {
    if (match.test(String.fromCodePoint(code))) { if (first === null) first = code; last = code; }
    else flush();
  }
  flush(); return parts.join("");
}
const letters = ranges("L"), marks = ranges("M");
const rules = {
  version: "1", unicodeVersion: "17.0", maxNameCodePoints: 120, maxRecipientCodePoints: 241,
  namePattern: `^[${letters}][${letters}${marks}]*(?:(?: +|['’‐‑-])[${letters}][${letters}${marks}]*)*$`,
  spaceSeparatorPattern: `[${ranges("Zs")}]`, outerWhitespacePattern: "^[\\t\\n\\x0b\\f\\r ]+|[\\t\\n\\x0b\\f\\r ]+$",
  phonePresentationPattern: "^[+0-9 ().\\-\\t\\n\\r]+$", canonicalPhonePattern: "^\\+[1-9][0-9]{6,14}$", phoneMetadataVersion: "9.0.40",
  messages: {
    nameEmpty: "Escribe tus {label}.", nameTooLong: "Tus {label} no pueden superar 120 caracteres.",
    nameCharacters: "Tus {label} solo pueden contener letras, espacios, apóstrofes y guiones.",
    phonePrefix: "Incluye el prefijo internacional, por ejemplo +593 99 123 4567.",
    phoneCharacters: "Usa solo dígitos, espacios, paréntesis, puntos o guiones; no incluyas letras ni extensiones.",
    phoneInvalid: "Revisa el prefijo internacional y el número: no corresponden a un teléfono válido.",
    phoneChangedDigits: "Revisa el prefijo internacional: no incluyas el cero de marcación nacional después del código de país.",
    recipientEmpty: "Escribe quién recibe el pedido.", recipientTooLong: "El destinatario no puede superar 241 caracteres.",
  },
};
writeFileSync(new URL("../shared/validation/person-rules.json", import.meta.url), JSON.stringify(rules, null, 2) + "\n");
