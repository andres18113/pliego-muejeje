import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { citiesQueryKey, geoStaleTime, getCities, getProvinces, provincesQueryKey, type City } from "@/shared/api/geo";
import { SearchPicker, type PickerWording } from "./CountryPicker";
import { FieldMessage } from "./Field";

const provinceWording: PickerWording = { choose: "Elige una provincia", one: "provincia", many: "provincias", noMatch: "Prueba con otro nombre" };
const cityWording = (provinceChosen: boolean): PickerWording => ({
  choose: provinceChosen ? "Elige una ciudad" : "Elige primero la provincia", one: "lugar", many: "lugares", noMatch: "Prueba con otro nombre",
});

const fold = (text: string) => text.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLocaleLowerCase("es");
/** The canton, shortened for a row ("Distrito Metropolitano de Quito" reads "Quito"). */
const cantonLabel = (city: City) => city.cantonName.replace(/^Distrito Metropolitano de /, "");

/**
 * A row is the place's own name (Alangasí, Aloag), never what it belongs to. Two quiet exceptions: a name that
 * repeats in the province names its canton so the two rows differ (La Unión · Quinindé), and a search that matches
 * a row only through another INEC name shows that name, so the row says why it is there (bucay → General Antonio
 * Elizalde · Bucay). Without a search no alias shows: Guayaquil's are its urban parishes, not other names for it.
 */
function cityDetail(city: City, query: string, repeated: ReadonlySet<string>) {
  const typed = fold(query);
  const matchedOnlyByAlias = typed !== "" && !fold(city.name).includes(typed);
  // The shortest matching name is the everyday one ("Bucay", not the INEC's "General Elizalde (Bucay)").
  const alias = matchedOnlyByAlias
    ? city.aliases.filter(name => fold(name).includes(typed)).sort((a, b) => a.length - b.length)[0]
    : undefined;
  return [alias, repeated.has(fold(city.name)) ? cantonLabel(city) : null].filter(Boolean).join(" · ");
}

/**
 * Province, then city, from PLIEGO's INEC catalog (ADR 0044): two `SearchPicker`s, never free text. The city
 * waits for its province and offers only that province's places — canton seats and rural parishes, by their own
 * names — so a city can never belong to another province. Changing the
 * province clears a city from the previous one. Each control's id is `${idPrefix}-provinceId` / `-cityId`.
 */
export function ProvinceCityFields({ idPrefix, provinceId, cityId, onChange, provinceError, cityError, disabled = false, reviewCity = false }: {
  idPrefix: string;
  provinceId: string;
  cityId: string;
  onChange: (next: { provinceId: string; cityId: string }) => void;
  provinceError?: string;
  cityError?: string;
  disabled?: boolean;
  /** A saved address whose city did not match the catalog: ask for it once, without calling it an error. */
  reviewCity?: boolean;
}) {
  const provinces = useQuery({ queryKey: provincesQueryKey, queryFn: ({ signal }) => getProvinces(signal), staleTime: geoStaleTime });
  const cities = useQuery({ queryKey: citiesQueryKey(provinceId), queryFn: ({ signal }) => getCities(provinceId, signal), staleTime: geoStaleTime, enabled: Boolean(provinceId) });
  // The pickers identify a choice by `code`; the address stores the catalog id, never the DPA code.
  const provinceOptions = useMemo(() => provinces.data?.map(province => ({ ...province, code: province.id })) ?? [], [provinces.data]);
  const cityOptions = useMemo(() => cities.data?.map(city => ({ ...city, code: city.id })) ?? [], [cities.data]);
  const repeatedNames = useMemo(() => {
    const seen = new Set<string>(), repeated = new Set<string>();
    for (const city of cities.data ?? []) (seen.has(fold(city.name)) ? repeated : seen).add(fold(city.name));
    return repeated;
  }, [cities.data]);
  const provinceFieldId = `${idPrefix}-provinceId`, cityFieldId = `${idPrefix}-cityId`;
  const cityHint = !cityError && reviewCity && !cityId ? "Elige tu ciudad de la lista para actualizar esta dirección." : null;

  return <>
    <div className="form-field">
      <SearchPicker id={provinceFieldId} label="Provincia" options={provinceOptions} value={provinceId} wording={provinceWording}
        searchPlaceholder="Busca una provincia" disabled={disabled || !provinces.data}
        invalid={Boolean(provinceError)} describedBy={provinceError ? `${provinceFieldId}-error` : undefined}
        onChange={(next) => { if (next !== provinceId) onChange({ provinceId: next, cityId: "" }); }} />
      {provinces.isError && <FieldMessage tone="error">No pudimos consultar las provincias. <Button variant="text" type="button" onClick={() => void provinces.refetch()}>Reintentar</Button></FieldMessage>}
      {provinceError && <FieldMessage id={`${provinceFieldId}-error`} tone="error">{provinceError}</FieldMessage>}
    </div>
    <div className="form-field">
      <SearchPicker id={cityFieldId} label="Ciudad" options={cityOptions} value={cityId} wording={cityWording(Boolean(provinceId))}
        searchPlaceholder="Busca una ciudad o parroquia" disabled={disabled || !provinceId || !cities.data}
        optionDetail={(city, query) => cityDetail(city, query, repeatedNames)} searchTerms={(city) => city.aliases.join(" ")}
        invalid={Boolean(cityError)} describedBy={cityError ? `${cityFieldId}-error` : cityHint ? `${cityFieldId}-hint` : undefined}
        onChange={(next) => onChange({ provinceId, cityId: next })} />
      {cities.isError && <FieldMessage tone="error">No pudimos consultar las ciudades. <Button variant="text" type="button" onClick={() => void cities.refetch()}>Reintentar</Button></FieldMessage>}
      {cityError ? <FieldMessage id={`${cityFieldId}-error`} tone="error">{cityError}</FieldMessage>
        : cityHint && <FieldMessage id={`${cityFieldId}-hint`} tone="help">{cityHint}</FieldMessage>}
    </div>
  </>;
}
