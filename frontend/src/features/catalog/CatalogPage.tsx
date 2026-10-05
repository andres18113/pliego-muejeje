import { stockReadOptions } from "@/features/catalog/stockStatusModel";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link, useLocation, useNavigate, useNavigationType } from "react-router-dom";
import { Button } from "@mantine/core";
import { CatalogControls } from "./CatalogControls";
import classes from "./exploration.module.css";
import { SiteFooter } from "@/shared/ui/SiteFooter";
import { describeApiError } from "@/shared/api/errors";
import { getPublicCategories, getPublicCatalogFilterOptions, searchPublicEditions } from "@/shared/api/catalog";
import { CatalogFilters } from "./CatalogFilters";
import { EditionGrid } from "./EditionGrid";
import { EditionLoadingGrid } from "./EditionLoadingGrid";
import { Pagination } from "./Pagination";
import { useCatalogReturnScrollRestoration } from "./catalogScrollRestoration";
import {
  catalogHref,
  hasAnyCriteria,
  hasActiveFilters,
  readCatalogCriteria,
  type CatalogCriteria,
} from "./catalogUrl";


const numberFormat = new Intl.NumberFormat("es-EC");

export function CatalogPage() {
  const location = useLocation();
  const navigate = useNavigate();
  const navigationType = useNavigationType();
  const criteria = useMemo(() => readCatalogCriteria(location.search), [location.search]);
  const previousCriteria = useRef(criteria);
  const resultsRef = useRef<HTMLElement>(null);
  const filterTrigger = useRef<HTMLButtonElement>(null);
  const [filtersOpen, setFiltersOpen] = useState(false);
  // Filter choices navigate within the catalog; only leaving it closes the drawer.
  useEffect(() => setFiltersOpen(false), [location.pathname]);
  const categoriesQuery = useQuery({
    queryKey: ["public-catalog", "categories"],
    queryFn: ({ signal }) => getPublicCategories(signal),
    staleTime: 60_000,
  });
  const filterOptionsQuery = useQuery({
    queryKey: ["public-catalog", "filter-options"],
    queryFn: ({ signal }) => getPublicCatalogFilterOptions(signal),
    staleTime: 60_000,
  });
  const editionsQuery = useQuery({
    queryKey: ["public-catalog", "editions", criteria],
    ...stockReadOptions,
    queryFn: ({ signal }) => searchPublicEditions(criteria, signal),
    staleTime: 20_000,
  });

  useEffect(() => {
    document.title = criteria.query
      ? `${criteria.query} · Catálogo · PLIEGO`
      : "Catálogo · PLIEGO";
  }, [criteria.query]);

  const activePage = editionsQuery.data;
  useCatalogReturnScrollRestoration(
    !editionsQuery.isFetching && !categoriesQuery.isFetching && !filterOptionsQuery.isFetching,
    resultsRef,
  );

  useLayoutEffect(() => {
    const previous = previousCriteria.current;
    previousCriteria.current = criteria;

    const changedPageOnly = previous.page !== criteria.page
      && catalogHref({ ...previous, page: 0 }) === catalogHref({ ...criteria, page: 0 });
    if (!changedPageOnly) return;

    const results = resultsRef.current;
    if (!results) return;
    results.focus({ preventScroll: true });

    const scrollToResults = () => window.scrollTo(
      0,
      Math.max(0, results.getBoundingClientRect().top + window.scrollY - 104),
    );
    // POP may restore a previous page position after this layout effect.
    // Schedule the results alignment after React Router applies that position.
    if (navigationType === "POP") {
      const frame = window.requestAnimationFrame(scrollToResults);
      return () => window.cancelAnimationFrame(frame);
    }

    scrollToResults();
  }, [criteria, location.key, navigationType]);
  const resultError = editionsQuery.error
    ? describeApiError(editionsQuery.error, "No pudimos actualizar el catálogo", "Revisa tu conexión e inténtalo otra vez.")
    : undefined;
  const isCurrentReadPending = editionsQuery.isPending;
  const categories = categoriesQuery.data?.items || [];
  const filterOptionsError = filterOptionsQuery.error
    ? describeApiError(filterOptionsQuery.error, "No pudimos cargar los filtros", "Revisa tu conexión e inténtalo otra vez.")
    : undefined;

  function navigateToCriteria(next: CatalogCriteria, replace = false) {
    navigate(catalogHref(next), { replace });
  }

  function removeCriterion(field: "query" | "category" | "minPrice" | "maxPrice" | "language" | "format") {
    if (field === "query") {
      navigateToCriteria({ ...criteria, query: "", page: 0 });
    } else if (field === "minPrice" || field === "maxPrice") {
      navigateToCriteria({ ...criteria, minPrice: "", maxPrice: "", page: 0 });
    } else {
      navigateToCriteria({ ...criteria, [field]: "", page: 0 });
    }
  }

  function clearAll() {
    navigateToCriteria({ ...criteria, query: "", category: "", minPrice: "", maxPrice: "", language: "", format: "", page: 0 });
  }

  const unavailableCategory = resultError?.code === "P2022";
  const staleRefresh = !unavailableCategory && Boolean(activePage && editionsQuery.isRefetchError);

  return (
    <div className={classes.surface} data-storefront-surface>
      <main id="contenido-principal" tabIndex={-1} className={classes.page}>
        <div className={classes.shell}>
        <CatalogControls criteria={criteria} categories={categories} options={filterOptionsQuery.data} optionsError={filterOptionsError?.detail || ""} pending={isCurrentReadPending} total={activePage?.totalCountValue} filtersOpen={filtersOpen} filterTrigger={filterTrigger} onToggleFilters={() => setFiltersOpen((current) => !current)} onChange={navigateToCriteria} onRemove={removeCriterion} onClearAll={clearAll} />
        <CatalogFilters criteria={criteria} options={filterOptionsQuery.data} error={filterOptionsError?.detail || ""} opened={filtersOpen} categories={categories} categoriesLoading={categoriesQuery.isPending} categoriesError={categoriesQuery.isError} total={activePage?.totalCountValue} pending={editionsQuery.isFetching} onClose={() => setFiltersOpen(false)} onApply={navigateToCriteria} onRetry={() => void filterOptionsQuery.refetch()} />

        <section
          ref={resultsRef}
          className={classes.results}
          aria-labelledby="catalog-results-heading"
          aria-busy={isCurrentReadPending}
          tabIndex={-1}
        >
          <h2 id="catalog-results-heading" className="visually-hidden">Resultados</h2>
          <div
            className="visually-hidden"
            role="status"
            aria-live="polite"
            aria-atomic="true"
          >
            {isCurrentReadPending && !activePage
              ? "Buscando ediciones…"
              : activePage
                ? `${numberFormat.format(activePage.totalCountValue)} ${activePage.totalCountValue === 1n ? "edición encontrada." : "ediciones encontradas."}`
                : ""}
          </div>

          {unavailableCategory ? (
            <div className={classes.notice} role="alert">
              <p className={classes.noticeTitle}>{resultError.title}</p>
              <p>{resultError.detail}</p>
              <Button variant="light" type="button" onClick={() => removeCriterion("category")}>
                Quitar categoría
              </Button>
            </div>
          ) : resultError && !activePage ? (
            <div className={classes.notice} role="alert">
              <p className={classes.noticeTitle}>{resultError.title}</p>
              <p>{resultError.detail}</p>
              <Button variant="light" type="button" onClick={() => void editionsQuery.refetch()}>
                Volver a intentar
              </Button>
            </div>
          ) : editionsQuery.isPending && !activePage ? (
            <EditionLoadingGrid count={criteria.pageSize} />
          ) : activePage && activePage.items.length > 0 ? (
            <>
              {staleRefresh && (
                <p className={classes.notice} role={resultError ? "alert" : undefined}>
                  {resultError
                    ? "No se pudo actualizar esta búsqueda. Mostramos los resultados anteriores; el precio y la disponibilidad pueden haber cambiado."
                    : "Actualizando la búsqueda. El precio y la disponibilidad pueden haber cambiado."}
                  {" "}
                  <Button variant="subtle" type="button" onClick={() => void editionsQuery.refetch()}>
                    Volver a intentar
                  </Button>
                </p>
              )}
              <EditionGrid editions={activePage.items} criteria={criteria} />
              <Pagination
                criteria={criteria}
                totalCount={activePage.totalCount}
                onRetry={() => void editionsQuery.refetch()}
              />
            </>
          ) : activePage && criteria.page > 0 ? (
            <div className={classes.empty}>
              <h3>Esta página ya no tiene ediciones.</h3>
              <p>
                El catálogo pudo cambiar desde tu última visita. Vuelve a la primera página para revisar los resultados actuales.
              </p>
              <Button component={Link}
                variant="light"
                to={catalogHref({ ...criteria, page: 0 })}
                preventScrollReset
              >
                Ir a la primera página
              </Button>
            </div>
          ) : activePage ? (
            <EmptyCatalogState
              criteria={criteria}
              categoryName={categories.find((category) => category.slug === criteria.category)?.name}
              onRetry={() => void editionsQuery.refetch()}
            />
          ) : null}
        </section>
        </div>
      </main>

      <SiteFooter />
    </div>
  );
}

function EmptyCatalogState({
  criteria,
  categoryName,
  onRetry,
}: {
  criteria: CatalogCriteria;
  categoryName?: string;
  onRetry: () => void;
}) {
  const filtered = hasAnyCriteria(criteria);
  const filteredByCategory = Boolean(criteria.category);
  const title = !filtered
    ? "Aún no hay ediciones publicadas."
    : filteredByCategory && !criteria.query && !hasActiveFilters({ ...criteria, category: "" })
      ? `No hay ediciones publicadas en ${categoryName || criteria.category}.`
      : "No encontramos ediciones con estos criterios.";

  return (
    <div className={classes.empty}>

      <h3>{title}</h3>
      <p>
        {!filtered
          ? "Vuelve a consultar el catálogo para ver las ediciones disponibles."
          : "Puedes cambiar los filtros o volver a explorar todo el catálogo."}
      </p>
      {!filtered ? (
        <Button variant="light" type="button" onClick={onRetry}>
          Actualizar catálogo
        </Button>
      ) : (
        <div className={classes.emptyActions}>
          {hasActiveFilters(criteria) && (
            <Button component={Link}
              variant="light"
              to={catalogHref({
                ...criteria,
                category: "",
                minPrice: "",
                maxPrice: "",
                language: "",
                format: "",
                page: 0,
              })}
            >
              Limpiar filtros
            </Button>
          )}
          {criteria.query && (
            <Link
              className="text-link"
              to={catalogHref({ ...criteria, query: "", page: 0 })}
            >
              Limpiar búsqueda
            </Link>
          )}
        </div>
      )}
    </div>
  );
}
