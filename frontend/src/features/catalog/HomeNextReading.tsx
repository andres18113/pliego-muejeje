import { ActionIcon, Skeleton, UnstyledButton } from "@mantine/core";
import { useEffect, useId, useMemo, useRef, useState, type CSSProperties, type PointerEvent } from "react";
import { Link, useLocation, useNavigationType } from "react-router-dom";
import { useSession } from "@/app/session";
import { useFavoriteSessionFailure, useFavoriteStatuses } from "@/features/favorites/favoriteStatus";
import { useQueries } from "@tanstack/react-query";
import { getPublicOffers, searchPublicEditions } from "@/shared/api/catalog";
import { storefrontDestinations } from "@/shared/navigation/storefrontDestinations";
import { describeApiError } from "@/shared/api/errors";
import { favoriteStatusQueryKey } from "@/shared/api/favorites";
import { useDelayedPending } from "@/shared/hooks/useDelayedPending";
import { MaterialSymbol } from "@/shared/ui/MaterialSymbol";
import { HomeActionButton } from "./HomeActions";
import { HomeReadingScene } from "./HomeReadingScene";
import { rememberCatalogReturnPosition } from "./catalogScrollRestoration";
import { readCatalogCriteria } from "./catalogUrl";
import classes from "./homeNextReading.module.css";

const criteria = readCatalogCriteria("");
interface SavedState { slug: string; index: number }
const readSaved = (): SavedState | null => {
  const saved = window.history.state?.pliegoHomeNextReading;
  return saved && typeof saved.slug === "string" && Number.isInteger(saved.index) ? saved : null;
};

/**
 * "Tu próxima lectura": a topic chooses the set, one scene shows one real book, and the
 * centered controls move through that set. Nothing moves unless the reader asks.
 */
export function HomeNextReading() {
  const roots = storefrontDestinations.map((item) => ({ ...item, slug: item.id, name: item.label }));
  const previews = useQueries({ queries: roots.map((item) => ({
    queryKey: ["public-catalog", "reading-preview", item.slug],
    queryFn: ({ signal }: { signal: AbortSignal }) => item.slug === "offers" ? getPublicOffers(0, 4, signal) : searchPublicEditions({ ...criteria, format: item.format, pageSize: 4 }, signal),
    staleTime: item.slug === "offers" ? 0 : 60_000,
    refetchInterval: item.slug === "offers" ? 30_000 : false,
    refetchOnWindowFocus: true,
  })) });
  const location = useLocation();
  const navigationType = useNavigationType();
  const { session, clear } = useSession();
  const viewportId = useId();
  const restored = useRef<SavedState | null>(navigationType === "POP" ? readSaved() : null);
  const swipe = useRef<{ x: number; y: number } | null>(null);
  const [chosen, setChosen] = useState<string | null>(restored.current?.slug ?? null);
  const [index, setIndex] = useState(restored.current?.index ?? 0);
  const [announcement, setAnnouncement] = useState("");

  const selectedIndex = Math.max(0, roots.findIndex((category) => category.slug === chosen));
  const category = roots[selectedIndex];
  const preview = previews[selectedIndex];
  const books = useMemo(() => preview?.data?.items ?? [], [preview?.data]);
  const active = Math.min(index, Math.max(0, books.length - 1));
  const pending = Boolean(preview?.isPending);
  const showPending = useDelayedPending(pending);

  const customerId = session?.user.role === "CUSTOMER" ? session.user.userId : null;
  const editionIds = useMemo(() => books.map((book) => book.editionId), [books]);
  const favoritesQuery = useFavoriteStatuses(editionIds, customerId);
  useFavoriteSessionFailure(favoritesQuery.error, clear);
  const sourceHref = `${location.pathname}${location.search}${location.hash}`;

  useEffect(() => {
    if (!category || books.length === 0 || (window.history.state?.key ?? "default") !== location.key) return;
    window.history.replaceState({ ...window.history.state, pliegoHomeNextReading: { slug: category.slug, index: active } }, "");
  }, [active, books.length, category, location.key]);

  function goTo(next: number) {
    if (next < 0 || next >= books.length || next === active) return;
    setIndex(next);
    setAnnouncement(`Libro ${next + 1} de ${books.length}: ${books[next].title}.`);
  }

  function choose(slug: string, name: string) {
    if (slug === category?.slug) return;
    setChosen(slug);
    setIndex(0);
    setAnnouncement(`Mostrando libros de ${name}.`);
  }

  // Touch and pen swipes complement the explicit controls; vertical page scrolling stays native.
  function startSwipe(event: PointerEvent) { swipe.current = event.pointerType === "mouse" ? null : { x: event.clientX, y: event.clientY }; }
  function endSwipe(event: PointerEvent) {
    const start = swipe.current;
    swipe.current = null;
    if (!start) return;
    const dx = event.clientX - start.x;
    if (Math.abs(dx) > 48 && Math.abs(dx) > Math.abs(event.clientY - start.y)) goTo(active + (dx < 0 ? 1 : -1));
  }

  const previewError = preview?.error && !preview.data
    ? describeApiError(preview.error, "No pudimos cargar estos libros", "Revisa tu conexión e inténtalo otra vez.")
    : undefined;
  const ready = !pending && !previewError && books.length > 0;

  return <section className={classes.section} aria-labelledby="discovery-heading" aria-busy={pending}>
    <h2 id="discovery-heading" className={classes.heading}>Tu próxima lectura.</h2>
    <div className={classes.bar}>
      <div className={classes.topics} role="group" aria-label="Elige qué leer">
        {roots.map((root) => <UnstyledButton key={root.slug} className={classes.topic} aria-pressed={root.slug === category?.slug} aria-controls={viewportId} onClick={() => choose(root.slug, root.name)}>{root.name}</UnstyledButton>)}
      </div>
      {ready && <Link to={category.href} className={classes.link}>
        {`Ver ${category.name} en el catálogo`}
      </Link>}
    </div>
    <p className="visually-hidden" role="status" aria-live="polite" aria-atomic="true">{pending ? "Cargando libros…" : announcement}</p>

    {pending ? <div className={classes.loading}>
      <p className={classes.note} hidden={!showPending}>Cargando libros…</p>
      <div className={classes.placeholder} aria-hidden="true"><Skeleton className={classes.placeholderCover} animate={false} /><div><Skeleton height={20} width="35%" animate={false} /><Skeleton height={56} width="85%" mt={18} animate={false} /><Skeleton height={32} width="30%" mt={44} animate={false} /></div></div>
    </div> : category.slug === "offers" && !previewError && books.length === 0 ? <div className={classes.notice}>
      <h3 className={classes.noticeTitle}>No hay ofertas disponibles por ahora.</h3>
      <p>Cuando tengamos promociones, podrás consultarlas aquí.</p>
      <Link to="/catalog" className={classes.link}>Explorar libros</Link>
    </div> : previewError ? <div className={classes.notice} role="alert">
      <p className={classes.noticeTitle}>{previewError.title}</p>
      <p>{previewError.detail}</p>
      <HomeActionButton onClick={() => void preview?.refetch()}>Volver a intentar</HomeActionButton>
    </div> : !category || books.length === 0 ? <div className={classes.notice}>
      <h3 className={classes.noticeTitle}>{category ? `Aún no hay libros publicados en ${category.name}.` : "Aún no hay ediciones publicadas."}</h3>
      <p>Vuelve a consultar el catálogo para revisar las ediciones disponibles.</p>
      <Link to="/catalog" className={classes.link}>Ver el catálogo</Link>
    </div> : <>
      {preview?.error && <p className={classes.notice} role="alert">
        No se pudieron actualizar estos libros. Mostramos los datos anteriores; el precio y la disponibilidad pueden haber cambiado.{" "}
        <HomeActionButton onClick={() => void preview.refetch()}>Volver a intentar</HomeActionButton>
      </p>}
      {favoritesQuery.isError && customerId && <p className={classes.note} role="status">No pudimos consultar cuáles están guardados. Vuelve a cargar la página para comprobarlo.</p>}
      <div id={viewportId} className={classes.viewport} onPointerDown={startSwipe} onPointerUp={endSwipe} onPointerCancel={() => { swipe.current = null; }}>
        <div className={classes.track} key={category.slug} data-reading-track data-active={active}
          style={{ "--i": active } as CSSProperties}>
          {books.map((book, position) => <HomeReadingScene key={book.editionId} edition={book} position={position + 1} total={books.length} active={position === active}
            detailHref={`/catalog/editions/${encodeURIComponent(book.editionId)}?from=${encodeURIComponent(sourceHref)}`} returnHref={sourceHref}
            isFavorite={favoritesQuery.statusByEdition.get(book.editionId) ?? false} favoriteReady={!customerId || Boolean(favoritesQuery.data)}
            favoriteQueryKey={favoriteStatusQueryKey(customerId ?? "guest", favoritesQuery.stableIds)}
            onOpen={(event) => {
              if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
              rememberCatalogReturnPosition({ locationKey: location.key, href: sourceHref, scrollY: window.scrollY });
            }} />)}
        </div>
      </div>
      {books.length > 1 && <div className={classes.controls}>
        <ActionIcon variant="default" size={48} className={classes.arrow} aria-label="Libro anterior" aria-controls={viewportId} aria-disabled={active === 0} onClick={() => goTo(active - 1)}><MaterialSymbol name="arrow_back" size={22} /></ActionIcon>
        <div className={classes.dots} role="group" aria-label={`Lecturas disponibles: ${category.name}`}>
          {books.map((book, position) => <button type="button" key={book.editionId} className={classes.dot} aria-label={`Libro ${position + 1} de ${books.length}: ${book.title}`}
            aria-current={position === active || undefined} aria-controls={viewportId} onClick={() => goTo(position)}><span /></button>)}
        </div>
        <ActionIcon variant="default" size={48} className={classes.arrow} aria-label="Libro siguiente" aria-controls={viewportId} aria-disabled={active === books.length - 1} onClick={() => goTo(active + 1)}><MaterialSymbol name="arrow_forward" size={22} /></ActionIcon>
      </div>}
    </>}
  </section>;
}
