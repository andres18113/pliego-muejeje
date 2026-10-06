const integerFormatter = new Intl.NumberFormat("es-EC", {
  maximumFractionDigits: 0,
});

const currencyParts = new Intl.NumberFormat("es-EC", {
  style: "currency",
  currency: "USD",
}).formatToParts(0);

export function formatUsd(amount: string) {
  const match = /^(\d+)(?:\.(\d{2}))?$/.exec(amount);
  if (!match) return `USD ${amount}`;

  const integer = integerFormatter.format(BigInt(match[1]));
  const fraction = match[2] || "00";
  const currency = currencyParts.find((part) => part.type === "currency")?.value || "USD";
  const literal = currencyParts.find((part) => part.type === "literal")?.value || " ";
  const decimal = currencyParts.find((part) => part.type === "decimal")?.value || ",";
  return `${currency}${literal}${integer}${decimal}${fraction}`;
}

export function formatEdition(format: string | null | undefined) {
  if (format === "PAPERBACK") return "Rústica";
  if (format === "HARDCOVER") return "Tapa dura";
  if (format === "EBOOK") return "Ebook";
  if (format === "AUDIOBOOK") return "Audiolibro";
  return format ? "Formato no reconocido" : "No especificado";
}

export function formatLanguage(language: string) {
  try {
    const name = new Intl.DisplayNames(["es-EC"], { type: "language" }).of(language);
    return name ? name.charAt(0).toLocaleUpperCase("es-EC") + name.slice(1) : language.toUpperCase();
  } catch {
    return language.toUpperCase();
  }
}

export function formatPublicationDate(value: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return value;

  const [, year, month, day] = match;
  const date = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)));
  if (date.getUTCFullYear() !== Number(year)
      || date.getUTCMonth() !== Number(month) - 1
      || date.getUTCDate() !== Number(day)) {
    return value;
  }

  return new Intl.DateTimeFormat("es-EC", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(date);
}

export function formatPageCount(value: number) {
  return new Intl.NumberFormat("es-EC", { maximumFractionDigits: 0 }).format(value);
}

/** Formats the exact duration supplied by the API without inventing playback availability. */
export function formatAudioDuration(seconds: number) {
  if (!Number.isSafeInteger(seconds) || seconds <= 0) return null;
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const remainder = seconds % 60;
  return [hours ? `${hours} h` : null, minutes ? `${minutes} min` : null, remainder ? `${remainder} s` : null]
    .filter(Boolean).join(" ");
}

/**
 * Editorial role abbreviations that catalog metadata appends to contributor names ("Rodríguez, Armando (coord.)").
 * Shoppers read the names; the stored metadata keeps the roles. Only these explicit, lowercase role marks are
 * removed, so parenthesized names such as institutions ("(UNAM)") stay intact.
 */
const contributorRoleMark = /\s*\((?:coords?|eds?|dirs?|comps?)\.\)/g;

/** The author line for customer-facing product presentation: contributor names without editorial role marks. */
export function formatAuthorNames(authors: string) {
  return authors.replace(contributorRoleMark, "").replace(/\s+;/g, ";").trim();
}
