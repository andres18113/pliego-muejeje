/** Presentation only: how the server's offer values read on a card. Nothing here decides validity, price or savings. */
const months = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];

/** Reads the day and time exactly as the API wrote them (Ecuador offset included); the browser clock and zone never take part. */
export function offerEndLabel(endsAt: string) {
  const match = /^\d{4}-(\d{2})-(\d{2})T(\d{2}:\d{2})/.exec(endsAt);
  const month = match ? months[Number(match[1]) - 1] : undefined;
  return match && month ? `${Number(match[2])} de ${month}, ${match[3]}` : endsAt;
}

/** "20.00" reads as "20 %", "12.50" as "12,5 %". The percentage itself is the server's. */
export function savingsPercentLabel(savingsPercent: string | null) {
  if (savingsPercent === null) return null;
  const value = Number(savingsPercent);
  return Number.isFinite(value) && value > 0 ? `${new Intl.NumberFormat("es-EC", { maximumFractionDigits: 1 }).format(value)} %` : null;
}

/** The card's urgency chip: only when the server's own days left are five or fewer. */
export function offerUrgencyLabel(daysRemaining: number) {
  if (daysRemaining > 5) return null;
  if (daysRemaining <= 0) return "Termina hoy";
  return daysRemaining === 1 ? "Queda 1 día" : `Quedan ${daysRemaining} días`;
}

export function offersCountLabel(totalCount: string) {
  return `${totalCount} ${totalCount === "1" ? "oferta" : "ofertas"}`;
}
