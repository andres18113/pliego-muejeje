import { Button, Chip, Drawer, TextInput } from "@mantine/core";
import { useMediaQuery, useReducedMotion } from "@mantine/hooks";
import { useEffect, useId, useState, type FormEvent } from "react";
import type { PublicCatalogFilterOptions, PublicCategory } from "@/shared/api/catalog";
import { categoryGroups, type CategoryGroup } from "./catalogCategories";
import { catalogFacets, clearAuxiliaryFilters, auxiliaryFilterCount } from "./catalogFacets";
import { formatEdition, formatLanguage } from "./formatters";
import type { CatalogCriteria } from "./catalogUrl";
import classes from "./exploration.module.css";

const countFormat = new Intl.NumberFormat("es-EC");

/**
 * The catalog's filter surface. Choices are real URL criteria and apply as soon as they are picked,
 * so the results behind the drawer — and its footer count — are always the truth. Only the price
 * range, which is typed, waits for an explicit "Aplicar precio".
 */
export function CatalogFilters({ criteria, options, error, opened, categories = [], categoriesLoading = false, categoriesError = false, total, pending = false, onClose, onApply, onRetry }: {
  criteria: CatalogCriteria; options?: PublicCatalogFilterOptions; error: string; opened: boolean;
  categories?: PublicCategory[]; categoriesLoading?: boolean; categoriesError?: boolean; total?: bigint; pending?: boolean;
  onClose: () => void; onApply: (next: CatalogCriteria) => void; onRetry: () => void;
}) {
  const [price, setPrice] = useState({ minPrice: criteria.minPrice, maxPrice: criteria.maxPrice });
  const [validation, setValidation] = useState("");
  const validationId = useId();
  const groupId = useId();
  const phone = useMediaQuery("(max-width: 599px)");
  const reduceMotion = useReducedMotion();
  useEffect(() => { setPrice({ minPrice: criteria.minPrice, maxPrice: criteria.maxPrice }); setValidation(""); }, [criteria.minPrice, criteria.maxPrice, opened]);
  const facets = catalogFacets(options, criteria);
  const formats = [...new Set([...(options?.formats ?? []), ...(criteria.format ? [criteria.format] : [])])];
  const languages = [...new Set([...(options?.languages ?? []), ...(criteria.language ? [criteria.language] : [])])];
  const hasTopics = categories.length > 0 || categoriesLoading || categoriesError || Boolean(criteria.category);
  const resettable = auxiliaryFilterCount(criteria) > 0 || Boolean(criteria.category);

  function select(field: "category" | "format" | "language", value: string) {
    if (criteria[field] !== value) onApply({ ...criteria, [field]: value, page: 0 });
  }
  function flatten(groups: CategoryGroup[], depth = 0): { category: PublicCategory; depth: number }[] {
    return groups.flatMap(({ category, children }) => [{ category, depth }, ...flatten(children, depth + 1)]);
  }
  function submitPrice(event: FormEvent) {
    event.preventDefault();
    const minPrice = price.minPrice.trim().replace(",", ".");
    const maxPrice = price.maxPrice.trim().replace(",", ".");
    const pattern = /^\d{1,9}(?:\.\d{1,2})?$/;
    if ((minPrice && !pattern.test(minPrice)) || (maxPrice && !pattern.test(maxPrice))) { setValidation("Escribe un precio válido, con hasta dos decimales."); return; }
    if (minPrice && maxPrice && Number(minPrice) > Number(maxPrice)) { setValidation("El precio mínimo no puede ser mayor que el máximo."); return; }
    onApply({ ...criteria, minPrice, maxPrice, page: 0 });
  }
  function choices(name: string, legend: string, value: string, items: { value: string; label: string; depth?: number }[], field: "category" | "format" | "language") {
    return <fieldset className={classes.facet}>
      <legend className={classes.facetLegend}>{legend}</legend>
      <Chip.Group multiple={false} value={value} onChange={(next) => select(field, next)}>
        <div className={classes.choices}>
          {items.map((item) => <Chip key={item.value || "all"} value={item.value} name={`${groupId}-${name}`} radius="xl"
            icon={<span className={classes.choiceDot} />} data-depth={item.depth || undefined}
            classNames={{ root: classes.choice, label: classes.choiceLabel, iconWrapper: classes.choiceIcon }}>{item.label}</Chip>)}
        </div>
      </Chip.Group>
    </fieldset>;
  }

  const resultLabel = pending ? "Buscando…" : total === undefined ? "Ver ediciones"
    : total === 0n ? "Sin ediciones" : `Ver ${countFormat.format(total)} ${total === 1n ? "edición" : "ediciones"}`;

  return <Drawer opened={opened} onClose={onClose} title="Filtros" position="right" size={phone ? "100%" : 440}
    closeButtonProps={{ "aria-label": "Cerrar filtros", size: 44 }} transitionProps={{ duration: reduceMotion ? 0 : 260, timingFunction: "cubic-bezier(.32, .94, .6, 1)" }}
    overlayProps={{ backgroundOpacity: 0.28, color: "#252740" }}
    classNames={{ content: `${classes.drawer} storefront-panel`, header: classes.drawerHeader, title: classes.drawerTitle, body: classes.drawerBody }}>
    <div className={classes.drawerScroll}>
      {error && <div role="alert" className={classes.notice}><p>No pudimos actualizar los filtros. Conservamos tus criterios.</p><Button variant="subtle" onClick={onRetry}>Volver a intentar</Button></div>}
      {hasTopics && <>
        {categoriesLoading && <p role="status" className={classes.note}>Cargando temas…</p>}
        {categoriesError && <p role="alert" className={classes.note}>No pudimos actualizar los temas.</p>}
        {categories.length > 0 && choices("tema", "Tema", criteria.category, [{ value: "", label: "Todos los libros" }, ...flatten(categoryGroups(categories)).map(({ category, depth }) => ({ value: category.slug, label: category.name, depth }))], "category")}
      </>}
      {facets.format && choices("formato", "Formato", criteria.format, [{ value: "", label: "Todos" }, ...formats.map((format) => ({ value: format, label: formatEdition(format) }))], "format")}
      {facets.language && choices("idioma", "Idioma", criteria.language, [{ value: "", label: "Todos" }, ...languages.map((language) => ({ value: language, label: formatLanguage(language) }))], "language")}
      {facets.price && <form className={classes.facet} onSubmit={submitPrice} onChange={() => setValidation("")} aria-labelledby={`${groupId}-price`}>
        <h3 className={classes.facetLegend} id={`${groupId}-price`}>Precio (USD)</h3>
        <div className={classes.priceFields}>
          <TextInput label="Precio mínimo" inputMode="decimal" value={price.minPrice} onChange={(event) => setPrice({ ...price, minPrice: event.currentTarget.value })} classNames={{ input: classes.input, label: classes.inputLabel }} aria-invalid={Boolean(validation)} aria-describedby={validation ? validationId : undefined} />
          <TextInput label="Precio máximo" inputMode="decimal" value={price.maxPrice} onChange={(event) => setPrice({ ...price, maxPrice: event.currentTarget.value })} classNames={{ input: classes.input, label: classes.inputLabel }} aria-invalid={Boolean(validation)} aria-describedby={validation ? validationId : undefined} />
        </div>
        {validation && <p id={validationId} className={classes.validation} role="alert">{validation}</p>}
        <Button type="submit" variant="outline" className={classes.secondaryControl}>Aplicar precio</Button>
      </form>}
    </div>
    <div className={classes.drawerFooter}>
      {resettable && <Button variant="subtle" className={classes.resetControl} onClick={() => onApply({ ...clearAuxiliaryFilters(criteria), category: "" })}>Restablecer filtros</Button>}
      <Button className={classes.primaryControl} onClick={onClose} aria-live="polite">{resultLabel}</Button>
    </div>
  </Drawer>;
}
