import { ActionIcon, Button, NativeSelect } from "@mantine/core";
import type { RefObject } from "react";
import type { PublicCategory, PublicCatalogFilterOptions } from "@/shared/api/catalog";
import { MaterialSymbol } from "@/shared/ui/MaterialSymbol";
import { catalogFacets, auxiliaryFilterCount } from "./catalogFacets";
import { formatEdition, formatLanguage, formatUsd } from "./formatters";
import type { CatalogCriteria } from "./catalogUrl";
import classes from "./exploration.module.css";
const countFormat = new Intl.NumberFormat("es-EC");
export function CatalogControls({ criteria, categories, options, optionsError, pending, total, filtersOpen, filterTrigger, onToggleFilters, onChange, onRemove }: {
  criteria: CatalogCriteria; categories: PublicCategory[]; options?: PublicCatalogFilterOptions;
  optionsError: string; pending: boolean; total?: bigint; filtersOpen: boolean;
  filterTrigger: RefObject<HTMLButtonElement | null>; onToggleFilters: () => void;
  onChange: (next: CatalogCriteria) => void;
  onRemove: (field: "query" | "category" | "minPrice" | "maxPrice" | "language" | "format") => void;
}) {
  const facets = catalogFacets(options, criteria);
  const count = auxiliaryFilterCount(criteria) + Number(Boolean(criteria.category));
  const canFilter = categories.length > 0 || facets.format || facets.language || facets.price || Boolean(optionsError);
  const active: { field: Parameters<typeof onRemove>[0]; label: string }[] = [];
  if (criteria.query) active.push({ field: "query", label: `Búsqueda: ${criteria.query}` });
  if (criteria.category) active.push({ field: "category", label: categories.find((category) => category.slug === criteria.category)?.name ?? criteria.category });
  if (criteria.format) active.push({ field: "format", label: formatEdition(criteria.format) });
  if (criteria.language) active.push({ field: "language", label: formatLanguage(criteria.language) });
  if (criteria.minPrice || criteria.maxPrice) active.push({ field: "minPrice", label: `${criteria.minPrice ? formatUsd(criteria.minPrice) : "sin mínimo"}–${criteria.maxPrice ? formatUsd(criteria.maxPrice) : "sin máximo"}` });
  return <>
    <div className={classes.catalogTopline}>
      <div className={classes.catalogTitleGroup}>
        <h1 className={classes.pageTitle}>Catálogo</h1>
        <p className={classes.resultCount}>{pending ? "Buscando…" : total !== undefined ? `${countFormat.format(total)} ${total === 1n ? "edición" : "ediciones"}` : ""}</p>
      </div>
      <div className={classes.tools}>
        {facets.priceSort && <NativeSelect aria-label="Ordenar por" value={criteria.sort} onChange={(event) => onChange({ ...criteria, sort: event.currentTarget.value as CatalogCriteria["sort"], page: 0 })} data={[{ value: "TITLE_ASC", label: "Título, A–Z" }, { value: "PRICE_ASC", label: "Precio, menor a mayor" }, { value: "PRICE_DESC", label: "Precio, mayor a menor" }]} rightSection={<MaterialSymbol name="expand_more" />} classNames={{ root: classes.sort, input: classes.input }} />}
        {canFilter && <Button ref={filterTrigger} variant="subtle" className={classes.filterButton} leftSection={<MaterialSymbol name="filter_list" />} aria-haspopup="dialog" aria-expanded={filtersOpen} onClick={onToggleFilters}>Filtros{count ? ` (${count})` : ""}</Button>}
      </div>
    </div>
    {active.length > 0 && <ul className={classes.activeFilters} aria-label="Criterios aplicados">{active.map(({ field, label }) => <li key={field}><span>{label}</span><ActionIcon variant="subtle" className={classes.removeFilter} aria-label={`Quitar ${label}`} onClick={() => onRemove(field)}><MaterialSymbol name="close" size={18} /></ActionIcon></li>)}</ul>}
  </>;
}
