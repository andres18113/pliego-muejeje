import { Button, Drawer, UnstyledButton } from "@mantine/core";
import { useMediaQuery, useReducedMotion } from "@mantine/hooks";
import { useId, useState, type ReactNode } from "react";
import type { PublicCatalogFilterOptions, PublicCategory } from "@/shared/api/catalog";
import { MaterialSymbol } from "@/shared/ui/MaterialSymbol";
import { categoryGroups, type CategoryGroup } from "./catalogCategories";
import { catalogFacets, clearAuxiliaryFilters, auxiliaryFilterCount } from "./catalogFacets";
import { formatEdition, formatLanguage } from "./formatters";
import type { CatalogCriteria } from "./catalogUrl";
import classes from "./exploration.module.css";

const countFormat = new Intl.NumberFormat("es-EC");

type FilterField = "category" | "format" | "language";
type Choice = { value: string; label: string; depth?: number };

interface FilterPanelProps {
  criteria: CatalogCriteria; options?: PublicCatalogFilterOptions; error: string;
  categories?: PublicCategory[]; categoriesLoading?: boolean; categoriesError?: boolean;
  onApply: (next: CatalogCriteria) => void; onRetry: () => void;
}

export function hasResettableFilters(criteria: CatalogCriteria) {
  return auxiliaryFilterCount(criteria) > 0 || Boolean(criteria.category);
}

export function resetFilters(criteria: CatalogCriteria): CatalogCriteria {
  return { ...clearAuxiliaryFilters(criteria), category: "" };
}

/**
 * The catalog's facets as compact groups between hairline rules. Every choice is a real URL criterion
 * that applies at once, so the results beside (or behind) the panel are always the truth. The same
 * panel is the persistent sidebar on desktop and the content of the filter drawer below it. Price is
 * not a typed range here: shoppers reach it through the sort order.
 */
export function CatalogFilterPanel({ criteria, options, error, categories = [], categoriesLoading = false, categoriesError = false, onApply, onRetry }: FilterPanelProps) {
  const facets = catalogFacets(options, criteria);
  const formats = [...new Set([...facets.formats, ...(criteria.format ? [criteria.format] : [])])];
  const languages = [...new Set([...(options?.languages ?? []), ...(criteria.language ? [criteria.language] : [])])];
  const hasTopics = categories.length > 0 || categoriesLoading || categoriesError || Boolean(criteria.category);
  const topicChoices: Choice[] = [{ value: "", label: "Todos los temas" }, ...flatten(categoryGroups(categories)).map(({ category, depth }) => ({ value: category.slug, label: category.name, depth }))];
  const topicName = categories.find((category) => category.slug === criteria.category)?.name ?? criteria.category;
  if (criteria.category && !categories.some((category) => category.slug === criteria.category)) {
    topicChoices.push({ value: criteria.category, label: topicName });
  }

  function select(field: FilterField, value: string) {
    if (criteria[field] !== value) onApply({ ...criteria, [field]: value, page: 0 });
  }

  return <div className={classes.filterPanel}>
    {error && <div role="alert" className={classes.notice}><p>No pudimos actualizar los filtros. Conservamos tus criterios.</p><Button variant="subtle" onClick={onRetry}>Volver a intentar</Button></div>}
    {hasTopics && <FilterGroup title="Tema" summary={criteria.category ? topicName : ""}>
      {categoriesLoading && <p role="status" className={classes.note}>Cargando temas…</p>}
      {categoriesError && <p role="alert" className={classes.note}>No pudimos actualizar los temas.</p>}
      {topicChoices.length > 1 && <FilterChoices legend="Tema" value={criteria.category} items={topicChoices} onSelect={(value) => select("category", value)} />}
    </FilterGroup>}
    {facets.format && <FilterGroup title="Formato" summary={criteria.format ? formatEdition(criteria.format) : ""}>
      <FilterChoices legend="Formato" value={criteria.format} items={[{ value: "", label: "Todos los formatos" }, ...formats.map((format) => ({ value: format, label: formatEdition(format) }))]} onSelect={(value) => select("format", value)} />
    </FilterGroup>}
    {facets.language && <FilterGroup title="Idioma" summary={criteria.language ? formatLanguage(criteria.language) : ""}>
      <FilterChoices legend="Idioma" value={criteria.language} items={[{ value: "", label: "Todos los idiomas" }, ...languages.map((language) => ({ value: language, label: formatLanguage(language) }))]} onSelect={(value) => select("language", value)} />
    </FilterGroup>}
  </div>;
}

function flatten(groups: CategoryGroup[], depth = 0): { category: PublicCategory; depth: number }[] {
  return groups.flatMap(({ category, children }) => [{ category, depth }, ...flatten(children, depth + 1)]);
}

/** A disclosure: the group's name and, when one is chosen, the current choice; + / − tells its state. */
function FilterGroup({ title, summary, children }: { title: string; summary: string; children: ReactNode }) {
  const id = useId();
  const [open, setOpen] = useState(Boolean(summary));
  return <section className={classes.group} data-open={open || undefined}>
    <h3 className={classes.groupHeading}>
      <UnstyledButton className={classes.groupToggle} aria-expanded={open} aria-controls={`${id}-panel`} onClick={() => setOpen(!open)}>
        <span className={classes.groupText}>
          <span className={classes.groupTitle}>{title}</span>
          {summary && <span className={classes.groupSummary}>{summary}</span>}
        </span>
        <MaterialSymbol name={open ? "remove" : "add"} size={22} />
      </UnstyledButton>
    </h3>
    <div id={`${id}-panel`} className={classes.groupPanel} hidden={!open}>{children}</div>
  </section>;
}

/** One choice per group (the search takes a single value): native radios, so arrows move within the group. */
function FilterChoices({ legend, value, items, onSelect }: { legend: string; value: string; items: Choice[]; onSelect: (value: string) => void }) {
  const name = useId();
  return <fieldset className={classes.choices}>
    <legend className="visually-hidden">{legend}</legend>
    {items.map((item) => <label key={item.value || "all"} className={classes.choice} data-depth={item.depth || undefined}>
      <input type="radio" name={name} value={item.value} checked={value === item.value} onChange={() => onSelect(item.value)} className={classes.choiceInput} />
      <span className={classes.choiceMark} aria-hidden="true" />
      <span className={classes.choiceLabel}>{item.label}</span>
    </label>)}
  </fieldset>;
}

/** Below desktop the same panel lives in a drawer from the right; the footer shows the live count. */
export function CatalogFilters({ opened, total, pending = false, onClose, ...panel }: FilterPanelProps & {
  opened: boolean; total?: bigint; pending?: boolean; onClose: () => void;
}) {
  const phone = useMediaQuery("(max-width: 599px)");
  const reduceMotion = useReducedMotion();
  const resultLabel = pending ? "Buscando…" : total === undefined ? "Ver ediciones"
    : total === 0n ? "Sin ediciones" : `Ver ${countFormat.format(total)} ${total === 1n ? "edición" : "ediciones"}`;

  return <Drawer opened={opened} onClose={onClose} title="Filtros" position="right" size={phone ? "100%" : 400}
    closeButtonProps={{ "aria-label": "Cerrar filtros", size: 44 }} transitionProps={{ duration: reduceMotion ? 0 : 260, timingFunction: "cubic-bezier(.32, .94, .6, 1)" }}
    overlayProps={{ backgroundOpacity: 0.28, color: "#252740" }}
    classNames={{ content: `${classes.drawer} storefront-panel`, header: classes.drawerHeader, title: classes.drawerTitle, body: classes.drawerBody }}>
    <div className={classes.drawerScroll}><CatalogFilterPanel {...panel} /></div>
    <div className={classes.drawerFooter}>
      {hasResettableFilters(panel.criteria) && <Button variant="subtle" className={classes.resetControl} onClick={() => panel.onApply(resetFilters(panel.criteria))}>Restablecer filtros</Button>}
      <Button className={classes.primaryControl} onClick={onClose} aria-live="polite">{resultLabel}</Button>
    </div>
  </Drawer>;
}
