import { ActionIcon, Skeleton } from "@mantine/core";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState, type CSSProperties, type PointerEvent } from "react";
import { Link } from "react-router-dom";
import { useStorefrontNavigation } from "@/features/storefront/storefrontQuery";
import { searchPublicEditions } from "@/shared/api/catalog";
import type { StorefrontSection } from "@/shared/api/storefront";
import { MaterialSymbol, type MaterialSymbolName } from "@/shared/ui/MaterialSymbol";
import { BookCover } from "./BookCover";
import { HomeActionButton } from "./HomeActions";
import { readCatalogCriteria } from "./catalogUrl";
import { formatUsd } from "./formatters";
import classes from "./homeDiscovery.module.css";
import audiobooksPhoto from "./assets/discovery-audiolibros.webp";
import booksPhoto from "./assets/discovery-libros.webp";
import ebooksPhoto from "./assets/discovery-ebooks.webp";

type MediaKey = "PHYSICAL" | "EBOOK" | "AUDIOBOOK";
/** Wording, photograph and glyph only: which sections exist, their names, destinations and titles come from the projection. */
const mediaCopy: Record<MediaKey, { line: string; action: string; symbol: MaterialSymbolName; photo: string }> = {
  PHYSICAL: { line: "En papel, para tener cerca.", action: "Explorar libros", symbol: "menu_book", photo: booksPhoto },
  EBOOK: { line: "En pantalla, donde estés.", action: "Explorar eBooks", symbol: "menu_book", photo: ebooksPhoto },
  AUDIOBOOK: { line: "En voz alta, para escuchar.", action: "Explorar audiolibros", symbol: "headphones", photo: audiobooksPhoto },
};
const isMedia = (section: StorefrontSection): section is StorefrontSection & { key: MediaKey } => section.key in mediaCopy;
const mediaSections = (sections: StorefrontSection[] | undefined) => (sections ?? []).filter(isMedia);

/** Each way of reading has its own photograph. Only if that file fails to load does the section's featured jacket (or its glyph) stand in. */
function DiscoveryVisual({ section }: { section: StorefrontSection & { key: MediaKey } }) {
  const [failed, setFailed] = useState(false);
  const copy = mediaCopy[section.key];
  const cover = section.featured[0];
  return <div className={classes.visual} aria-hidden="true">
    {!failed ? <img className={classes.photo} src={copy.photo} alt="" width={1200} height={900} decoding="async" onError={() => setFailed(true)} />
      : cover ? <BookCover url={cover.coverUrl} license={null} attribution={null} title={cover.title} size="card" loading="eager" decorative />
      : <MaterialSymbol name={copy.symbol} size={48} className={classes.glyph} />}
  </div>;
}

/** 1 · Opening: the brand by name, the three ways to read, and one entry point for each. */
export function HomeDiscovery() {
  const navigation = useStorefrontNavigation();
  const sections = mediaSections(navigation.data?.sections);
  return <section className={classes.hero} aria-labelledby="page-title" aria-busy={navigation.isPending}>
    <div className={classes.head}>
      <div className={classes.headCopy}>
        <h1 id="page-title">Descubre el mundo de <span className={classes.brand}>PLIEGO</span>.</h1>
        <p>Historias en papel, en pantalla o para escuchar.</p>
      </div>
    </div>
    {navigation.isPending ? <>
      <span className="visually-hidden" role="status">Cargando secciones…</span>
      <ul className={classes.tiles} aria-hidden="true">{[0, 1, 2].map(index => <li key={index} className={classes.tile}>
        <Skeleton className={classes.visual} animate={false} />
        <div className={classes.tileCopy}><Skeleton height={26} width="46%" animate={false} /><Skeleton height={16} width="72%" mt={12} animate={false} /><Skeleton height={16} width="38%" mt={22} animate={false} /></div>
      </li>)}</ul>
    </> : sections.length > 0 ? <ul className={classes.tiles}>{sections.map(section => {
      const copy = mediaCopy[section.key];
      return <li key={section.key} className={classes.tile} data-media={section.key}>
        <DiscoveryVisual section={section} />
        <div className={classes.tileCopy}>
          <h2>{section.label}</h2>
          <p>{copy.line}</p>
          <Link to={section.allHref ?? section.href} className={classes.tileLink}><span>{copy.action}</span><MaterialSymbol name="chevron_right" size={20} /></Link>
        </div>
      </li>;
    })}</ul> : navigation.isError ? <p className={classes.note} role="alert">No pudimos cargar las secciones de la tienda. <HomeActionButton onClick={() => void navigation.refetch()}>Reintentar</HomeActionButton></p>
      : <p className={classes.note}><Link to="/catalog" className={classes.tileLink}><span>Ver el catálogo</span><MaterialSymbol name="chevron_right" size={20} /></Link></p>}
  </section>;
}

function PopularPrice({ product }: { product: PopularProduct }) {
  return <span className={classes.price}>
    <span>{formatUsd(product.price)}</span>
    {product.offer && <><span className="visually-hidden"> Precio anterior </span><s>{formatUsd(product.offer.originalPrice)}</s></>}
  </span>;
}

type FeaturedProduct = StorefrontSection["featured"][number];
/** How many of each section's featured titles the row shows. Composition only: which titles, and in what order, is the projection's. */
const popularShare: Record<MediaKey, number> = { PHYSICAL: 3, EBOOK: 1, AUDIOBOOK: 1 };
/** What the row needs from a title, whichever read supplied it. */
interface PopularProduct { editionId: string; title: string; authors: string; coverUrl: string | null; price: string; offer?: { originalPrice: string } | null; productType: FeaturedProduct["productType"]; href: string }
/** The row opens on the projection's five; this many more books follow them from the catalog's own bestseller order. */
const moreBooks = 10;
/** Position dots while they fit a phone; a longer set of pages shows a position rail instead. */
const maxDots = 6;
/** Every medium says what it is in the same quiet line over the jacket. */
const mediaCue: Record<FeaturedProduct["productType"], { label: string; symbol: MaterialSymbolName }> = {
  PHYSICAL: { label: "Libro", symbol: "book_2" },
  EBOOK: { label: "eBook", symbol: "mobile" },
  AUDIOBOOK: { label: "Audiolibro", symbol: "headphones" },
};

/**
 * 2 · Popular: one open row of featured titles — books, then an eBook, then an audiobook — followed by more books in
 * the catalog's bestseller order. A track that steps by whole pages, with round arrows and position dots; touch
 * swipes are a complement. Its footer is one system: previous, a position rail, next, then the bestseller links.
 * Identification only — the edition page sells. Nothing moves unless the reader asks.
 */
export function HomePopular() {
  const navigation = useStorefrontNavigation();
  const sections = useMemo(() => mediaSections(navigation.data?.sections), [navigation.data]);
  const featured: PopularProduct[] = useMemo(() => sections.flatMap(section => section.featured.slice(0, popularShare[section.key])), [sections]);
  // More books: the server's own bestseller destination for Libros, read through the catalog search the catalog page uses.
  // The order is the server's; here the titles already in the row are only skipped.
  const books = sections.find(section => section.key === "PHYSICAL");
  const booksHref = books ? books.bestSellingHref ?? books.allHref ?? books.href : null;
  const moreCriteria = useMemo(() => booksHref ? { ...readCatalogCriteria(new URL(booksHref, "https://pliego.invalid").search), page: 0, pageSize: moreBooks + popularShare.PHYSICAL } : null, [booksHref]);
  const more = useQuery({
    queryKey: ["public-catalog", "popular-more", moreCriteria],
    queryFn: ({ signal }) => searchPublicEditions(moreCriteria!, signal),
    enabled: moreCriteria !== null && featured.length > 0,
    staleTime: 60_000,
  });
  const products = useMemo(() => {
    const shown = new Set(featured.map(product => product.editionId));
    const extra: PopularProduct[] = (more.data?.items ?? []).filter(edition => !shown.has(edition.editionId)).slice(0, moreBooks)
      .map(edition => ({ editionId: edition.editionId, title: edition.title, authors: edition.authors, coverUrl: edition.coverUrl, price: edition.price, offer: edition.offer, productType: "PHYSICAL", href: `/catalog/editions/${encodeURIComponent(edition.editionId)}` }));
    return [...featured, ...extra];
  }, [featured, more.data]);
  const bestSelling = sections.filter(section => section.bestSellingHref && section.featured.length > 0);
  const count = products.length;
  const track = useRef<HTMLDivElement>(null);
  const swipe = useRef<{ x: number; y: number } | null>(null);
  const [page, setPage] = useState(0);
  // How many titles a page holds is the stylesheet's decision (--per); the offsets are read from the laid-out items.
  const [layout, setLayout] = useState({ per: 5, offsets: [0] });

  useEffect(() => {
    const node = track.current;
    if (!node) return;
    const measure = () => {
      const items = [...node.children] as HTMLElement[];
      const per = Math.max(1, Number.parseInt(getComputedStyle(node).getPropertyValue("--per"), 10) || 5);
      // The furthest the row may travel: its last title flush with the end of a full page. Read from the titles themselves.
      const start = items[0]?.offsetLeft ?? 0, edge = (item: HTMLElement | undefined) => item ? item.offsetLeft + item.offsetWidth - start : 0;
      const limit = Math.max(0, edge(items[items.length - 1]) - edge(items[Math.min(per, items.length) - 1]));
      const offsets = Array.from({ length: Math.max(1, Math.ceil(items.length / per)) }, (_, index) => Math.min((items[index * per]?.offsetLeft ?? start) - start, limit));
      setLayout(current => current.per === per && current.offsets.length === offsets.length && current.offsets.every((offset, index) => Math.abs(offset - offsets[index]) < 1) ? current : { per, offsets });
    };
    measure();
    if (typeof ResizeObserver === "undefined") return;
    // Item widths come from the container and settle after the first pass: watch the row and its ends, not only the track.
    const observer = new ResizeObserver(measure);
    for (const target of [node, node.firstElementChild, node.lastElementChild]) if (target) observer.observe(target);
    return () => observer.disconnect();
  }, [count]);

  const pages = layout.offsets.length;
  const active = Math.min(page, pages - 1);
  const offset = layout.offsets[active] ?? 0;
  const goTo = (next: number) => { if (next >= 0 && next < pages) setPage(next); };
  // Touch and pen swipes complement the explicit controls; vertical page scrolling stays native.
  function startSwipe(event: PointerEvent) { swipe.current = event.pointerType === "mouse" ? null : { x: event.clientX, y: event.clientY }; }
  function endSwipe(event: PointerEvent) {
    const start = swipe.current;
    swipe.current = null;
    if (!start) return;
    const dx = event.clientX - start.x;
    if (Math.abs(dx) > 48 && Math.abs(dx) > Math.abs(event.clientY - start.y)) goTo(active + (dx < 0 ? 1 : -1));
  }
  // A title belongs to the page in view when it lies between that page's first title and the next page's.
  const first = active * layout.per, last = active === pages - 1 ? count : first + layout.per;
  const inView = (index: number) => active === pages - 1 && pages > 1 ? index >= count - layout.per : index >= first && index < last;

  if (!navigation.isPending && count === 0) return null;
  return <section className={classes.popular} aria-labelledby="popular-heading" aria-busy={navigation.isPending}>
    <h2 id="popular-heading" className={classes.popularHeading}>Popular en PLIEGO</h2>
    {navigation.isPending ? <div className={classes.pendingRow} aria-hidden="true">{[0, 1, 2, 3, 4].map(index => <div key={index} className={classes.item}>
      <Skeleton className={classes.frame} animate={false} /><Skeleton height={20} width="80%" mt={14} animate={false} /><Skeleton height={14} width="55%" mt={8} animate={false} /><Skeleton height={16} width="30%" mt={8} animate={false} />
    </div>)}</div> : <>
      <div id="popular-rail" className={classes.rail} onPointerDown={startSwipe} onPointerUp={endSwipe} onPointerCancel={() => { swipe.current = null; }}>
        <div ref={track} className={classes.track} data-popular-track data-page={active} data-static={pages === 1 || undefined} style={{ "--offset": `${offset}px` } as CSSProperties}>
          {products.map((product, index) => {
            const cue = mediaCue[product.productType];
            return <div key={product.editionId} className={classes.item} data-media={product.productType} inert={!inView(index)}>
              <span className={classes.frame}>
                <span className={classes.cue}><MaterialSymbol name={cue.symbol} size={18} />{cue.label}</span>
                <span className={classes.object}><BookCover url={product.coverUrl} license={null} attribution={null} title={product.title} size="card" decorative /></span>
              </span>
              <Link to={product.href} className={classes.itemTitle}>{product.title}</Link>
              <span className={classes.itemAuthors}>{product.authors}</span>
              <PopularPrice product={product} />
              <span className={classes.itemAction} aria-hidden="true">Ver edición<MaterialSymbol name="chevron_right" size={20} /></span>
            </div>;
          })}
        </div>
      </div>
      <div className={classes.railFooter}>
        {pages > 1 && <div className={classes.railNav}>
          <ActionIcon variant="default" size={48} className={classes.arrow} aria-label="Títulos anteriores" aria-controls="popular-rail" aria-disabled={active === 0} onClick={() => goTo(active - 1)}><MaterialSymbol name="arrow_back" size={22} /></ActionIcon>
          {pages <= maxDots ? <div className={classes.dots} role="group" aria-label="Páginas de títulos populares">
            {layout.offsets.map((_, index) => <button type="button" key={index} className={classes.dot} aria-label={`Página ${index + 1} de ${pages}`} aria-current={index === active || undefined} aria-controls="popular-rail" onClick={() => goTo(index)}><span /></button>)}
          </div> : <span className={classes.railProgress} aria-hidden="true"><span style={{ width: `${100 / pages}%`, left: `${active * 100 / pages}%` }} /></span>}
          <ActionIcon variant="default" size={48} className={classes.arrow} aria-label="Más títulos" aria-controls="popular-rail" aria-disabled={active === pages - 1} onClick={() => goTo(active + 1)}><MaterialSymbol name="arrow_forward" size={22} /></ActionIcon>
          <span className="visually-hidden" role="status" aria-live="polite">{`Página ${active + 1} de ${pages}`}</span>
        </div>}
        {bestSelling.length > 0 && <p className={classes.bestSelling}>
          <span>Más vendidos</span>
          {bestSelling.map(section => <Link key={section.key} to={section.bestSellingHref!} aria-label={`Más vendidos: ${section.label}`}>{section.label}</Link>)}
        </p>}
      </div>
    </>}
  </section>;
}
