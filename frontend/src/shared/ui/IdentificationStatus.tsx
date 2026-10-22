import { liveIdentificationCheck } from "@/shared/validation/identification";
import { MaterialSymbol } from "./MaterialSymbol";

/**
 * The live line under a cédula/RUC field: it judges each digit while the customer types (ADR 0041). A final
 * `error` (on leaving the field, on submit or from the server) replaces it until the next edit. One message at a
 * time; screen readers hear only verdicts (an error or a valid number), never every keystroke's count.
 */
export function IdentificationStatus({ id, value, error }: { id: string; value: string; error?: string | null }) {
  const live = liveIdentificationCheck(value);
  const shown = error ? { tone: "error" as const, message: error } : live;
  return <>
    {/* Read as the field's description on focus; the live region below speaks verdicts, so this one stays out of
        browse order to avoid hearing the same sentence twice. */}
    <span id={id} aria-hidden="true" className={`identification-status ${shown.tone === "error" ? "field-error" : "field-help"}`} data-tone={shown.tone}>
      {shown.tone === "success" && <MaterialSymbol name="check_circle" size={16} />}{shown.message}
    </span>
    <span className="visually-hidden" aria-live="polite">{shown.tone === "help" ? "" : shown.message}</span>
  </>;
}

/** Whether the field should read as invalid right now. */
export function identificationInvalid(value: string, error?: string | null) {
  return Boolean(error) || liveIdentificationCheck(value).tone === "error";
}
