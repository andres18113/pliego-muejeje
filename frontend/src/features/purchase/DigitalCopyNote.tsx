import { InfoToggletip } from "@/shared/ui/InfoToggletip";
import classes from "./digitalCopyNote.module.css";

export const digitalCopyLabel = "Copia digital individual";
/** ADR-0042: a paid digital copy becomes an active title in Mi biblioteca, and an account holds one active copy. */
export const digitalCopyExplanation = "Al comprarlo, este título se añade a tu biblioteca digital. Solo puedes adquirirlo una vez por cuenta.";

/** A digital line's quantity, said as a short visible label with the shared `info` toggletip beside it. */
export function DigitalCopyNote({ className }: { className?: string }) {
  return <span className={`${classes.note}${className ? ` ${className}` : ""}`}>
    <span>{digitalCopyLabel}</span>
    <InfoToggletip label="Más información sobre la copia digital individual">{digitalCopyExplanation}</InfoToggletip>
  </span>;
}
