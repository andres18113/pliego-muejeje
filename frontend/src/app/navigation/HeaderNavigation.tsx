import { Skeleton } from "@mantine/core";
import { useId, useState, type KeyboardEvent } from "react";
import { Link } from "react-router-dom";
import { BookCover } from "@/features/catalog/BookCover";
import { formatUsd } from "@/features/catalog/formatters";
import type { useStorefrontNavigation } from "@/features/storefront/storefrontQuery";
import type { StorefrontSection } from "@/shared/api/storefront";
import { MaterialSymbol } from "@/shared/ui/MaterialSymbol";
import header from "./SiteHeader.module.css";
import classes from "./HeaderNavigation.module.css";

type Navigation = ReturnType<typeof useStorefrontNavigation>;
const topicLimit = 8;

/** A section opens a menu only when the projection gives it something beyond its own destination. */
export function hasSectionMenu(section: StorefrontSection) {
  return section.featured.length > 0 || section.categories.length > 0 || section.bestSellingHref !== null;
}

/** Top-level subjects only (never the whole tree), capped; "Ver todos" reaches the rest. Presentation only. */
function menuTopics(section: StorefrontSection) {
  const roots = section.categories.filter(category => category.parentSlug === null);
  return (roots.length > 0 ? roots : section.categories).slice(0, topicLimit);
}

function primaryDestinations(section: StorefrontSection) {
  return [
    { key: "all", label: "Ver todos", name: `Ver todos: ${section.label}`, href: section.allHref ?? section.href, count: null },
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

function FeaturedPrice({ product }: { product: StorefrontSection["featured"][number] }) {
  return <span className={classes.price}>
    <span>{formatUsd(product.price)}</span>
    {product.offer && <><span className="visually-hidden"> Precio anterior </span><s>{formatUsd(product.offer.originalPrice)}</s></>}
  </span>;
}

/**
 * Desktop: the server's sections on the bar. A section with featured titles, subjects or a bestseller
 * destination is a disclosure button whose panel follows it in the tab order; the others are plain links.
 */
export function DesktopNavigation({ navigation, selected, openKey, onOpenChange }: {
  navigation: Navigation; selected: string | undefined; openKey: string | null; onOpenChange: (key: string | null, restoreFocus?: boolean) => void;
}) {
  const uid = useId();
  const sections = navigation.data?.sections ?? [];
  function onTriggerKey(event: KeyboardEvent<HTMLButtonElement>, key: string) {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      onOpenChange(key);
      const item = event.currentTarget.closest("li");
      requestAnimationFrame(() => item?.querySelector<HTMLAnchorElement>("[data-menu-panel] a")?.focus());
    }
  }
  return <nav className={header.navigation} aria-label="Navegación principal" aria-busy={navigation.isPending}>
    <NavigationState navigation={navigation} />
    {sections.length > 0 && <ul className={classes.bar}>
      {sections.map(section => {
        if (!hasSectionMenu(section)) return <li key={section.key} onMouseEnter={() => openKey && onOpenChange(null)}>
          <Link to={section.href} className={header.navLink} aria-current={selected === section.key ? "page" : undefined} onClick={() => onOpenChange(null)}>{section.label}</Link>
        </li>;
        const open = openKey === section.key;
        const topics = menuTopics(section);
        return <li key={section.key} data-header-menu
          onBlur={event => { if (open && event.relatedTarget instanceof Node && !event.currentTarget.contains(event.relatedTarget)) onOpenChange(null); }}
          onKeyDown={event => { if (open && event.key === "Escape") { event.stopPropagation(); onOpenChange(null, true); event.currentTarget.querySelector<HTMLButtonElement>("button[aria-expanded]")?.focus(); } }}>
          <button type="button" className={`${header.navLink} ${classes.trigger}`} aria-expanded={open} aria-controls={open ? `${uid}-${section.key}` : undefined} aria-current={selected === section.key ? "page" : undefined}
            onClick={() => onOpenChange(open ? null : section.key)} onMouseEnter={() => { if (openKey && !open) onOpenChange(section.key); }} onKeyDown={event => onTriggerKey(event, section.key)}>
            {section.label}<MaterialSymbol name="expand_more" size={18} className={classes.chevron} />
          </button>
          {open && <div id={`${uid}-${section.key}`} className={classes.panel} role="region" aria-label={`Menú de ${section.label}`} data-menu-panel>
            <div className={classes.panelInner}>
              <div className={classes.lead}>
                <p className={classes.panelTitle}>{section.label}</p>
                <ul className={classes.primary}>{primaryDestinations(section).map(destination => <li key={destination.key}>
                  <Link to={destination.href} aria-label={destination.name} onClick={() => onOpenChange(null)}>{destination.label}{destination.count && <span className={classes.count}>{destination.count}</span>}<MaterialSymbol name="arrow_forward" size={18} /></Link>
                </li>)}</ul>
              </div>
              {section.featured.length > 0 && <ul className={classes.featured} aria-label={`Destacados de ${section.label}`}>{section.featured.map(product => <li key={product.editionId}>
                <Link to={product.href} className={classes.product} onClick={() => onOpenChange(null)}>
                  <span className={classes.productCover}><BookCover url={product.coverUrl} license={null} attribution={null} title={product.title} size="compact" decorative /></span>
                  <span className={classes.productTitle}>{product.title}</span>
                  {product.authors && <span className={classes.productAuthors}>{product.authors}</span>}
                  <FeaturedPrice product={product} />
                </Link>
              </li>)}</ul>}
              {topics.length > 0 && <div className={classes.topics}>
                <p id={`${uid}-${section.key}-topics`}>Temas</p>
                <ul aria-labelledby={`${uid}-${section.key}-topics`}>{topics.map(category => <li key={category.slug}><Link to={category.href} onClick={() => onOpenChange(null)}>{category.name}</Link></li>)}</ul>
              </div>}
            </div>
          </div>}
        </li>;
      })}
    </ul>}
  </nav>;
}

/**
 * Phones and tablets: the same sections as a list. A section with secondary destinations unfolds in place —
 * its destinations, its featured titles as compact rows and its subjects — instead of a shrunken panel.
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
        const topics = menuTopics(section);
        return <li key={section.key}>
          <button type="button" className={classes.sheetRow} aria-expanded={open} aria-controls={open ? `${uid}-${section.key}` : undefined} aria-current={selected === section.key ? "page" : undefined} onClick={() => setChosen(open ? null : section.key)}>
            {section.label}<MaterialSymbol name={open ? "expand_less" : "expand_more"} size={22} />
          </button>
          {open && <div id={`${uid}-${section.key}`} className={classes.sheetSection}>
            <ul className={classes.sheetPrimary}>{primaryDestinations(section).map(destination => <li key={destination.key}>
              <Link to={destination.href} aria-label={destination.name} onClick={onNavigate}>{destination.label}{destination.count && <span className={classes.count}>{destination.count}</span>}</Link>
            </li>)}</ul>
            {section.featured.length > 0 && <ul className={classes.sheetFeatured} aria-label={`Destacados de ${section.label}`}>{section.featured.map(product => <li key={product.editionId}>
              <Link to={product.href} className={classes.sheetProduct} onClick={onNavigate}>
                <span className={classes.sheetCover}><BookCover url={product.coverUrl} license={null} attribution={null} title={product.title} size="compact" decorative /></span>
                <span className={classes.sheetProductText}><span className={classes.productTitle}>{product.title}</span><FeaturedPrice product={product} /></span>
              </Link>
            </li>)}</ul>}
            {topics.length > 0 && <div className={classes.sheetTopics}>
              <p id={`${uid}-${section.key}-topics`}>Temas</p>
              <ul aria-labelledby={`${uid}-${section.key}-topics`}>{topics.map(category => <li key={category.slug}><Link to={category.href} onClick={onNavigate}>{category.name}</Link></li>)}</ul>
            </div>}
          </div>}
        </li>;
      })}
    </ul>}
  </nav>;
}
