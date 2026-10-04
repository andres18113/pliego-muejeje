import { MaterialSymbol } from "@/shared/ui/MaterialSymbol";
import { Combobox } from "@base-ui/react/combobox";
import { useState } from "react";
import type { CountryReference } from "@/shared/api/reference";
import { CountryFlag } from "./CountryFlag";

export function CountryPicker({
  id,
  label,
  countries,
  value,
  onChange,
  disabled = false,
  invalid = false,
  describedBy,
  valueContent,
  className,
  hideLabel = false,
}: {
  id: string;
  label: string;
  countries: CountryReference[];
  value: string;
  onChange: (countryCode: string) => void;
  disabled?: boolean;
  invalid?: boolean;
  describedBy?: string;
  valueContent?: (country: CountryReference) => React.ReactNode;
  className?: string;
  hideLabel?: boolean;
}) {
  const [search, setSearch] = useState("");
  const selected = countries.find((country) => country.code === value) ?? null;
  const normalizedSearch = search.trim().toLocaleLowerCase("es");
  const visibleCountries = (normalizedSearch
    ? countries.filter((country) => `${country.name} ${country.code}`.toLocaleLowerCase("es").includes(normalizedSearch))
    : countries).slice(0, normalizedSearch ? 60 : 24);
  const showValue = (country: CountryReference | null) => country
    ? valueContent?.(country) ?? <><CountryFlag code={country.code} /><span>{country.name}</span></>
    : <span className="country-picker-placeholder">Elige un país</span>;

  return <Combobox.Root
    items={visibleCountries}
    value={selected}
    onOpenChange={(nextOpen) => { if (!nextOpen) setSearch(""); }}
    onInputValueChange={(value) => setSearch(value)}
    onValueChange={(country) => { if (country) { onChange(country.code); setSearch(""); } }}
    itemToStringLabel={(country) => country?.name ?? ""}
    itemToStringValue={(country) => country?.code ?? ""}
    isItemEqualToValue={(item, selectedItem) => item.code === selectedItem.code}
    autoHighlight
  >
    <Combobox.Label className={`country-picker-label${hideLabel ? " visually-hidden" : ""}`}>{label}</Combobox.Label>
    <Combobox.Trigger
      id={id}
      className={`country-picker-trigger${className ? ` ${className}` : ""}`}
      disabled={disabled}
      aria-invalid={invalid || undefined}
      aria-describedby={describedBy}
    >
      <Combobox.Value>{(country) => showValue(country)}</Combobox.Value>
      <MaterialSymbol name="expand_more" className="country-picker-chevron" aria-hidden="true" size={17} />
    </Combobox.Trigger>
    <Combobox.Portal>
      <Combobox.Positioner
        className="country-picker-positioner"
        side="bottom"
        align="start"
        sideOffset={5}
        collisionAvoidance={{ side: "flip", align: "shift", fallbackAxisSide: "none" }}
      >
        <Combobox.Popup className="country-picker-popup pliego-dropdown-popup" aria-label={`Buscar ${label.toLowerCase()}`}>
          <div className="country-picker-search">
            <MaterialSymbol name="search" aria-hidden="true" size={17} />
            <Combobox.Input aria-label={`Buscar ${label.toLowerCase()}`} placeholder="Busca por país" autoComplete="off" />
          </div>
          <Combobox.Empty className="country-picker-empty">No encontramos ese país.</Combobox.Empty>
          <Combobox.List className="country-picker-list">
            {(country: CountryReference) => <Combobox.Item key={country.code} value={country} className="country-picker-option">
              <CountryFlag code={country.code} />
              <span>{country.name}</span>
              <Combobox.ItemIndicator className="country-picker-check"><MaterialSymbol name="check" aria-hidden="true" size={16} /></Combobox.ItemIndicator>
            </Combobox.Item>}
          </Combobox.List>
        </Combobox.Popup>
      </Combobox.Positioner>
    </Combobox.Portal>
  </Combobox.Root>;
}
