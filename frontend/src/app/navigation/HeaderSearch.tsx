import { Button, Modal, TextInput, VisuallyHidden } from "@mantine/core";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useId, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { catalogHref, readCatalogCriteria, type CatalogCriteria } from "@/features/catalog/catalogUrl";
import { searchPublicEditions } from "@/shared/api/catalog";
import { MaterialSymbol } from "@/shared/ui/MaterialSymbol";
import classes from "./SiteHeader.module.css";

export function HeaderSearch({ criteria, opened, onClose }: { criteria: CatalogCriteria; opened: boolean; onClose: (restoreFocus: boolean) => void }) {
  const navigate = useNavigate();
  const [input, setInput] = useState(criteria.query);
  const [query, setQuery] = useState("");
  const field = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLUListElement>(null);
  const helpId = useId();
  const normalized = input.trim();
  const valid = normalized.length <= 140;
  // Suggestions and submitted searches share an unfiltered global catalog destination.
  const destination = catalogHref({ ...readCatalogCriteria(""), query: normalized, page: 0 });
  useEffect(() => {
    if (opened) { setInput(criteria.query); setQuery(""); }
  }, [opened, criteria.query]);
  useEffect(() => {
    if (!opened) return;
    const timer = window.setTimeout(() => setQuery(normalized), 220);
    return () => window.clearTimeout(timer);
  }, [normalized, opened]);

  const suggestions = useQuery({
    queryKey: ["catalog-search-suggestions", query],
    queryFn: ({ signal }) => searchPublicEditions({ ...readCatalogCriteria(""), query, pageSize: 6 }, signal),
    enabled: opened && query.length > 0 && query.length <= 140,
    staleTime: 30_000,
    retry: false,
  });
  const waiting = normalized.length > 0 && (normalized !== query || suggestions.isFetching);
  function submit(event: FormEvent) {
    event.preventDefault();
    if (!valid) { field.current?.focus(); return; }
    onClose(false);
    navigate(destination);
  }
  function focusResult(index: number) {
    const links = list.current?.querySelectorAll<HTMLAnchorElement>("a");
    if (links?.length) links[Math.max(0, Math.min(index, links.length - 1))]?.focus();
  }
  function resultKey(event: KeyboardEvent, index: number) {
    if (event.key === "ArrowDown") { event.preventDefault(); focusResult(index + 1); }
    if (event.key === "ArrowUp") { event.preventDefault(); if (index === 0) field.current?.focus(); else focusResult(index - 1); }
  }
  return (
    <Modal opened={opened} onClose={() => onClose(true)} title="Buscar en el catálogo" closeButtonProps={{ "aria-label": "Cerrar búsqueda", size: 44 }} size={760} xOffset={12} yOffset={12} zIndex={100} returnFocus={false} transitionProps={{ duration: 0 }} classNames={{ content: classes.searchPanel, header: classes.searchHeading, title: classes.panelTitle, body: classes.searchBody }}>
      <form role="search" aria-label="Catálogo" onSubmit={submit} className={classes.searchForm}>
        <TextInput ref={field} data-autofocus type="search" aria-label="Buscar en el catálogo" placeholder="Título, autor o ISBN" value={input} maxLength={140} aria-describedby={helpId} error={!valid ? "La búsqueda no puede superar 140 caracteres." : undefined} leftSection={<MaterialSymbol name="search" />} classNames={{ root: classes.searchField, input: classes.searchInput }} onChange={(event) => setInput(event.currentTarget.value)} onKeyDown={(event) => {
          if (event.key === "ArrowDown" && !waiting && suggestions.data?.items.length) { event.preventDefault(); focusResult(0); }
        }} />
        <Button type="submit" className={classes.searchSubmit}>Buscar</Button>
      </form>
      <p id={helpId} className={classes.searchHelp}>Busca en todo el catálogo por título, autor o ISBN.<VisuallyHidden> Usa Tab o las flechas para recorrer las ediciones sugeridas.</VisuallyHidden></p>
      {normalized && <section aria-label="Resultados sugeridos" aria-busy={waiting} className={classes.suggestions}>
        {!valid ? null : waiting ? <p role="status" className={classes.message}>Buscando ediciones…</p>
          : suggestions.isError ? <div role="alert" className={classes.message}><p>No pudimos cargar sugerencias. Puedes buscar en el catálogo o volver a intentarlo.</p><Button variant="light" onClick={() => void suggestions.refetch()}>Reintentar</Button></div>
          : suggestions.data?.items.length ? <>
            <h2 className={classes.resultsTitle}>Ediciones</h2>
            <VisuallyHidden role="status">{suggestions.data.items.length} ediciones sugeridas.</VisuallyHidden>
            <ul ref={list} className={classes.resultsList}>
              {suggestions.data.items.map((edition, index) => <li key={edition.editionId}>
                <Link className={classes.result} to={`/catalog/editions/${edition.editionId}?from=${encodeURIComponent(destination)}`} onKeyDown={(event) => resultKey(event, index)} onClick={(event) => {
                  if (event.button === 0 && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey) onClose(false);
                }}>
                  <MaterialSymbol name="menu_book" />
                  <span className={classes.resultCopy}><strong>{edition.title}</strong><span>{edition.authors || edition.publisher || "Edición del catálogo"}</span></span>
                  {edition.isbn13 && <span className={classes.isbn}>ISBN {edition.isbn13}</span>}
                </Link>
              </li>)}
            </ul>
          </> : suggestions.data ? <p role="status" className={classes.message}>No encontramos ediciones para “{query}”. Prueba otro título, autor o ISBN.</p> : null}
      </section>}
    </Modal>
  );
}
