import { zodResolver } from "@hookform/resolvers/zod";
import { SlidersHorizontal } from "lucide-react";
import { useEffect, useRef, useState, type SyntheticEvent } from "react";
import { Controller, useForm } from "react-hook-form";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { Field, FieldMessage } from "@/shared/ui/Field";
import type { PublicCatalogFilterOptions, PublicCategory } from "@/shared/api/catalog";
import { formatEdition, formatLanguage, formatUsd } from "./formatters";
import { hasActiveFilters, type CatalogCriteria } from "./catalogUrl";

interface CatalogFiltersProps {
  criteria: CatalogCriteria;
  categories: PublicCategory[];
  filterOptions: PublicCatalogFilterOptions | undefined;
  filterOptionsLoading: boolean;
  filterOptionsError: string;
  pending: boolean;
  onApply: (next: CatalogCriteria) => void;
  onSort: (sort: CatalogCriteria["sort"]) => void;
  onRemove: (field: "query" | "category" | "minPrice" | "maxPrice" | "language" | "format") => void;
}

const scopes: Record<CatalogCriteria["scope"], string> = {
  title: "Título",
  author: "Autor",
  isbn13: "ISBN-13",
};

const validPrice = (value: string) => value === "" || /^\d+(?:\.\d{1,2})?$/.test(value);
const priceSchema = z.string()
  .trim()
  .refine(validPrice, "Selecciona un rango de precios válido.")
  .transform((value) => value);

const filterSchema = z.object({
  category: z.string(),
  minPrice: priceSchema,
  maxPrice: priceSchema,
  language: z.string().trim().toLowerCase()
    .refine((value) => value === "" || /^[a-z]{2,3}$/.test(value), "Elige un idioma de la lista."),
  format: z.enum(["", "PAPERBACK", "HARDCOVER"]),
}).superRefine(({ minPrice, maxPrice }, context) => {
  if (
    validPrice(minPrice) && validPrice(maxPrice) && minPrice && maxPrice &&
    priceInCents(minPrice) > priceInCents(maxPrice)
  ) {
    context.addIssue({
      code: "custom",
      path: ["minPrice"],
      message: "El precio mínimo no puede ser mayor que el máximo.",
    });
  }
});

type FilterFormInput = z.input<typeof filterSchema>;
type FilterFormOutput = z.output<typeof filterSchema>;

export function CatalogFilters({
  criteria,
  categories,
  filterOptions,
  filterOptionsLoading,
  filterOptionsError,
  pending,
  onApply,
  onSort,
  onRemove,
}: CatalogFiltersProps) {
  const isSubmittingRef = useRef(false);
  const [isCompactViewport, setIsCompactViewport] = useState(() =>
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(max-width: 480px)").matches,
  );
  const [mobileFiltersExpanded, setMobileFiltersExpanded] = useState(false);
  const [filterValidationError, setFilterValidationError] = useState("");
  const filtersOpen = !isCompactViewport || mobileFiltersExpanded;
  const {
    register,
    control,
    handleSubmit,
    reset,
    watch,
    formState: { errors, isSubmitting },
  } = useForm<FilterFormInput, undefined, FilterFormOutput>({
    resolver: zodResolver(filterSchema),
    defaultValues: {
      category: criteria.category,
      minPrice: criteria.minPrice,
      maxPrice: criteria.maxPrice,
      language: criteria.language,
      format: criteria.format,
    },
  });

  useEffect(() => {
    reset({
      category: criteria.category,
      minPrice: criteria.minPrice,
      maxPrice: criteria.maxPrice,
      language: criteria.language,
      format: criteria.format,
    });
  }, [criteria.category, criteria.minPrice, criteria.maxPrice, criteria.language, criteria.format, reset]);

  useEffect(() => {
    if (typeof window.matchMedia !== "function") return;
    const media = window.matchMedia("(max-width: 480px)");
    const updateViewportMode = () => setIsCompactViewport(media.matches);
    media.addEventListener("change", updateViewportMode);
    return () => media.removeEventListener("change", updateViewportMode);
  }, []);

  const categoryNames = new Map(categories.map((item) => [item.slug, item.name]));
  const categoryOptions = buildCategoryOptions(categories);
  const languageCodes = filterOptions?.languages || [];
  const languageOptions = criteria.language && !languageCodes.includes(criteria.language)
    ? [...languageCodes, criteria.language]
    : languageCodes;
  const minPriceInput = watch("minPrice");
  const maxPriceInput = watch("maxPrice");
  const priceSlider = buildPriceSliderState(filterOptions, minPriceInput, maxPriceInput);

  const submitFilters = handleSubmit(async (values) => {
    if (pending || isSubmittingRef.current) return;
    setFilterValidationError("");
    isSubmittingRef.current = true;
    try {
      onApply({
        ...criteria,
        category: values.category,
        minPrice: values.minPrice,
        maxPrice: values.maxPrice,
        language: values.language,
        format: values.format,
        page: 0,
      });
    } finally {
      isSubmittingRef.current = false;
    }
  }, (invalid) => {
    const firstError = [invalid.category, invalid.minPrice, invalid.maxPrice, invalid.language, invalid.format]
      .find((field) => typeof field?.message === "string");
    setFilterValidationError(firstError?.message || "Revisa los filtros señalados y vuelve a intentarlo.");
  });

  function updateMobileDisclosure(event: SyntheticEvent<HTMLDetailsElement>) {
    if (isCompactViewport) setMobileFiltersExpanded(event.currentTarget.open);
  }

  function updateMinimumPrice(value: string) {
    if (!priceSlider) return "";
    const nextValue = Number(value);
    return nextValue <= priceSlider.catalogMinimum
      ? ""
      : priceFromNumber(nextValue);
  }

  function updateMaximumPrice(value: string) {
    if (!priceSlider) return "";
    const nextValue = Number(value);
    return nextValue >= priceSlider.catalogMaximum
      ? ""
      : priceFromNumber(nextValue);
  }

  const chips: Array<{ field: Parameters<typeof onRemove>[0]; label: string }> = [];
  if (criteria.query) chips.push({ field: "query", label: `${scopes[criteria.scope]}: ${criteria.query}` });
  if (criteria.category) {
    chips.push({ field: "category", label: `Categoría: ${categoryNames.get(criteria.category) || criteria.category}` });
  }
  if (criteria.minPrice || criteria.maxPrice) {
    const minimum = criteria.minPrice ? formatUsd(criteria.minPrice) : "sin mínimo";
    const maximum = criteria.maxPrice ? formatUsd(criteria.maxPrice) : "sin máximo";
    chips.push({ field: "minPrice", label: `Precio: ${minimum}–${maximum}` });
  }
  if (criteria.language) chips.push({ field: "language", label: `Idioma: ${formatLanguage(criteria.language)}` });
  if (criteria.format) chips.push({ field: "format", label: `Formato: ${formatEdition(criteria.format)}` });

  return (
    <section className="catalog-controls page-frame" aria-labelledby="results-heading">
      <div className="controls-topline">
        <div>
          <p className="results-intro">Ediciones para explorar</p>
          <h2 id="results-heading">Catálogo</h2>
        </div>
        <div className="sort-control">
          <label htmlFor="catalog-sort">Ordenar por</label>
          <select
            id="catalog-sort"
            value={criteria.sort}
            onChange={(event) => onSort(event.target.value as CatalogCriteria["sort"])}
          >
            <option value="TITLE_ASC">Título, A–Z</option>
            <option value="PRICE_ASC">Precio, menor a mayor</option>
            <option value="PRICE_DESC">Precio, mayor a menor</option>
          </select>
        </div>
      </div>

      <details
        className="filter-disclosure"
        open={filtersOpen}
        onToggle={updateMobileDisclosure}
      >
        <summary className="filter-disclosure-summary" aria-controls="catalog-filter-fields">
          <span>Refinar la búsqueda</span>
          <SlidersHorizontal aria-hidden="true" size={17} strokeWidth={1.7} />
        </summary>
        <form className="filter-form" onSubmit={submitFilters} onChange={() => setFilterValidationError("")}>
          <fieldset className="filter-fields" id="catalog-filter-fields">
            <legend>Refina tu búsqueda</legend>
            <Field controlId="category-filter" className="filter-category" label="Categoría">
              <select id="category-filter" {...register("category")}>
                <option value="">Todas las categorías</option>
                {criteria.category && !categoryNames.has(criteria.category) && (
                  <option value={criteria.category}>Categoría no disponible ({criteria.category})</option>
                )}
                {categoryOptions.map((option) => (
                  <option value={option.slug} key={option.slug}>
                    {option.label}
                  </option>
                ))}
              </select>
            </Field>

            <div className="price-range">
              <fieldset className="price-fields-set">
                <legend>Precio actual (USD)</legend>
                {priceSlider ? priceSlider.hasSinglePrice ? (
                  <p className="single-price-state">
                    Precio disponible: <output>{formatUsd(priceFromNumber(priceSlider.catalogMinimum))}</output>
                  </p>
                ) : (
                  <>
                    <div className={`price-slider${priceSlider.canSlide ? "" : " price-slider-static"}`}>
                      <div className="price-slider-track" aria-hidden="true">
                        <span
                          className="price-slider-selected"
                          style={{
                            left: `${priceSlider.minimumPercent}%`,
                            right: `${100 - priceSlider.maximumPercent}%`,
                          }}
                        />
                      </div>
                      <label className="visually-hidden" htmlFor="min-price">Precio mínimo</label>
                      <Controller
                        control={control}
                        name="minPrice"
                        render={({ field }) => (
                          <input
                            {...field}
                            id="min-price"
                            className="price-slider-range price-slider-minimum"
                            type="range"
                            min={priceSlider.rangeMinimum}
                            max={priceSlider.maximumValue}
                            step="0.01"
                            value={priceSlider.minimumValue}
                            aria-valuetext={`Precio mínimo ${formatUsd(priceFromNumber(priceSlider.minimumValue))}`}
                            aria-invalid={Boolean(errors.minPrice)}
                            aria-describedby={errors.minPrice ? "min-price-error" : "price-help"}
                            disabled={!priceSlider.canSlide || filterOptionsLoading}
                            onChange={(event) => field.onChange(updateMinimumPrice(event.currentTarget.value))}
                          />
                        )}
                      />
                      <label className="visually-hidden" htmlFor="max-price">Precio máximo</label>
                      <Controller
                        control={control}
                        name="maxPrice"
                        render={({ field }) => (
                          <input
                            {...field}
                            id="max-price"
                            className="price-slider-range price-slider-maximum"
                            type="range"
                            min={priceSlider.minimumValue}
                            max={priceSlider.rangeMaximum}
                            step="0.01"
                            value={priceSlider.maximumValue}
                            aria-valuetext={`Precio máximo ${formatUsd(priceFromNumber(priceSlider.maximumValue))}`}
                            aria-invalid={Boolean(errors.maxPrice)}
                            aria-describedby={errors.maxPrice ? "max-price-error" : "price-help"}
                            disabled={!priceSlider.canSlide || filterOptionsLoading}
                            onChange={(event) => field.onChange(updateMaximumPrice(event.currentTarget.value))}
                          />
                        )}
                      />
                    </div>
                    <div className="price-slider-values">
                      <div>
                        <span>Desde</span>
                        <output htmlFor="min-price">{formatUsd(priceFromNumber(priceSlider.minimumValue))}</output>
                      </div>
                      <div>
                        <span>Hasta</span>
                        <output htmlFor="max-price">{formatUsd(priceFromNumber(priceSlider.maximumValue))}</output>
                      </div>
                    </div>
                    {errors.minPrice && <FieldMessage tone="error" id="min-price-error">{errors.minPrice.message}</FieldMessage>}
                    {errors.maxPrice && <FieldMessage tone="error" id="max-price-error">{errors.maxPrice.message}</FieldMessage>}
                    <span className="visually-hidden" id="price-help">Ajusta el rango con el teclado o con el control deslizante.</span>
                  </>
                ) : (
                  <p className="field-help" role={filterOptionsError ? "status" : undefined}>
                    {filterOptionsError || (filterOptionsLoading ? "Cargando precios del catálogo…" : "No hay precios publicados para filtrar.")}
                  </p>
                )}
              </fieldset>
            </div>

            <Field controlId="language-filter" className="filter-language" label="Idioma">
              <select
                id="language-filter"
                disabled={filterOptionsLoading || !filterOptions}
                aria-invalid={Boolean(errors.language)}
                aria-describedby={errors.language ? "language-filter-error" : "language-help"}
                {...register("language")}
              >
                <option value="">Todos los idiomas</option>
                {languageOptions.map((code) => (
                  <option value={code} key={code}>{formatLanguage(code)}</option>
                ))}
              </select>
              {errors.language && <FieldMessage tone="error" id="language-filter-error">{errors.language.message}</FieldMessage>}
              <FieldMessage tone="help" id="language-help">
                {filterOptionsError || (filterOptionsLoading
                  ? "Cargando idiomas del catálogo…"
                  : languageCodes.length === 0
                    ? "No hay idiomas publicados."
                    : "")}
              </FieldMessage>
            </Field>

            <Field controlId="format-filter" className="filter-format" label="Formato">
              <select id="format-filter" {...register("format")}>
                <option value="">Todos los formatos</option>
                <option value="PAPERBACK">Rústica</option>
                <option value="HARDCOVER">Tapa dura</option>
              </select>
            </Field>

            <div className="filter-actions">
              <Button
                variant="secondary"
                type="submit"
                aria-disabled={pending || isSubmitting}
                aria-busy={pending || isSubmitting}
              >
                Aplicar filtros
              </Button>
              {hasActiveFilters(criteria) && (
                <Button
                  variant="text"
                  type="button"
                  onClick={() =>
                    onApply({
                      ...criteria,
                      category: "",
                      minPrice: "",
                      maxPrice: "",
                      language: "",
                      format: "",
                      page: 0,
                    })
                  }
                >
                  Limpiar filtros
                </Button>
              )}
            </div>
          </fieldset>
          {filterValidationError && <p className="filter-validation" role="alert">{filterValidationError}</p>}
        </form>
      </details>

      {chips.length > 0 && (
        <div className="active-criteria">
          <h3>Criterios activos</h3>
          <ul aria-label="Criterios activos">
            {chips.map(({ field, label }) => (
              <li key={field}>
                <span>{label}</span>
                <Button
                  type="button"
                  aria-label={`Quitar ${label}`}
                  onClick={() => onRemove(field)}
                >
                  <svg viewBox="0 0 16 16" aria-hidden="true">
                    <path d="m4 4 8 8M12 4l-8 8" />
                  </svg>
                </Button>
              </li>
            ))}
          </ul>
          {criteria.query && (
            <Button variant="text" className="clear-search" type="button" onClick={() => onRemove("query")}>
              Limpiar búsqueda
            </Button>
          )}
        </div>
      )}
    </section>
  );
}

function buildCategoryOptions(categories: PublicCategory[]) {
  const names = new Map(categories.map((category) => [category.slug, category.name]));
  return categories.map((category) => ({
    slug: category.slug,
    label: category.parentSlug
      ? `${names.get(category.parentSlug) || category.parentSlug} / ${category.name}`
      : category.name,
  }));
}

function buildPriceSliderState(
  options: PublicCatalogFilterOptions | undefined,
  minimumInput: string,
  maximumInput: string,
) {
  if (!options || options.minimumPrice === null || options.maximumPrice === null) return null;

  const catalogMinimum = Number(options.minimumPrice);
  const catalogMaximum = Number(options.maximumPrice);
  const parsedMinimum = minimumInput === "" ? catalogMinimum : finitePriceOr(minimumInput, catalogMinimum);
  const parsedMaximum = maximumInput === "" ? catalogMaximum : finitePriceOr(maximumInput, catalogMaximum);
  const minimumValue = Math.min(parsedMinimum, parsedMaximum);
  const maximumValue = Math.max(parsedMinimum, parsedMaximum);
  const rangeMinimum = Math.min(catalogMinimum, minimumValue, maximumValue);
  const rangeMaximum = Math.max(catalogMaximum, minimumValue, maximumValue);
  const width = rangeMaximum - rangeMinimum;

  return {
    catalogMinimum,
    catalogMaximum,
    hasSinglePrice: catalogMinimum === catalogMaximum,
    rangeMinimum,
    rangeMaximum,
    minimumValue,
    maximumValue,
    minimumPercent: width === 0 ? 0 : ((minimumValue - rangeMinimum) / width) * 100,
    maximumPercent: width === 0 ? 100 : ((maximumValue - rangeMinimum) / width) * 100,
    canSlide: width > 0,
  };
}

function finitePriceOr(value: string, fallback: number) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function priceFromNumber(value: number) {
  return (Math.round(value * 100) / 100).toFixed(2);
}

function priceInCents(value: string) {
  const [whole, fraction = ""] = value.split(".");
  return BigInt(whole) * 100n + BigInt(fraction.padEnd(2, "0"));
}
