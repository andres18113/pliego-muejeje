import { useEffect, useLayoutEffect, useMemo, useRef } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { describeApiError } from "@/shared/api/errors";
import type { OffersCriteria } from "@/shared/api/catalog";
import { MaterialSymbol } from "@/shared/ui/MaterialSymbol";
import { SiteFooter } from "@/shared/ui/SiteFooter";
import { EditionGrid } from "./EditionGrid";
import { EditionLoadingGrid } from "./EditionLoadingGrid";
import { readCatalogCriteria } from "./catalogUrl";
import { offersCountLabel } from "./offersPresentation";
import { useOffers, useOffersFilterOptions } from "./offersQuery";
import { offersHref, readOffersCriteria } from "./offersUrl";
import classes from "./offers.module.css";

/**
 * Ofertas: the page name and one line on the paper, the product types as chips, then the count beside
 * theme and order, and the shelf. Types, themes, orders, counts, prices and validity are the server's.
 */
export function OffersPage() {
  const location = useLocation();
  const navigate = useNavigate();
  const criteria = useMemo(() => readOffersCriteria(location.search), [location.search]);
  const pendingCriteria = useRef(criteria);
  useLayoutEffect(() => { pendingCriteria.current = criteria; }, [criteria]);
  const offers = useOffers(criteria);
  const filters = useOffersFilterOptions();
  const page = offers.data;
  const hasNext = page && BigInt(page.page + 1) * BigInt(page.pageSize) < page.totalCountValue;
  const pageCount = page ? Math.max(1, Math.ceil(Number(page.totalCountValue) / page.pageSize)) : 1;
  const filtered = Boolean(criteria.productType || criteria.category);
  const pageHref = (number: number) => offersHref({ ...criteria, page: number });
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
        <h1 className={classes.title}>Ofertas</h1>
        <p className={classes.intro}>Ediciones con precio rebajado por tiempo limitado. El carrito y la compra confirman el precio vigente de cada edición.</p>
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
          {(filters.data.categories.length > 0 || criteria.category) && <label className={classes.control}><span>Tema</span>
            <span className={classes.select}><select aria-label="Categoría de ofertas" value={criteria.category} onChange={event => change({ category: event.target.value })}>
              <option value="">Todas las categorías</option>
              {filters.data.categories.map(category => <option key={category.slug} value={category.slug}>{category.name} ({category.count})</option>)}
            </select><MaterialSymbol name="expand_more" size={20} /></span>
          </label>}
          <label className={classes.control}><span>Ordenar</span>
            <span className={classes.select}><select aria-label="Ordenar ofertas" value={criteria.sort} onChange={event => change({ sort: event.target.value as OffersCriteria["sort"] })}>
              {filters.data.sorts.map(sort => <option key={sort.code} value={sort.code}>{sort.label}</option>)}
            </select><MaterialSymbol name="expand_more" size={20} /></span>
          </label>
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
          ? <EditionGrid editions={page.items} criteria={{ ...readCatalogCriteria(""), page: criteria.page }} detailReturnHref={pageHref(criteria.page)} presentation="offers" />
          : <div className={classes.notice} data-kind="empty">
            {page.totalCountValue !== 0n
              ? <><h2>No hay ofertas en esta página.</h2><Link className={classes.action} to={pageHref(0)}>Ir a la primera página</Link></>
              : filtered
                ? <><h2>No hay ofertas con estos filtros.</h2><p>Las ofertas cambian con frecuencia. Mira todo lo que está rebajado hoy.</p><button type="button" className={classes.action} onClick={() => change({ productType: "", category: "" })}>Ver todas las ofertas</button></>
                : <><h2>No hay ofertas disponibles por ahora.</h2><p>Cuando una edición baje de precio aparecerá aquí.</p><Link className={classes.action} to="/catalog">Explorar libros</Link></>}
          </div>}
        {(criteria.page > 0 || hasNext) && <nav className={classes.pages} aria-label="Paginación de ofertas">
          {criteria.page > 0 && <Link className={classes.pageStep} to={pageHref(criteria.page - 1)}><MaterialSymbol name="arrow_back" />Anterior</Link>}
          <span className={classes.pagePosition}>Página {criteria.page + 1} de {Math.max(pageCount, criteria.page + 1)}</span>
          {hasNext && <Link className={classes.pageStep} to={pageHref(criteria.page + 1)}>Siguiente<MaterialSymbol name="arrow_forward" /></Link>}
        </nav>}
      </section>}
      {page && page.items.length > 0 && <p className={classes.onward}><Link to="/catalog">Explorar libros</Link></p>}
    </main>
    <SiteFooter />
  </>;
}
