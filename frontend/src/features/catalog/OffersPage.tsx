import { useEffect, useLayoutEffect, useMemo, useRef } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { Button } from "@mantine/core";
import { describeApiError } from "@/shared/api/errors";
import { EditionGrid } from "./EditionGrid";
import { readCatalogCriteria } from "./catalogUrl";
import { useOffers, useOffersFilterOptions } from "./offersQuery";
import { offersHref, readOffersCriteria } from "./offersUrl";
import type { OffersCriteria } from "@/shared/api/catalog";

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
  const pageHref = (number: number) => offersHref({ ...criteria, page: number });
  const change = (update: Partial<OffersCriteria>) => {
    // Consecutive controls can run before router navigation renders the previous URL.
    const next = { ...pendingCriteria.current, ...update, page: 0 };
    pendingCriteria.current = next;
    navigate(offersHref(next));
  };
  useEffect(() => { document.title = "Ofertas · PLIEGO"; }, []);
  return <main className="page-frame" id="contenido-principal" tabIndex={-1}>
    <h1>Ofertas</h1>
    <p>El carrito y la compra confirman el precio vigente de cada edición.</p>
    {filters.isPending && <p role="status">Consultando filtros…</p>}
    {filters.isError && <p role="alert">No pudimos actualizar los filtros de ofertas. <Button onClick={() => void filters.refetch()}>Actualizar filtros</Button></p>}
    {filters.data && <div>
      <div role="group" aria-label="Tipo de producto en oferta">
        <Button variant="subtle" aria-pressed={!criteria.productType} onClick={() => change({ productType: "" })}>Todas las ofertas</Button>
        {filters.data.productTypes.map(type => <Button variant="subtle" key={type.code} aria-pressed={criteria.productType === type.code} onClick={() => change({ productType: type.code })}>{type.label} ({type.count})</Button>)}
      </div>
      <label>Categoría de ofertas <select value={criteria.category} onChange={event => change({ category: event.target.value })}>
        <option value="">Todas las categorías</option>
        {filters.data.categories.map(category => <option key={category.slug} value={category.slug}>{category.name} ({category.count})</option>)}
      </select></label>
      <label>Ordenar ofertas <select value={criteria.sort} onChange={event => change({ sort: event.target.value as OffersCriteria["sort"] })}>
        {filters.data.sorts.map(sort => <option key={sort.code} value={sort.code}>{sort.label}</option>)}
      </select></label>
    </div>}
    {offers.isPending && <p role="status">Consultando ofertas…</p>}
    {offers.isError && <div role="alert"><p>{describeApiError(offers.error).detail}</p><Button onClick={() => void offers.refetch()}>Volver a intentar</Button></div>}
    {page && <section aria-label="Ediciones en oferta" aria-busy={offers.isFetching}>
      <p role="status">{page.totalCount} {page.totalCount === "1" ? "oferta" : "ofertas"}</p>
      {page.items.length ? <EditionGrid editions={page.items} criteria={{ ...readCatalogCriteria(""), page: criteria.page }} detailReturnHref={pageHref(criteria.page)} /> : <p>{page.totalCountValue === 0n ? "No hay ofertas disponibles por ahora." : "No hay ofertas en esta página."}</p>}
      {(criteria.page > 0 || hasNext) && <nav aria-label="Paginación de ofertas">
        {criteria.page > 0 && <Link to={pageHref(criteria.page - 1)}>Anterior</Link>}
        <span> Página {criteria.page + 1} </span>
        {hasNext && <Link to={pageHref(criteria.page + 1)}>Siguiente</Link>}
      </nav>}
    </section>}
    <Link to="/catalog">Explorar libros</Link>
  </main>;
}
