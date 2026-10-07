import { ActionIcon, Button, Modal, Skeleton, VisuallyHidden } from "@mantine/core";
import { useMediaQuery, useReducedMotion } from "@mantine/hooks";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useEffect, useId, useRef, useState, type FormEvent, type KeyboardEvent, type MouseEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { BookCover } from "@/features/catalog/BookCover";
import { mediaCue, mediaOfFormat } from "@/features/catalog/catalogMedia";
import { catalogHref, readCatalogCriteria, type CatalogCriteria } from "@/features/catalog/catalogUrl";
import { formatAuthorNames } from "@/features/catalog/formatters";
import { searchPublicEditions } from "@/shared/api/catalog";
import { MaterialSymbol } from "@/shared/ui/MaterialSymbol";
import classes from "./HeaderSearch.module.css";

interface Topic { slug: string; name: string }
// A short settle from above, without scaling, so the surface keeps its real size while it appears.
const searchTransition = { in: { opacity: 1, transform: "translateY(0)" }, out: { opacity: 0, transform: "translateY(-8px)" }, transitionProperty: "opacity, transform" };

/**
 * The catalog search surface: one field and one results panel, centered over a light veil
 * (a full-height sheet on phones). States: empty, typing, results, no results, error.
 */
export function HeaderSearch({ criteria, topics, opened, onClose }: { criteria: CatalogCriteria; topics: Topic[]; opened: boolean; onClose: (restoreFocus: boolean) => void }) {
  const navigate = useNavigate();
  const phone = useMediaQuery("(max-width: 599px)");
  const reducedMotion = useReducedMotion();
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
    // While typing, the previous list stays in place instead of collapsing the panel.
    placeholderData: keepPreviousData,
  });
  const waiting = normalized.length > 0 && (normalized !== query || suggestions.isFetching);
  const items = normalized && query ? suggestions.data?.items ?? [] : [];

  function submit(event: FormEvent) {
    event.preventDefault();
    if (!valid) { field.current?.focus(); return; }
    onClose(false);
    navigate(destination);
  }
  function clear() { setInput(""); setQuery(""); field.current?.focus(); }
  function focusResult(index: number) {
    const links = list.current?.querySelectorAll<HTMLAnchorElement>("a");
    if (links?.length) links[Math.max(0, Math.min(index, links.length - 1))]?.focus();
  }
  function resultKey(event: KeyboardEvent, index: number) {
    if (event.key === "ArrowDown") { event.preventDefault(); focusResult(index + 1); }
    if (event.key === "ArrowUp") { event.preventDefault(); if (index === 0) field.current?.focus(); else focusResult(index - 1); }
  }
  const closeOnPlainClick = (event: MouseEvent) => {
    if (event.button === 0 && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey) onClose(false);
  };
  const topicLinks = topics.length > 0 && <ul className={classes.topics}>
    {topics.map((topic) => <li key={topic.slug}><Link to={catalogHref({ ...readCatalogCriteria(""), category: topic.slug })} className={classes.topic} onClick={closeOnPlainClick}>{topic.name}</Link></li>)}
  </ul>;

  let body;
  if (!normalized) {
    body = <div className={classes.state} key="empty">
      {topicLinks && <><p className={classes.label}>Explora por tema</p>{topicLinks}</>}
      <p className={classes.hint}>Escribe un título, un autor o un ISBN. Pulsa Enter para ver todos los resultados.</p>
    </div>;
  } else if (!valid) {
    body = <p role="alert" className={classes.notice} key="invalid">La búsqueda no puede superar 140 caracteres.</p>;
  } else if (suggestions.isError && !suggestions.data) {
    body = <div role="alert" className={classes.notice} key="error"><p>No pudimos cargar sugerencias. Puedes buscar en todo el catálogo o volver a intentarlo.</p><Button variant="light" onClick={() => void suggestions.refetch()}>Reintentar</Button></div>;
  } else if (items.length) {
    body = <div className={classes.state} key="results" data-waiting={waiting || undefined}>
      <p className={classes.label} aria-hidden="true">{waiting ? "Buscando…" : items.length === 1 ? "1 edición" : `${items.length} ediciones`}</p>
      {!waiting && <VisuallyHidden role="status">{items.length === 1 ? "1 edición sugerida." : `${items.length} ediciones sugeridas.`}</VisuallyHidden>}
      <ul ref={list} className={classes.results}>
        {items.map((edition, index) => {
          // The medium is the edition's own format, as the API reports it.
          const cue = mediaCue(mediaOfFormat(edition.format));
          return <li key={edition.editionId}>
          <Link className={classes.result} to={`/catalog/editions/${edition.editionId}?from=${encodeURIComponent(destination)}`} onKeyDown={(event) => resultKey(event, index)} onClick={closeOnPlainClick}>
            <span className={classes.thumb}><BookCover url={edition.coverUrl} license={null} attribution={null} title={edition.title} size="compact" decorative /></span>
            <span className={classes.resultCopy}><strong>{edition.title}</strong><span>{formatAuthorNames(edition.authors)}</span></span>
            <span className={classes.resultMedia} data-media={edition.format === "EBOOK" || edition.format === "AUDIOBOOK" ? edition.format : "PHYSICAL"}><MaterialSymbol name={cue.symbol} size={18} aria-hidden="true" /><span>{cue.label}</span></span>
            <MaterialSymbol name="arrow_forward" size={20} className={classes.resultArrow} />
          </Link>
        </li>;
        })}
      </ul>
      <Link to={destination} className={classes.all} onClick={closeOnPlainClick}>Ver todos los resultados de “{normalized}”</Link>
    </div>;
  } else if (waiting || !suggestions.data) {
    body = <div className={classes.state} key="typing" aria-hidden="true">
      <p className={classes.label}>Buscando…</p>
      {[0, 1, 2].map((row) => <div className={classes.placeholder} key={row}><Skeleton width={36} height={54} radius={2} animate={false} /><div><Skeleton width="55%" height={14} animate={false} /><Skeleton width="35%" height={12} mt={10} animate={false} /></div></div>)}
    </div>;
  } else {
    body = <div className={classes.state} key="none">
      <VisuallyHidden role="status">Sin coincidencias.</VisuallyHidden>
      <p className={classes.emptyTitle}>Sin coincidencias para “{query}”</p>
      <p className={classes.hint}>Revisa la ortografía o prueba solo con el apellido del autor.</p>
      {topicLinks && <><p className={classes.label}>O explora un tema</p>{topicLinks}</>}
    </div>;
  }

  return (
    <Modal opened={opened} onClose={() => onClose(true)} title="Buscar en el catálogo" withCloseButton={false} fullScreen={Boolean(phone)} size={680} yOffset={88} zIndex={100} returnFocus={false}
      transitionProps={{ transition: searchTransition, duration: reducedMotion ? 0 : 160, timingFunction: "cubic-bezier(.32, .94, .6, 1)" }} overlayProps={{ color: "#1d1f38", backgroundOpacity: 0.28, blur: 2 }}
      classNames={{ inner: classes.inner, content: classes.surface, header: classes.heading, body: classes.body }}>
      <form role="search" aria-label="Catálogo" onSubmit={submit} className={classes.field}>
        <ActionIcon type="submit" variant="subtle" className={classes.submit} aria-label="Buscar"><MaterialSymbol name="search" size={24} /></ActionIcon>
        <input ref={field} data-autofocus type="search" aria-label="Buscar en el catálogo" placeholder="Título, autor o ISBN" value={input} maxLength={140} aria-describedby={helpId} aria-invalid={!valid || undefined} className={classes.input}
          onChange={(event) => setInput(event.currentTarget.value)} onKeyDown={(event) => {
            if (event.key === "ArrowDown" && !waiting && items.length) { event.preventDefault(); focusResult(0); }
          }} />
        {input && <ActionIcon variant="subtle" className={classes.clear} aria-label="Borrar búsqueda" onClick={clear}><MaterialSymbol name="close" size={20} /></ActionIcon>}
        <button type="button" className={classes.close} aria-label="Cerrar búsqueda" onClick={() => onClose(true)}>
          <span className={classes.esc} aria-hidden="true">Esc</span><MaterialSymbol name="arrow_back" size={24} className={classes.closeIcon} />
        </button>
      </form>
      <VisuallyHidden id={helpId}>Busca por título, autor o ISBN. Usa Tab o las flechas para recorrer las ediciones sugeridas y Enter para buscar en todo el catálogo.</VisuallyHidden>
      <section aria-label="Resultados sugeridos" aria-busy={waiting} className={classes.panel}>{body}</section>
    </Modal>
  );
}
