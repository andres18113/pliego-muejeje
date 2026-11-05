import { useEffect, useLayoutEffect, useMemo, useRef } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { describeApiError } from "@/shared/api/errors";
import type { OffersCriteria } from "@/shared/api/catalog";
import { ChoicePicker } from "@/shared/ui/ChoicePicker";
import { MaterialSymbol } from "@/shared/ui/MaterialSymbol";
import { SiteFooter } from "@/shared/ui/SiteFooter";
import { EditionGrid } from "./EditionGrid";
import { EditionLoadingGrid } from "./EditionLoadingGrid";
import { readCatalogCriteria } from "./catalogUrl";
import { offersCountLabel } from "./offersPresentation";
import { useOffers, useOffersFilterOptions } from "./offersQuery";
import { offersHref, readOffersCriteria } from "./offersUrl";
import classes from "./offers.module.css";

/** The "every theme" choice; the URL keeps an empty category for it. */
const ALL_THEMES = "todos";

/**
 * Ofertas: a small eyebrow over one headline on the paper, the product types as thin chips, then the count
 * facing theme and order (PLIEGO's quiet choice pickers), every active offer on one shelf (no pages), and
 * three plain facts about how offers work. Types, themes, orders, counts, prices and validity are the server's.
 */
/**
 * The page's calm close after the last offer: three plain facts about how PLIEGO offers work, each true of
 * the current behavior (offers end at their own date, cover all three media, and the price returns on its own).
 */
function OffersPromise() {
  return <section className={classes.promise} aria-labelledby="offers-promise-heading">
    <h2 id="offers-promise-heading" className="visually-hidden">Cómo funcionan las ofertas</h2>
    <ul>
      <li><MaterialSymbol name="event" size={32} aria-hidden="true" /><h3>Ofertas por tiempo limitado.</h3><p>Cada oferta se mantiene hasta su fecha de cierre. Cuando le quedan pocos días, lo verás en la edición.</p></li>
      <li><MaterialSymbol name="sell" size={32} aria-hidden="true" /><h3>Ahorra en cualquier formato.</h3><p>Encuentra ofertas en libros físicos, eBooks y audiolibros.</p></li>
      <li><MaterialSymbol name="price_check" size={32} aria-hidden="true" /><h3>Precio siempre actualizado.</h3><p>Cuando una oferta termina, la edición vuelve automáticamente a su precio normal.</p></li>
    </ul>
  </section>;
}

export function OffersPage() {
  const location = useLocation();
  const navigate = useNavigate();
  const criteria = useMemo(() => readOffersCriteria(location.search), [location.search]);
  const pendingCriteria = useRef(criteria);
  useLayoutEffect(() => { pendingCriteria.current = criteria; }, [criteria]);
  const offers = useOffers(criteria);
  const filters = useOffersFilterOptions();
  const page = offers.data;
  const filtered = Boolean(criteria.productType || criteria.category);
  const change = (update: Partial<OffersCriteria>) => {
    // Consecutive controls can run before router navigation renders the previous URL.
    const next = { ...pendingCriteria.current, ...update, page: 0 };
    pendingCriteria.current = next;
    navigate(offersHref(next));
  };
  useEffect(() => { document.title = "Ofertas · PLIEGO"; }, []);
  return <>
    <main className={`page-frame ${classes.page}`} id="contenido-principal" tabIndex={-1} data-storefront-surface>
      <header className={classes.masthead}>
        <p className={classes.eyebrow}>Ofertas especiales</p>
        <h1 className={classes.title}>Descubre las últimas ofertas.</h1>
      </header>

      {filters.isPending && <p className={classes.filtersNote} role="status">Consultando filtros…</p>}
      {filters.isError && <p className={classes.filtersNote} role="alert">No pudimos actualizar los filtros de ofertas. <button type="button" className={classes.textAction} onClick={() => void filters.refetch()}>Actualizar filtros</button></p>}
      {filters.data && <div className={classes.chips} role="group" aria-label="Tipo de producto en oferta">
        <button type="button" className={classes.chip} aria-pressed={!criteria.productType} onClick={() => change({ productType: "" })}>Todas las ofertas</button>
        {filters.data.productTypes.map(type => <button type="button" className={classes.chip} key={type.code} aria-pressed={criteria.productType === type.code} onClick={() => change({ productType: type.code })}>{type.label} <span className={classes.chipCount}>({type.count})</span></button>)}
      </div>}

      {(page || filters.data) && <div className={classes.toolbar}>
        <p className={classes.count} role="status">{page ? offersCountLabel(page.totalCount) : ""}</p>
        {filters.data && <div className={classes.controls}>
          {(filters.data.categories.length > 0 || criteria.category) && <ChoicePicker label="Tema" caption="Tema" className={classes.picker} align="end" appearance="quiet"
            value={criteria.category || ALL_THEMES}
            options={[{ value: ALL_THEMES, label: "Todos los temas" }, ...filters.data.categories.map(category => ({ value: category.slug, label: `${category.name} (${category.count})` }))]}
            onChange={category => change({ category: category === ALL_THEMES ? "" : category })} />}
          <ChoicePicker label="Ordenar por" caption="Ordenar por" className={classes.picker} align="end" appearance="quiet"
            value={criteria.sort} options={filters.data.sorts.map(sort => ({ value: sort.code, label: sort.label }))}
            onChange={sort => change({ sort })} />
        </div>}
      </div>}

      {offers.isPending && <>
        <p className="visually-hidden" role="status">Consultando ofertas…</p>
        <EditionLoadingGrid count={8} presentation="offers" />
      </>}
      {offers.isError && <div className={classes.notice} role="alert">
        <h2>No pudimos consultar las ofertas.</h2>
        <p>{describeApiError(offers.error).detail}</p>
        <button type="button" className={classes.action} onClick={() => void offers.refetch()}>Volver a intentar</button>
      </div>}
      {page && <section className={classes.results} aria-label="Ediciones en oferta" aria-busy={offers.isFetching}>
        {page.items.length > 0
          ? <EditionGrid editions={page.items} criteria={{ ...readCatalogCriteria(""), page: criteria.page }} detailReturnHref={offersHref(criteria)} presentation="offers" />
          : <div className={classes.notice} data-kind="empty">
            {filtered
                ? <><h2>No hay ofertas con estos filtros.</h2><p>Las ofertas cambian con frecuencia. Mira todo lo que está rebajado hoy.</p><button type="button" className={classes.action} onClick={() => change({ productType: "", category: "" })}>Ver todas las ofertas</button></>
                : <><h2>No hay ofertas disponibles por ahora.</h2><p>Cuando una edición baje de precio aparecerá aquí.</p><Link className={classes.action} to="/catalog">Explorar libros</Link></>}
          </div>}
      </section>}
      {page && page.items.length > 0 && <OffersPromise />}
    </main>
    <SiteFooter />
  </>;
}
