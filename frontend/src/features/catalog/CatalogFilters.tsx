import { Accordion, Button, Drawer, NativeSelect, Radio, TextInput } from "@mantine/core";
import { useEffect, useId, useState, type FormEvent } from "react";
import type { PublicCatalogFilterOptions, PublicCategory } from "@/shared/api/catalog";
import { categoryGroups, type CategoryGroup } from "./catalogCategories";
import { MaterialSymbol } from "@/shared/ui/MaterialSymbol";
import { catalogFacets, clearAuxiliaryFilters, auxiliaryFilterCount } from "./catalogFacets";
import { formatEdition, formatLanguage } from "./formatters";
import type { CatalogCriteria } from "./catalogUrl";
import classes from "./exploration.module.css";
export function CatalogFilters({ criteria, options, error, opened, categories = [], categoriesLoading = false, categoriesError = false, onClose, onApply, onRetry }: {
  criteria: CatalogCriteria; options?: PublicCatalogFilterOptions; error: string; opened: boolean;
  categories?: PublicCategory[]; categoriesLoading?: boolean; categoriesError?: boolean; onClose: () => void; onApply: (next: CatalogCriteria) => void; onRetry: () => void;
}) {
  const [draft, setDraft] = useState(criteria);
  const [validation, setValidation] = useState("");
  const validationId = useId();
  useEffect(() => { setDraft(criteria); setValidation(""); }, [criteria, opened]);
  const facets = catalogFacets(options, criteria);
  const groups = [categories.length > 0 && "topic", facets.format && "format", facets.language && "language", facets.price && "price"].filter(Boolean) as string[];
  function topicChoices(groups: CategoryGroup[]) {
    return groups.map(({ category, children }) => <div key={category.slug}><Radio classNames={{ root: classes.radio, body: classes.radioBody, radio: classes.radioInput }} value={category.slug} label={category.name} />{children.length > 0 && <div className={classes.nestedTopics}>{topicChoices(children)}</div>}</div>);
  }
  const formats = [...new Set([...(options?.formats ?? []), ...(criteria.format ? [criteria.format] : [])])];
  const languages = [...new Set([...(options?.languages ?? []), ...(criteria.language ? [criteria.language] : [])])];
  function submit(event: FormEvent) {
    event.preventDefault();
    const minPrice = draft.minPrice.trim().replace(",", ".");
    const maxPrice = draft.maxPrice.trim().replace(",", ".");
    const price = /^\d{1,9}(?:\.\d{1,2})?$/;
    if ((minPrice && !price.test(minPrice)) || (maxPrice && !price.test(maxPrice))) { setValidation("Escribe un precio válido, con hasta dos decimales."); return; }
    if (minPrice && maxPrice && Number(minPrice) > Number(maxPrice)) { setValidation("El precio mínimo no puede ser mayor que el máximo."); return; }
    onApply({ ...draft, minPrice, maxPrice, page: 0 });
  }
  const content = <form onSubmit={submit} className={classes.filterForm} onChange={() => setValidation("")}>
    {error && <div role="alert" className={classes.notice}><p>No pudimos actualizar los filtros. Conservamos tus criterios.</p><Button variant="subtle" onClick={onRetry}>Volver a intentar</Button></div>}
    <Accordion key={groups.join("-")} multiple defaultValue={groups.includes("format") ? ["format"] : groups.slice(0, 1)} chevron={<MaterialSymbol name="expand_more" />} classNames={{ control: classes.facetControl, item: classes.facetItem, content: classes.facetContent }}>
      {(categories.length > 0 || categoriesLoading || categoriesError) && <Accordion.Item value="topic"><Accordion.Control>Tema</Accordion.Control><Accordion.Panel>{categoriesLoading && <p role="status" className={classes.note}>Cargando temas…</p>}{categoriesError && <p role="alert" className={classes.note}>No pudimos actualizar los temas.</p>}<Radio.Group aria-label="Tema" value={draft.category} onChange={(category) => setDraft({ ...draft, category })}><Radio classNames={{ root: classes.radio, body: classes.radioBody, radio: classes.radioInput }} value="" label="Todos los libros" />{topicChoices(categoryGroups(categories))}</Radio.Group></Accordion.Panel></Accordion.Item>}
      {facets.format && <Accordion.Item value="format"><Accordion.Control>Formato</Accordion.Control><Accordion.Panel>
        <Radio.Group aria-label="Formato" value={draft.format} onChange={(format) => setDraft({ ...draft, format: format as CatalogCriteria["format"] })}>
          <Radio classNames={{ root: classes.radio, body: classes.radioBody, radio: classes.radioInput }} value="" label="Todos los formatos" />
          {formats.map((format) => <Radio key={format} classNames={{ root: classes.radio, body: classes.radioBody, radio: classes.radioInput }} value={format} label={formatEdition(format)} />)}
        </Radio.Group>
      </Accordion.Panel></Accordion.Item>}
      {facets.language && <Accordion.Item value="language"><Accordion.Control>Idioma</Accordion.Control><Accordion.Panel>
        <NativeSelect label="Idioma" value={draft.language} onChange={(event) => setDraft({ ...draft, language: event.currentTarget.value })} data={[{ value: "", label: "Todos los idiomas" }, ...languages.map((language) => ({ value: language, label: formatLanguage(language) }))]} rightSection={<MaterialSymbol name="expand_more" />} classNames={{ input: classes.input }} />
      </Accordion.Panel></Accordion.Item>}
      {facets.price && <Accordion.Item value="price"><Accordion.Control>Precio (USD)</Accordion.Control><Accordion.Panel>
        <div className={classes.priceFields}>
          <TextInput label="Precio mínimo" inputMode="decimal" value={draft.minPrice} onChange={(event) => setDraft({ ...draft, minPrice: event.currentTarget.value })} classNames={{ input: classes.input }} aria-invalid={Boolean(validation)} aria-describedby={validation ? validationId : undefined} />
          <TextInput label="Precio máximo" inputMode="decimal" value={draft.maxPrice} onChange={(event) => setDraft({ ...draft, maxPrice: event.currentTarget.value })} classNames={{ input: classes.input }} aria-invalid={Boolean(validation)} aria-describedby={validation ? validationId : undefined} />
        </div>
      </Accordion.Panel></Accordion.Item>}
    </Accordion>
    {validation && <p id={validationId} className={classes.validation} role="alert">{validation}</p>}
    {(categories.length > 0 || facets.format || facets.language || facets.price) && <Button type="submit" className={classes.control}>Aplicar filtros</Button>}
    {(auxiliaryFilterCount(criteria) > 0 || auxiliaryFilterCount(draft) > 0 || criteria.category || draft.category) && <Button variant="subtle" className={classes.control} onClick={() => onApply({ ...clearAuxiliaryFilters(criteria), category: "" })}>Restablecer filtros</Button>}
  </form>;
  return <Drawer opened={opened} onClose={onClose} title="Filtros del catálogo" position="right" size="min(400px, 100vw)" closeButtonProps={{ "aria-label": "Cerrar filtros", size: 44 }} transitionProps={{ duration: 0 }} classNames={{ content: `${classes.surface} ${classes.drawer}`, header: classes.drawerHeading, body: classes.drawerBody }}>{content}</Drawer>;
}
