import { writeFileSync } from "node:fs";
import metadata from "../frontend/node_modules/libphonenumber-js/metadata.max.json" with { type: "json" };

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
const contactPatterns = metadata.countries.EC[11];
const rules = {
  version: "2", unicodeVersion: "17.0", maxNameCodePoints: 120, maxRecipientCodePoints: 241,
  namePattern: `^[${letters}][${letters}${marks}]*(?:(?: +|['’‐‑-])[${letters}][${letters}${marks}]*)*$`,
  spaceSeparatorPattern: `[${ranges("Zs")}]`, outerWhitespacePattern: "^[\\t\\n\\x0b\\f\\r ]+|[\\t\\n\\x0b\\f\\r ]+$",
  phonePresentationPattern: "^[+0-9 ().\\-\\t\\n\\r]+$",
  canonicalPhonePattern: `^\\+593(?:${contactPatterns[0][0]}|${contactPatterns[1][0]})$`, phoneMetadataVersion: "9.0.40",
  phoneCountry: "EC", phoneCallingCode: "593", maxNationalPhoneDigits: 9,
  messages: {
    nameEmpty: "Escribe tus {label}.", nameTooLong: "Tus {label} no pueden superar 120 caracteres.",
    nameCharacters: "Tus {label} solo pueden contener letras, espacios, apóstrofes y guiones.",
    phonePrefix: "Usa el prefijo de Ecuador (+593).",
    phoneCharacters: "Escribe solo dígitos en el número de teléfono.",
    phoneInvalid: "Revisa los dígitos: ese número no corresponde a un celular o fijo válido de Ecuador.",
    phoneChangedDigits: "Escribe el número sin el 0 inicial; el prefijo +593 ya está incluido.",
    phoneCountry: "Solo se aceptan teléfonos de Ecuador (+593).",
    phoneTooLong: "El número no puede tener más de 9 dígitos.",
    phoneMobileLength: "Un celular de Ecuador debe tener 9 dígitos y empezar con 9.",
    phoneFixedLength: "Un fijo de Ecuador debe tener 8 dígitos, incluido el código de área.",
    phoneStart: "Para un celular empieza con 9; para un fijo usa un código de área de 2 a 7.",
    recipientEmpty: "Escribe quién recibe el pedido.", recipientTooLong: "El destinatario no puede superar 241 caracteres.",
    recipientCharacters: "El destinatario solo puede contener letras, espacios, apóstrofes y guiones.",
  },
};
writeFileSync(new URL("../shared/validation/person-rules.json", import.meta.url), JSON.stringify(rules, null, 2) + "\n");
