import { Skeleton } from "@mantine/core";
import { useEffect, useId, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import { Link } from "react-router-dom";
import { BookCover } from "@/features/catalog/BookCover";
import type { useStorefrontNavigation } from "@/features/storefront/storefrontQuery";
import type { StorefrontSection } from "@/shared/api/storefront";
import { MaterialSymbol, type MaterialSymbolName } from "@/shared/ui/MaterialSymbol";
import header from "./SiteHeader.module.css";
import classes from "./HeaderNavigation.module.css";

type Navigation = ReturnType<typeof useStorefrontNavigation>;

/** A section opens a menu only when the projection gives it something beyond its own destination. */
export function hasSectionMenu(section: StorefrontSection) {
  return section.featured.length > 0 || section.categories.length > 0 || section.bestSellingHref !== null;
}

/** Each medium's glyph, as on the Home and the edition page (book_2, mobile, headphones). */
const sectionSymbol: Partial<Record<StorefrontSection["key"], MaterialSymbolName>> = { PHYSICAL: "book_2", EBOOK: "mobile", AUDIOBOOK: "headphones" };

/** The section's own "everything" destination, named for its medium. */
function browseAll(section: StorefrontSection) {
  const noun = section.key === "PHYSICAL" ? "los libros" : section.key === "EBOOK" ? "los eBooks" : section.key === "AUDIOBOOK" ? "los audiolibros" : null;
  return { label: noun ? `Explorar todos ${noun}` : `Explorar todo: ${section.label}`, href: section.allHref ?? section.href };
}

/** "Explorar más": only the destinations the projection supplies for this section — never invented ones. */
function moreDestinations(section: StorefrontSection) {
  return [
    ...(section.bestSellingHref ? [{ key: "best", label: "Más vendidos", name: `Más vendidos: ${section.label}`, href: section.bestSellingHref, count: null }] : []),
    ...(section.offersHref ? [{ key: "offers", label: "Ofertas", name: `Ofertas: ${section.label}`, href: section.offersHref, count: section.activeOfferCount !== "0" ? section.activeOfferCount : null }] : []),
  ];
}

function NavigationState({ navigation }: { navigation: Navigation }) {
  return <>
    {navigation.isPending && <>
      <span className="visually-hidden" role="status">Cargando navegación…</span>
      <span className={classes.pending} aria-hidden="true">{[64, 58, 92, 62, 52].map((width, index) => <Skeleton key={index} h={12} w={width} radius={6} animate={false} />)}</span>
    </>}
    {navigation.isError && <span className={classes.failure} role="alert">No pudimos cargar la navegación. <button type="button" className={classes.retry} onClick={() => void navigation.refetch()}>Reintentar navegación</button></span>}
  </>;
}

/**
 * Desktop: the server's sections on the bar. Every section name is a link to its whole catalog, so one click
 * on "Libros" lands on all the books. A section with featured titles, subjects or a bestseller destination adds
 * its menu as a separate chevron button right after the name, whose panel follows it in the tab order.
 * A mouse opens a panel on hover (over the name or the chevron) and moves between sections without a click;
 * leaving the bar and panel closes it after a short grace (never while keyboard focus is inside). The chevron's
 * click, ↓ on the name or the chevron, Escape and a press outside keep working, so hover is never the only way in.
 */
export function DesktopNavigation({ navigation, selected, openKey, onOpenChange }: {
  navigation: Navigation; selected: string | undefined; openKey: string | null; onOpenChange: (key: string | null, restoreFocus?: boolean) => void;
}) {
  const uid = useId();
  const sections = navigation.data?.sections ?? [];
  const closeTimer = useRef<number | undefined>(undefined);
  /** A panel the pointer just opened stays open on the click that usually follows the hover. */
  const hoverOpened = useRef(false);
  const cancelClose = () => window.clearTimeout(closeTimer.current);
  useEffect(() => cancelClose, []);
  useEffect(() => { if (!openKey) hoverOpened.current = false; }, [openKey]);
  function onBarLeave(event: PointerEvent<HTMLUListElement>) {
    if (event.pointerType !== "mouse" || !openKey) return;
    cancelClose();
    closeTimer.current = window.setTimeout(() => {
      if (!document.querySelector("[data-header-menu] :focus-visible")) onOpenChange(null);
    }, 150);
  }
  function onTriggerEnter(event: PointerEvent<HTMLElement>, key: string) {
    if (event.pointerType !== "mouse") return;
    cancelClose();
    if (openKey !== key) { hoverOpened.current = true; onOpenChange(key); }
  }
  function onTriggerKey(event: KeyboardEvent<HTMLElement>, key: string) {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      onOpenChange(key);
      const item = event.currentTarget.closest("li");
      requestAnimationFrame(() => item?.querySelector<HTMLAnchorElement>("[data-menu-panel] a")?.focus());
    }
  }
  return <nav className={header.navigation} aria-label="Navegación principal" aria-busy={navigation.isPending}>
    <NavigationState navigation={navigation} />
    {sections.length > 0 && <ul className={classes.bar} onPointerEnter={cancelClose} onPointerLeave={onBarLeave}>
      {sections.map(section => {
        if (!hasSectionMenu(section)) return <li key={section.key} onPointerEnter={event => { if (event.pointerType === "mouse" && openKey) onOpenChange(null); }}>
          <Link to={section.href} className={header.navLink} aria-current={selected === section.key ? "page" : undefined} onClick={() => onOpenChange(null)}>{section.label}</Link>
        </li>;
        const open = openKey === section.key;
        const all = browseAll(section);
        const more = moreDestinations(section);
        const close = () => onOpenChange(null);
        return <li key={section.key} data-header-menu
          onBlur={event => { if (open && event.relatedTarget instanceof Node && !event.currentTarget.contains(event.relatedTarget)) onOpenChange(null); }}
          onKeyDown={event => { if (open && event.key === "Escape") { event.stopPropagation(); onOpenChange(null, true); event.currentTarget.querySelector<HTMLButtonElement>("button[aria-expanded]")?.focus(); } }}>
          <span className={classes.split} data-open={open || undefined}>
            {/* The name goes straight to the section's whole catalog; the chevron is the way into its menu. */}
            <Link to={all.href} className={`${header.navLink} ${classes.sectionLink}`} aria-current={selected === section.key ? "page" : undefined}
              onClick={close} onPointerEnter={event => onTriggerEnter(event, section.key)} onKeyDown={event => onTriggerKey(event, section.key)}>
              {section.label}
            </Link>
            <button type="button" className={classes.trigger} aria-expanded={open} aria-controls={open ? `${uid}-${section.key}` : undefined} aria-label={`Menú de ${section.label}`}
              onClick={() => { if (open && hoverOpened.current) { hoverOpened.current = false; return; } onOpenChange(open ? null : section.key); }}
              onPointerEnter={event => onTriggerEnter(event, section.key)} onKeyDown={event => onTriggerKey(event, section.key)}>
              <MaterialSymbol name="expand_more" size={18} className={classes.chevron} aria-hidden="true" />
            </button>
          </span>
          {open && <div id={`${uid}-${section.key}`} className={classes.panel} role="region" aria-label={`Menú de ${section.label}`} data-menu-panel>
            <div className={classes.panelInner}>
              <div className={classes.main}>
                <p className={`${classes.eyebrow} ${classes.sectionHeading}`}>{sectionSymbol[section.key] && <MaterialSymbol name={sectionSymbol[section.key]!} size={16} aria-hidden="true" />}{section.label}</p>
                {section.featured.length > 0 && <ul className={classes.featured} aria-label={`Destacados de ${section.label}`}>{section.featured.map(product => <li key={product.editionId}>
                  <Link to={product.href} className={classes.product} data-media={product.productType} onClick={close}>
                    <span className={classes.productCover} aria-hidden="true"><BookCover url={product.coverUrl} license={null} attribution={null} title={product.title} size="compact" decorative /></span>
                    <span className={classes.titleArea}><span className={classes.productTitle}>{product.title}</span></span>
                  </Link>
                </li>)}</ul>}
                <Link to={all.href} className={classes.browseAll} onClick={close}>
                  <span>{all.label}</span><MaterialSymbol name="arrow_forward" size={20} className={classes.browseArrow} />
                </Link>
              </div>
              {more.length > 0 && <div className={classes.more}>
                <p className={classes.eyebrow} id={`${uid}-${section.key}-more`}>Explorar más</p>
                <ul aria-labelledby={`${uid}-${section.key}-more`}>{more.map(destination => <li key={destination.key}>
                  <Link to={destination.href} aria-label={destination.name} onClick={close}>
                    {destination.label}{destination.count && <span className={classes.count}>{destination.count}</span>}<MaterialSymbol name="chevron_right" size={20} className={classes.moreArrow} />
                  </Link>
                </li>)}</ul>
              </div>}
            </div>
          </div>}
        </li>;
      })}
    </ul>}
  </nav>;
}

/**
 * Phones and tablets: the same sections as a list. Every section name goes to its whole catalog in one tap; a
 * section with secondary destinations adds a 44px chevron at the end of its row that unfolds it in place with the
 * desktop panel's architecture — featured titles, "Explorar todos…", then "Explorar más".
 */
export function MobileNavigation({ navigation, selected, onNavigate }: { navigation: Navigation; selected: string | undefined; onNavigate: () => void }) {
  const uid = useId();
  const sections = navigation.data?.sections ?? [];
  const [chosen, setChosen] = useState<string | null | undefined>(undefined);
  const openKey = chosen === undefined ? selected ?? null : chosen;
  return <nav className={classes.sheetNavigation} aria-label="Navegación principal" aria-busy={navigation.isPending}>
    <NavigationState navigation={navigation} />
    {sections.length > 0 && <ul className={classes.sheetList}>
      {sections.map(section => {
        if (!hasSectionMenu(section)) return <li key={section.key}>
          <Link to={section.href} className={classes.sheetRow} aria-current={selected === section.key ? "page" : undefined} onClick={onNavigate}>{section.label}</Link>
        </li>;
        const open = openKey === section.key;
        const all = browseAll(section);
        const more = moreDestinations(section);
        return <li key={section.key}>
          <div className={classes.sheetSplit} data-open={open || undefined}>
            <Link to={all.href} className={classes.sheetRow} aria-current={selected === section.key ? "page" : undefined} onClick={onNavigate}>{section.label}</Link>
            <button type="button" className={classes.sheetToggle} aria-expanded={open} aria-controls={open ? `${uid}-${section.key}` : undefined}
              aria-label={`Menú de ${section.label}`} onClick={() => setChosen(open ? null : section.key)}>
              <MaterialSymbol name={open ? "expand_less" : "expand_more"} size={22} aria-hidden="true" />
            </button>
          </div>
          {open && <div id={`${uid}-${section.key}`} className={classes.sheetSection}>
            {section.featured.length > 0 && <ul className={classes.sheetFeatured} aria-label={`Destacados de ${section.label}`}>{section.featured.map(product => <li key={product.editionId}>
              <Link to={product.href} className={classes.sheetProduct} data-media={product.productType} onClick={onNavigate}>
                <span className={classes.sheetCover} aria-hidden="true"><BookCover url={product.coverUrl} license={null} attribution={null} title={product.title} size="compact" decorative /></span>
                <span className={classes.productTitle}>{product.title}</span>
              </Link>
            </li>)}</ul>}
            <Link to={all.href} className={classes.browseAll} onClick={onNavigate}>
              <span>{all.label}</span><MaterialSymbol name="arrow_forward" size={20} className={classes.browseArrow} />
            </Link>
            {more.length > 0 && <div className={classes.more}>
              <p className={classes.eyebrow} id={`${uid}-${section.key}-more`}>Explorar más</p>
              <ul aria-labelledby={`${uid}-${section.key}-more`}>{more.map(destination => <li key={destination.key}>
                <Link to={destination.href} aria-label={destination.name} onClick={onNavigate}>
                  {destination.label}{destination.count && <span className={classes.count}>{destination.count}</span>}<MaterialSymbol name="chevron_right" size={20} className={classes.moreArrow} />
                </Link>
              </li>)}</ul>
            </div>}
          </div>}
        </li>;
      })}
    </ul>}
  </nav>;
}
