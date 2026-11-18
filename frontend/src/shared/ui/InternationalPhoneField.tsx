import { useState } from "react";
import { normalizePhonePresentation } from "@/shared/validation/person";
import rules from "../../../../shared/validation/person-rules.json";
import { CountryFlag } from "./CountryFlag";
import { Button } from "@/components/ui/button";
import classes from "./CountryPicker.module.css";
import type { CountryReference } from "@/shared/api/reference";
import { phoneError } from "@/shared/validation/person";

export const isValidPhoneNumber = (value: string) => phoneError(value) === null;

// Presentation only: keep shared validation and unknown server messages intact.
const phoneErrorCopy = new Map<string, string>([
  [rules.messages.phoneCharacters, "Usa solo números."],
  [rules.messages.phoneMobileLength, "Completa los 9 dígitos del celular."],
  [rules.messages.phoneChangedDigits, "Escríbelo sin el 0 inicial."],
  [rules.messages.phoneTooLong, "Usa como máximo 9 dígitos."],
]);

const prefixOnly = "Escribe el número; el prefijo +593 ya está incluido.";

/** What the customer typed, read as a national number after the fixed +593 prefix. */
function parseInput(raw: string): { digits: string; error: string | null } {
  const clean = normalizePhonePresentation(raw);
  if (clean.startsWith("+") && "+593".startsWith(clean)) return { digits: "", error: prefixOnly };
  if (clean.startsWith("+") && !clean.startsWith("+593")) return { digits: "", error: rules.messages.phoneCountry };
  const digits = clean.startsWith("+593") ? clean.slice(4) : clean;
  if (raw.trim() && !digits) return { digits, error: rules.messages.phoneCharacters };
  if (digits.startsWith("0")) return { digits, error: rules.messages.phoneChangedDigits };
  if (digits && !/^[0-9]+$/.test(digits)) return { digits, error: rules.messages.phoneCharacters };
  if (digits.length > rules.maxNationalPhoneDigits) return { digits, error: rules.messages.phoneTooLong };
  return { digits, error: null };
}

/**
 * The value reported for a draft the field cannot accept. It is never a valid phone — `phoneError` rejects it for
 * the same reason — so every form that validates its value refuses to save it instead of keeping an older number.
 */
function invalidCandidate(raw: string) {
  const clean = normalizePhonePresentation(raw);
  return clean.startsWith("+") ? clean : `+593${clean}`;
}

type Props = {
  id: string; label: string; countries: CountryReference[]; countryCode: string;
  value?: string; onCountryChange: (countryCode: string) => void; onChange: (value?: string) => void;
  onBlur?: () => void; disabled?: boolean; invalid?: boolean; describedBy?: string;
  error?: string | null; hint?: string | null;
};

type Draft = { text: string; value: string | undefined; error: string | null };

/**
 * Ecuador's fixed +593 prefix and the national number as one control. What the customer types or pastes stays
 * visible exactly as entered until it is corrected: an invalid draft is explained at once, marked invalid and
 * reported to the form as an invalid value, so a save can never quietly keep the previous number. Digits are never
 * truncated, dropped at a length cap, reordered or stripped of a trunk zero.
 */
export function InternationalPhoneField({ id, label, value, onChange, onBlur, disabled = false, invalid = false, describedBy, error, hint = "Ejemplo: 991234567." }: Props) {
  // The draft is shown only while it is still the value this field last reported; any other value comes from the form.
  const [draft, setDraft] = useState<Draft | null>(null);
  const own = draft !== null && draft.value === value;
  // A stored number from another country is not reinterpreted under +593: it is explained and can be cleared.
  const foreign = !own && Boolean(value && !value.startsWith("+593"));
  // A +593 value this field did not just write (a restored draft, or a number saved before today's rules) is shown
  // after the prefix as it is, with its own reason, so it can be corrected in place; nothing is saved until it is valid.
  const national = own ? draft.text : foreign ? "" : value?.slice(4).trimStart() ?? "";
  const restoredProblem = !own && !foreign && value ? parseInput(national).error : null;
  const statusId = `${id}-input-status`;
  function enter(raw: string) {
    const { digits, error: problem } = parseInput(raw);
    const next = !raw.trim() ? undefined : problem ? invalidCandidate(raw) : digits ? `+593${digits}` : undefined;
    setDraft({ text: problem ? raw : digits, value: next, error: problem });
    onChange(next);
  }
  // The draft's own reason leads; a stored foreign number, then the form's message, follow.
  const status = (own ? draft.error : restoredProblem) ?? (foreign ? phoneError(value ?? "") : null) ?? error;
  const descriptions = [describedBy, status || hint ? statusId : null].filter(Boolean).join(" ");
  return <>
    <div className={`international-phone ${classes.phoneField}${invalid || status ? " is-invalid" : ""}`} data-invalid={invalid || Boolean(status) || undefined}>
      <span className={`${classes.trigger} ${classes.fixedPrefix} phone-country-trigger`} aria-label="Ecuador, prefijo +593">
        <CountryFlag code="EC" className={classes.flag} /><span className="phone-country-value">+593</span>
      </span>
      <input id={id} className={`international-phone-input ${classes.phoneInput}`} type="tel" inputMode="numeric"
        autoComplete="tel-national" aria-label={label} aria-invalid={invalid || Boolean(status) || undefined}
        aria-describedby={descriptions || undefined} disabled={disabled} value={national} onBlur={onBlur} placeholder="991234567"
        onChange={event => enter(event.currentTarget.value)}
        onPaste={event => {
          event.preventDefault();
          const input = event.currentTarget;
          const pasted = event.clipboardData.getData("text");
          // A full international number replaces the draft; anything else goes where the selection is, whole.
          enter(pasted.trim().startsWith("+") ? pasted : input.value.slice(0, input.selectionStart ?? 0) + pasted + input.value.slice(input.selectionEnd ?? input.value.length));
        }} />
    </div>
    <span id={statusId} className={status ? "field-error" : hint ? "field-help" : undefined} role="status" aria-live="polite" aria-atomic="true">{status ? phoneErrorCopy.get(status) ?? status : hint}</span>
    {foreign && <Button type="button" variant="text" disabled={disabled} onClick={() => {
      setDraft({ text: "", value: undefined, error: null }); onChange(undefined);
      document.getElementById(id)?.focus();
    }}>Borrar número guardado</Button>}
  </>;
}
