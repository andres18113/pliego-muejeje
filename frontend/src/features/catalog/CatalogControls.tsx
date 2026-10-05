import { Button, NativeSelect, UnstyledButton } from "@mantine/core";
import type { RefObject } from "react";
import type { PublicCategory, PublicCatalogFilterOptions } from "@/shared/api/catalog";
import { MaterialSymbol } from "@/shared/ui/MaterialSymbol";
import { catalogFacets, auxiliaryFilterCount } from "./catalogFacets";
import { formatEdition, formatLanguage, formatUsd } from "./formatters";
import type { CatalogCriteria } from "./catalogUrl";
import classes from "./exploration.module.css";

const countFormat = new Intl.NumberFormat("es-EC");
type Removable = "query" | "category" | "minPrice" | "maxPrice" | "language" | "format" | "productType";

/**
 * Orientation first (which collection, how many editions), then the controls that refine it: the
 * sort order, the filter trigger and the criteria currently applied — removable, never navigation.
 */
export function CatalogControls({ criteria, categories, options, optionsError, pending, total, filtersOpen, filterTrigger, onToggleFilters, onChange, onRemove, onClearAll }: {
  criteria: CatalogCriteria; categories: PublicCategory[]; options?: PublicCatalogFilterOptions;
  optionsError: string; pending: boolean; total?: bigint; filtersOpen: boolean;
  filterTrigger: RefObject<HTMLButtonElement | null>; onToggleFilters: () => void;
  onChange: (next: CatalogCriteria) => void; onRemove: (field: Removable) => void; onClearAll: () => void;
}) {
  const facets = catalogFacets(options, criteria);
  const count = auxiliaryFilterCount(criteria) + Number(Boolean(criteria.category));
  const canFilter = categories.length > 0 || facets.format || facets.language || facets.price || Boolean(optionsError) || count > 0;
  const categoryName = categories.find((category) => category.slug === criteria.category)?.name ?? criteria.category;
  const mediaLabel = criteria.productType === "PHYSICAL" ? "Libros físicos" : criteria.productType === "EBOOK" ? "eBooks" : criteria.productType === "AUDIOBOOK" ? "Audiolibros" : null;
  const applied: { field: Removable; label: string }[] = [];
  if (mediaLabel) applied.push({ field: "productType", label: mediaLabel });
  if (criteria.query) applied.push({ field: "query", label: `«${criteria.query}»` });
  if (criteria.category) applied.push({ field: "category", label: categoryName });
  if (criteria.format) applied.push({ field: "format", label: formatEdition(criteria.format) });
  if (criteria.language) applied.push({ field: "language", label: formatLanguage(criteria.language) });
  if (criteria.minPrice || criteria.maxPrice) applied.push({ field: "minPrice", label: criteria.minPrice && criteria.maxPrice ? `${formatUsd(criteria.minPrice)}–${formatUsd(criteria.maxPrice)}` : criteria.minPrice ? `Desde ${formatUsd(criteria.minPrice)}` : `Hasta ${formatUsd(criteria.maxPrice)}` });
  const title = criteria.query ? `Resultados para «${criteria.query}»` : criteria.category ? categoryName : mediaLabel ?? "Todos los libros";

  // One bounded lavender band: orientation (collection + count) beside the controls that refine it;
  // applied criteria join it on a second line only when they exist.
  return <div className={classes.intro}>
    <header className={classes.heading}>
      <h1 className={classes.pageTitle}>{title}<span className={classes.here} aria-hidden="true" /></h1>
      <p className={classes.resultCount}>{pending ? "Buscando…" : total !== undefined ? `${countFormat.format(total)} ${total === 1n ? "edición" : "ediciones"}` : ""}</p>
    </header>
    <div className={classes.tools}>
      {facets.priceSort && <label className={classes.sortLabel}><span>Ordenar</span><NativeSelect aria-label="Ordenar por" value={criteria.sort} onChange={(event) => onChange({ ...criteria, sort: event.currentTarget.value as CatalogCriteria["sort"], page: 0 })} data={[{ value: "BEST_SELLING", label: "Más vendidos" }, { value: "TITLE_ASC", label: "Título, A–Z" }, { value: "PRICE_ASC", label: "Precio: menor a mayor" }, { value: "PRICE_DESC", label: "Precio: mayor a menor" }]} rightSection={<MaterialSymbol name="expand_more" size={20} />} classNames={{ root: classes.sort, input: classes.sortInput }} /></label>}
      {canFilter && <Button ref={filterTrigger} variant="outline" radius="xl" className={classes.filterButton} data-active={count > 0 || undefined}
        leftSection={<MaterialSymbol name="filter_list" size={20} />} aria-label={count > 0 ? `Filtros, ${count} ${count === 1 ? "activo" : "activos"}` : undefined} aria-haspopup="dialog" aria-expanded={filtersOpen} onClick={onToggleFilters}
        rightSection={count > 0 ? <span className={classes.filterCount} aria-hidden="true">{count}</span> : undefined}>
        Filtros
      </Button>}
    </div>
    {applied.length > 0 && <ul className={classes.applied} aria-label="Criterios aplicados">
      {applied.map(({ field, label }) => <li key={field}>
        <UnstyledButton className={classes.token} onClick={() => onRemove(field)} aria-label={`Quitar ${field === "query" ? `búsqueda ${label}` : label}`}>
          <span className={classes.tokenPill}><span className={classes.tokenLabel}>{label}</span><MaterialSymbol name="close" size={16} /></span>
        </UnstyledButton>
      </li>)}
      {applied.length > 1 && <li><UnstyledButton className={classes.clearAll} onClick={onClearAll}>Limpiar todo</UnstyledButton></li>}
    </ul>}
  </div>;
}
