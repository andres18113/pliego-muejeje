import { useState } from "react";
import PhoneInput from "react-phone-number-input/input-max";
import { getCountryCallingCode, isSupportedCountry, parsePhoneNumberFromString, type CountryCode } from "libphonenumber-js/max";
import { phoneError, phoneCharactersError, normalizePhonePresentation } from "@/shared/validation/person";
import { CountryPicker } from "./CountryPicker";
import { CountryFlag } from "./CountryFlag";
import classes from "./CountryPicker.module.css";
import type { CountryReference } from "@/shared/api/reference";

export const isValidPhoneNumber = (value: string) => phoneError(value) === null;

export function InternationalPhoneField({
  id,
  label,
  countries,
  countryCode,
  value,
  onCountryChange,
  onChange,
  onBlur,
  disabled = false,
  invalid = false,
  describedBy,
}: {
  id: string;
  label: string;
  countries: CountryReference[];
  countryCode: string;
  value?: string;
  onCountryChange: (countryCode: string) => void;
  onChange: (value?: string) => void;
  onBlur?: () => void;
  disabled?: boolean;
  invalid?: boolean;
  describedBy?: string;
}) {
  const code = countryCode as CountryCode;
  const [rawInvalid, setRawInvalid] = useState<string | null>(null);
  const phoneCountries = countries.filter((country) => isSupportedCountry(country.code));
  const callingCode = (() => { try { return getCountryCallingCode(code); } catch { return ""; } })();
  function preserveOrNormalize(raw: string) {
    const cleaned=normalizePhonePresentation(raw);
    if(!cleaned && phoneError(raw)) { setRawInvalid(raw); onChange(raw); return; }
    if(phoneCharactersError(raw)) { setRawInvalid(raw); onChange(raw); return; }
    const parsed=parsePhoneNumberFromString(cleaned,code);
    // Country selection is explicit for national input. International input must
    // never be repaired by silently removing a trunk zero or other digits.
    if((cleaned.includes("+") && !cleaned.startsWith("+")) || (cleaned.startsWith("+") && phoneError(raw))) { setRawInvalid(raw); onChange(raw); return; }
    setRawInvalid(null); onChange(parsed?.number ?? (cleaned || undefined));
    requestAnimationFrame(() => document.getElementById(id)?.focus());
  }
  const callingCodeOf = (country: CountryReference) => `+${getCountryCallingCode(country.code as CountryCode)}`;
  return <div className={`international-phone ${classes.phoneField}${invalid ? " is-invalid" : ""}`} data-invalid={invalid || undefined} onChangeCapture={(event) => {
    if(rawInvalid!==null || !(event.target instanceof HTMLInputElement) || event.target.id!==id) return;
    const raw=event.target.value, cleaned=normalizePhonePresentation(raw);
    if(phoneCharactersError(raw) || (!cleaned && phoneError(raw)) || (cleaned.includes("+") && !cleaned.startsWith("+")) || (cleaned.startsWith("+") && phoneError(raw))) {
      event.stopPropagation(); setRawInvalid(raw); onChange(raw);
      requestAnimationFrame(() => document.getElementById(id)?.focus());
    }
  }}>
    <CountryPicker
      id={`${id}-country`}
      label="Prefijo internacional"
      countries={phoneCountries}
      value={countryCode}
      onChange={onCountryChange}
      disabled={disabled}
      className="phone-country-trigger"
      hideLabel
      searchPlaceholder="País o código"
      optionDetail={callingCodeOf}
      searchTerms={callingCodeOf}
      valueContent={(country) => <><CountryFlag code={country.code} className={classes.flag} /><span className="phone-country-value">{callingCodeOf(country)}</span></>}
    />
    {rawInvalid!==null ? <input
      id={id} className={`international-phone-input ${classes.phoneInput}`} type="tel" inputMode="tel" autoComplete="tel"
      aria-label={label} aria-invalid={invalid || undefined} aria-describedby={describedBy}
      disabled={disabled} value={rawInvalid} onBlur={onBlur} placeholder="Número de teléfono"
      onChange={(event) => preserveOrNormalize(event.currentTarget.value)}
    /> : <PhoneInput
      id={id}
      className={`international-phone-input ${classes.phoneInput}`}
      type="tel"
      inputMode="tel"
      autoComplete="tel"
      country={code}
      value={value}
      onChange={onChange}
      onBlur={onBlur}
      disabled={disabled}
      aria-label={label}
      aria-invalid={invalid || undefined}
      aria-describedby={describedBy}
      placeholder="Número de teléfono"
    />}
    <span className="visually-hidden" aria-live="polite">{callingCode ? `Código internacional +${callingCode}` : ""}</span>
  </div>;
}
