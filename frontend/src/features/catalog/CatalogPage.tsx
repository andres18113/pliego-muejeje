import { useEffect, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { Button, ButtonLink } from "@/components/ui/button";
import { SiteFooter } from "@/shared/ui/SiteFooter";
import { describeApiError } from "@/shared/api/errors";
import { getPublicCategories, getPublicCatalogFilterOptions, searchPublicEditions } from "@/shared/api/catalog";
import { CatalogFilters } from "./CatalogFilters";
import { CatalogHeader } from "./CatalogHeader";
import { CategoryNavigation } from "./CategoryNavigation";
import { EditionGrid } from "./EditionGrid";
import { Pagination } from "./Pagination";
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
  const criteria = useMemo(() => readCatalogCriteria(location.search), [location.search]);
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
    queryFn: ({ signal }) => searchPublicEditions(criteria, signal),
    staleTime: 20_000,
  });

  useEffect(() => {
    document.title = criteria.query
      ? `${criteria.query} · Catálogo · PLIEGO`
      : "Catálogo · PLIEGO";
  }, [criteria.query]);

  const activePage = editionsQuery.data;
  const resultError = editionsQuery.error
    ? describeApiError(editionsQuery.error, "No pudimos actualizar el catálogo", "Revisa tu conexión e inténtalo otra vez.")
    : undefined;
  const isCurrentReadPending = editionsQuery.isFetching;
  const categories = categoriesQuery.data?.items || [];
  const categoriesError = categoriesQuery.error
    ? describeApiError(categoriesQuery.error, "No pudimos actualizar las categorías", "Revisa tu conexión e inténtalo otra vez.")
    : undefined;
  const filterOptionsError = filterOptionsQuery.error
    ? describeApiError(filterOptionsQuery.error, "No pudimos cargar los filtros", "Revisa tu conexión e inténtalo otra vez.")
    : undefined;

  function navigateToCriteria(next: CatalogCriteria, replace = false) {
    navigate(catalogHref(next), { replace });
  }

  function removeCriterion(field: "query" | "category" | "minPrice" | "maxPrice" | "language" | "format") {
    if (field === "query") {
      navigateToCriteria({ ...criteria, query: "", scope: "title", page: 0 });
    } else if (field === "minPrice" || field === "maxPrice") {
      navigateToCriteria({ ...criteria, minPrice: "", maxPrice: "", page: 0 });
    } else {
      navigateToCriteria({ ...criteria, [field]: "", page: 0 });
    }
  }

  const unavailableCategory = resultError?.code === "P2022";
  const staleRefresh = !unavailableCategory && Boolean(activePage && (isCurrentReadPending || editionsQuery.isRefetchError));

  return (
    <>
      <CatalogHeader
        criteria={criteria}
        pending={isCurrentReadPending}
        onSearch={(query, scope) => navigateToCriteria({ ...criteria, query, scope, page: 0 })}
      />

      <CategoryNavigation
        categories={categories}
        selectedSlug={criteria.category}
        criteria={criteria}
        loading={categoriesQuery.isFetching}
        error={categoriesError ? `${categoriesError.title}. ${categoriesError.detail}` : ""}
        onRetry={() => void categoriesQuery.refetch()}
      />

      <main id="contenido-principal" tabIndex={-1}>
        <section className="discovery-lead page-frame" aria-labelledby="page-title">
          <div className="lead-copy">
            <h1 id="page-title">
              Una lectura empieza <span>por una{"\u00a0"}pista.</span>
            </h1>
            <p>Abre un libro y descubre a dónde te lleva.</p>
          </div>
        </section>

        <CatalogFilters
          criteria={criteria}
          categories={categories}
          filterOptions={filterOptionsQuery.data}
          filterOptionsLoading={filterOptionsQuery.isFetching}
          filterOptionsError={filterOptionsError?.detail || ""}
          pending={isCurrentReadPending}
          onApply={navigateToCriteria}
          onSort={(sort) => navigateToCriteria({ ...criteria, sort, page: 0 })}
          onRemove={removeCriterion}
        />

        <section
          className="catalog-results page-frame"
          aria-labelledby="catalog-results-heading"
          aria-busy={isCurrentReadPending}
        >
          <h2 id="catalog-results-heading" className="visually-hidden">Resultados</h2>
          <div
            className={`result-status${activePage ? " visually-hidden" : ""}`}
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
            <div className="catalog-error category-unavailable" role="alert">
              <p className="error-title">{resultError.title}</p>
              <p>{resultError.detail}</p>
              <Button variant="secondary" type="button" onClick={() => removeCriterion("category")}>
                Quitar categoría
              </Button>
            </div>
          ) : resultError && !activePage ? (
            <div className="catalog-error" role="alert">
              <p className="error-title">{resultError.title}</p>
              <p>{resultError.detail}</p>
              <Button variant="secondary" type="button" onClick={() => void editionsQuery.refetch()}>
                Volver a intentar
              </Button>
            </div>
          ) : editionsQuery.isPending && !activePage ? (
            <EditionLoadingState />
          ) : activePage && activePage.items.length > 0 ? (
            <>
              {staleRefresh && (
                <p className="stale-data-note" role={resultError ? "alert" : undefined}>
                  {resultError
                    ? "No se pudo actualizar esta búsqueda. Mostramos los resultados anteriores; el precio y la disponibilidad pueden haber cambiado."
                    : "Actualizando la búsqueda. El precio y la disponibilidad pueden haber cambiado."}
                  {" "}
                  <Button variant="text" type="button" onClick={() => void editionsQuery.refetch()}>
                    Volver a intentar
                  </Button>
                </p>
              )}
              <div className="results-summary">
                <p>
                  <strong>{numberFormat.format(activePage.totalCountValue)}</strong>
                  {" "}{activePage.totalCountValue === 1n ? "edición" : "ediciones"}
                </p>
                {activePage.totalCountValue > 0n && (
                  <p className="page-position">
                    Página {numberFormat.format(criteria.page + 1)}
                  </p>
                )}
              </div>
              <EditionGrid editions={activePage.items} criteria={criteria} />
              <Pagination
                criteria={criteria}
                totalCount={activePage.totalCount}
                onRetry={() => void editionsQuery.refetch()}
              />
            </>
          ) : activePage && criteria.page > 0 ? (
            <div className="empty-state stale-page">
              <h3>Esta página ya no tiene ediciones.</h3>
              <p>
                El catálogo pudo cambiar desde tu última visita. Vuelve a la primera página para revisar los resultados actuales.
              </p>
              <ButtonLink
                variant="secondary"
                to={catalogHref({ ...criteria, page: 0 })}
              >
                Ir a la primera página
              </ButtonLink>
            </div>
          ) : activePage ? (
            <EmptyCatalogState
              criteria={criteria}
              categoryName={categories.find((category) => category.slug === criteria.category)?.name}
              onRetry={() => void editionsQuery.refetch()}
            />
          ) : null}
        </section>
      </main>

      <SiteFooter />
    </>
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
    <div className="empty-state">
      <div className="empty-rule" aria-hidden="true" />
      <h3>{title}</h3>
      <p>
        {!filtered
          ? "Vuelve a consultar el catálogo para ver las ediciones disponibles."
          : "Puedes cambiar los filtros o volver a explorar todo el catálogo."}
      </p>
      {!filtered ? (
        <Button variant="secondary" type="button" onClick={onRetry}>
          Actualizar catálogo
        </Button>
      ) : (
        <div className="empty-actions">
          {hasActiveFilters(criteria) && (
            <ButtonLink
              variant="secondary"
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
            </ButtonLink>
          )}
          {criteria.query && (
            <Link
              className="text-link"
              to={catalogHref({ ...criteria, query: "", scope: "title", page: 0 })}
            >
              Limpiar búsqueda
            </Link>
          )}
        </div>
      )}
    </div>
  );
}

function EditionLoadingState() {
  return (
    <div className="loading-state" aria-hidden="true">
      {Array.from({ length: 8 }, (_, index) => (
        <div className="loading-edition" key={index}>
          <div className="loading-cover" />
          <div className="loading-line loading-line-long" />
          <div className="loading-line" />
          <div className="loading-line loading-line-short" />
        </div>
      ))}
    </div>
  );
}
