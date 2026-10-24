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

type Props = {
  id: string; label: string; countries: CountryReference[]; countryCode: string;
  value?: string; onCountryChange: (countryCode: string) => void; onChange: (value?: string) => void;
  onBlur?: () => void; disabled?: boolean; invalid?: boolean; describedBy?: string;
  error?: string | null; hint?: string | null;
};

// Keep the existing callers' contract; the supported contact country is now fixed.
export function InternationalPhoneField({ id, label, value, onChange, onBlur, disabled = false, invalid = false, describedBy, error, hint = "Ejemplo: 991234567." }: Props) {
  const [rejection, setRejection] = useState<string | null>(null);
  const incompatible = Boolean(value && !/^\+593[0-9]{0,9}$/.test(value));
  const national = incompatible ? "" : value?.startsWith("+593") ? value.slice(4) : "";
  const statusId = `${id}-input-status`;
  function parseInput(raw: string): { digits: string; error: string | null } {
    const clean = normalizePhonePresentation(raw);
    if (clean.startsWith("+") && !clean.startsWith("+593")) return { digits: "", error: rules.messages.phoneCountry };
    const digits = clean.startsWith("+593") ? clean.slice(4) : clean;
    if (clean === "+593") return { digits, error: "Escribe el número; el prefijo +593 ya está incluido." };
    if (raw.trim() && !digits) return { digits, error: rules.messages.phoneCharacters };
    if (digits.startsWith("0")) return { digits, error: rules.messages.phoneChangedDigits };
    if (digits && !/^[0-9]+$/.test(digits)) return { digits, error: rules.messages.phoneCharacters };
    if (digits.length > 9) return { digits, error: rules.messages.phoneTooLong };
    return { digits, error: null };
  }
  // Rejected edits explain why the accepted value was kept, even if the parent reports its length on blur.
  const status = rejection ?? (incompatible ? phoneError(value ?? "") : null) ?? error;
  const descriptions = [describedBy, status || hint ? statusId : null].filter(Boolean).join(" ");
  return <>
    <div className={`international-phone ${classes.phoneField}${invalid || status ? " is-invalid" : ""}`} data-invalid={invalid || Boolean(status) || undefined}>
      <span className={`${classes.trigger} ${classes.fixedPrefix} phone-country-trigger`} aria-label="Ecuador, prefijo +593">
        <CountryFlag code="EC" className={classes.flag} /><span className="phone-country-value">+593</span>
      </span>
      <input id={id} className={`international-phone-input ${classes.phoneInput}`} type="tel" inputMode="numeric"
        autoComplete="tel-national" maxLength={9} aria-label={label} aria-invalid={invalid || Boolean(status) || undefined}
        aria-describedby={descriptions || undefined} disabled={disabled} value={national} onBlur={onBlur} placeholder="991234567"
        onChange={event => {
          const { digits, error } = parseInput(event.currentTarget.value);
          if (error) { event.currentTarget.value = national; setRejection(error); return; }
          setRejection(null); onChange(digits ? `+593${digits}` : undefined);
        }}
        onBeforeInput={event => {
          const input = event.currentTarget;
          const data = (event.nativeEvent as InputEvent).data;
          if (!data) return;
          const candidate = input.value.slice(0, input.selectionStart ?? 0) + data + input.value.slice(input.selectionEnd ?? input.value.length);
          const { error } = parseInput(candidate);
          if (error) { event.preventDefault(); setRejection(error); }
        }}
        onPaste={event => {
          event.preventDefault();
          const input = event.currentTarget;
          const pasted = event.clipboardData.getData("text");
          // A full international number replaces the draft; plain national digits obey the selected range.
          const candidate = pasted.trim().startsWith("+") ? pasted : input.value.slice(0, input.selectionStart ?? 0) + pasted + input.value.slice(input.selectionEnd ?? input.value.length);
          const { digits, error } = parseInput(candidate);
          if (error) { setRejection(error); return; }
          setRejection(null); onChange(digits ? `+593${digits}` : undefined);
        }} />
    </div>
    <span id={statusId} className={status ? "field-error" : hint ? "field-help" : undefined} role="status" aria-live="polite" aria-atomic="true">{status ? phoneErrorCopy.get(status) ?? status : hint}</span>
    {incompatible && <Button type="button" variant="text" disabled={disabled} onClick={() => {
      setRejection(null); onChange(undefined);
      document.getElementById(id)?.focus();
    }}>Borrar número guardado</Button>}
  </>;
}
