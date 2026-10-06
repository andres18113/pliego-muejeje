import { Button, UnstyledButton } from "@mantine/core";
import type { RefObject } from "react";
import { ChoicePicker } from "@/shared/ui/ChoicePicker";
import type { PublicCategory, PublicCatalogFilterOptions } from "@/shared/api/catalog";
import { MaterialSymbol } from "@/shared/ui/MaterialSymbol";
import { catalogFacets, auxiliaryFilterCount } from "./catalogFacets";
import { mediaOfProductType, mediaTitle } from "./catalogMedia";
import { formatEdition, formatLanguage, formatUsd } from "./formatters";
import type { CatalogCriteria } from "./catalogUrl";
import classes from "./exploration.module.css";

const countFormat = new Intl.NumberFormat("es-EC");
export type RemovableCriterion = "query" | "category" | "minPrice" | "maxPrice" | "language" | "format";

/** Orientation, not a banner: the collection's name in ink display type with its count beneath it. */
export function CatalogHeading({ criteria, categories, pending, total }: {
  criteria: CatalogCriteria; categories: PublicCategory[]; pending: boolean; total?: bigint;
}) {
  const categoryName = categories.find((category) => category.slug === criteria.category)?.name ?? criteria.category;
  const title = criteria.query ? `Resultados para «${criteria.query}»` : criteria.category ? categoryName : mediaTitle(mediaOfProductType(criteria.productType));
  return <header className={classes.heading}>
    <h1 className={classes.pageTitle}>{title}</h1>
    <p className={classes.resultCount}>{pending ? "Buscando…" : total !== undefined ? `${countFormat.format(total)} ${total === 1n ? "edición" : "ediciones"}` : " "}</p>
  </header>;
}

type CriteriaProps = { criteria: CatalogCriteria; categories: PublicCategory[]; onRemove: (field: RemovableCriterion) => void; onClearAll: () => void };

/**
 * What is applied: removable tokens, never navigation. The medium being browsed is the page itself,
 * so it is never offered as a removable criterion. On desktop they head the filter sidebar; below it
 * they join the toolbar above the shelf.
 */
export function AppliedCriteria({ criteria, categories, onRemove, onClearAll }: CriteriaProps) {
  const categoryName = categories.find((category) => category.slug === criteria.category)?.name ?? criteria.category;
  const applied: { field: RemovableCriterion; label: string }[] = [];
  if (criteria.query) applied.push({ field: "query", label: `«${criteria.query}»` });
  if (criteria.category) applied.push({ field: "category", label: categoryName });
  if (criteria.format) applied.push({ field: "format", label: formatEdition(criteria.format) });
  if (criteria.language) applied.push({ field: "language", label: formatLanguage(criteria.language) });
  // Price ranges stay valid URL criteria (shared links, older bookmarks): shown and removable, never typed here.
  if (criteria.minPrice || criteria.maxPrice) applied.push({ field: "minPrice", label: criteria.minPrice && criteria.maxPrice ? `${formatUsd(criteria.minPrice)}–${formatUsd(criteria.maxPrice)}` : criteria.minPrice ? `Desde ${formatUsd(criteria.minPrice)}` : `Hasta ${formatUsd(criteria.maxPrice)}` });
  if (applied.length === 0) return null;
  return <ul className={classes.applied} aria-label="Criterios aplicados">
    {applied.map(({ field, label }) => <li key={field}>
      <UnstyledButton className={classes.token} onClick={() => onRemove(field)} aria-label={`Quitar ${field === "query" ? `búsqueda ${label}` : label}`}>
        <span className={classes.tokenPill}><span className={classes.tokenLabel}>{label}</span><MaterialSymbol name="close" size={16} /></span>
      </UnstyledButton>
    </li>)}
    {applied.length > 1 && <li><UnstyledButton className={classes.clearAll} onClick={onClearAll}>Limpiar todo</UnstyledButton></li>}
  </ul>;
}

/** The sort order, exactly the search contract's choices, as PLIEGO's shared choice picker. */
export function SortControl({ criteria, options, onChange }: { criteria: CatalogCriteria; options?: PublicCatalogFilterOptions; onChange: (next: CatalogCriteria) => void }) {
  return <div className={classes.sortSlot}>
    <ChoicePicker label="Ordenar por" caption="Ordenar por" value={criteria.sort} options={catalogFacets(options, criteria).sorts}
      onChange={(sort) => onChange({ ...criteria, sort, page: 0 })} className={classes.sort} align="end" appearance="quiet" />
  </div>;
}

/**
 * Below desktop, the line directly above the shelf: the filter drawer's trigger, the sort order and the
 * applied criteria. (Desktop sets the sort beside the heading and the criteria in the sidebar.)
 */
export function CatalogToolbar({ criteria, categories, options, canFilter, filtersOpen, filterTrigger, onToggleFilters, onChange, onRemove, onClearAll }: CriteriaProps & {
  options?: PublicCatalogFilterOptions; canFilter: boolean;
  filtersOpen: boolean; filterTrigger: RefObject<HTMLButtonElement | null>; onToggleFilters: () => void;
  onChange: (next: CatalogCriteria) => void;
}) {
  const count = auxiliaryFilterCount(criteria) + Number(Boolean(criteria.category));
  return <div className={classes.toolbar}>
    {canFilter && <Button ref={filterTrigger} variant="default" className={classes.filterButton} data-active={count > 0 || undefined}
      leftSection={<MaterialSymbol name="filter_list" size={20} />} aria-label={count > 0 ? `Filtros, ${count} ${count === 1 ? "activo" : "activos"}` : undefined} aria-haspopup="dialog" aria-expanded={filtersOpen} onClick={onToggleFilters}
      rightSection={count > 0 ? <span className={classes.filterCount} aria-hidden="true">{count}</span> : undefined}>
      Filtros
    </Button>}
    <AppliedCriteria criteria={criteria} categories={categories} onRemove={onRemove} onClearAll={onClearAll} />
    <SortControl criteria={criteria} options={options} onChange={onChange} />
  </div>;
}
