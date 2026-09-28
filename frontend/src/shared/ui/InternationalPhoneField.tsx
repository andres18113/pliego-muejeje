import PhoneInput from "react-phone-number-input/input";
import { getCountryCallingCode, isSupportedCountry, isValidPhoneNumber, type CountryCode } from "libphonenumber-js/min";
import { CountryPicker } from "./CountryPicker";
import { CountryFlag } from "./CountryFlag";
import type { CountryReference } from "@/shared/api/reference";

export { isValidPhoneNumber };

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
  const phoneCountries = countries.filter((country) => isSupportedCountry(country.code));
  const callingCode = (() => { try { return getCountryCallingCode(code); } catch { return ""; } })();
  return <div className={`international-phone${invalid ? " is-invalid" : ""}`}>
    <CountryPicker
      id={`${id}-country`}
      label="Prefijo internacional"
      countries={phoneCountries}
      value={countryCode}
      onChange={onCountryChange}
      disabled={disabled}
      className="phone-country-trigger"
      hideLabel
      valueContent={(country) => <><CountryFlag code={country.code} /><span className="phone-country-value">+{getCountryCallingCode(country.code as CountryCode)}</span></>}
    />
    <PhoneInput
      id={id}
      className="international-phone-input"
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
    />
    <span className="visually-hidden" aria-live="polite">{callingCode ? `Código internacional +${callingCode}` : ""}</span>
  </div>;
}
