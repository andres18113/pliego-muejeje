import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { Button, ButtonLink } from "@/components/ui/button";
import { describeApiError } from "@/shared/api/errors";
import { getPublicCategories, searchPublicEditions } from "@/shared/api/catalog";
import { SiteFooter } from "@/shared/ui/SiteFooter";
import { CatalogHeader } from "./CatalogHeader";
import { CategoryNavigation } from "./CategoryNavigation";
import { EditionGrid } from "./EditionGrid";
import { readCatalogCriteria } from "./catalogUrl";

const discoveryCriteria = { ...readCatalogCriteria(""), page: 0, pageSize: 4 };
const numberFormat = new Intl.NumberFormat("es-EC");

export function CatalogHomePage() {
  const categoriesQuery = useQuery({
    queryKey: ["public-catalog", "categories"],
    queryFn: ({ signal }) => getPublicCategories(signal),
    staleTime: 60_000,
  });
  const discoveryQuery = useQuery({
    queryKey: ["public-catalog", "discovery-editions", discoveryCriteria],
    queryFn: ({ signal }) => searchPublicEditions(discoveryCriteria, signal),
    staleTime: 20_000,
  });

  useEffect(() => {
    document.title = "Descubre el catálogo · PLIEGO";
  }, []);

  const discoveryError = discoveryQuery.error
    ? describeApiError(discoveryQuery.error, "No pudimos cargar las ediciones", "Revisa tu conexión e inténtalo otra vez.")
    : undefined;
  const categoriesError = categoriesQuery.error
    ? describeApiError(categoriesQuery.error, "No pudimos actualizar las categorías", "Revisa tu conexión e inténtalo otra vez.")
    : undefined;
  const editions = discoveryQuery.data;

  return (
    <>
      <CatalogHeader criteria={readCatalogCriteria("")} />

      <main id="contenido-principal" tabIndex={-1}>
        <section className="discovery-lead page-frame" aria-labelledby="page-title">
          <div className="lead-copy">
            <h1 id="page-title">
              Una lectura empieza <span>por una{"\u00a0"}pista.</span>
            </h1>
            <p>Abre un libro y descubre a dónde te lleva.</p>
          </div>
        </section>

        <section
          className="discovery-shelf page-frame"
          aria-labelledby="discovery-heading"
          aria-busy={discoveryQuery.isFetching}
        >
          <p className="visually-hidden" role="status" aria-live="polite" aria-atomic="true">
            {discoveryQuery.isPending
              ? "Cargando ediciones…"
              : editions
                ? `${numberFormat.format(editions.items.length)} ediciones cargadas.`
                : ""}
          </p>
          <div className="discovery-heading-row">
            <h2 id="discovery-heading">Ediciones para descubrir</h2>
            <ButtonLink variant="secondary" to="/catalog">
              Explorar catálogo completo
            </ButtonLink>
          </div>

          {discoveryQuery.isPending ? (
            <p className="discovery-message">
              Cargando ediciones…
            </p>
          ) : discoveryError && !editions ? (
            <div className="catalog-error discovery-error" role="alert">
              <p className="error-title">{discoveryError.title}</p>
              <p>{discoveryError.detail}</p>
              <Button variant="secondary" type="button" onClick={() => void discoveryQuery.refetch()}>
                Volver a intentar
              </Button>
            </div>
          ) : editions && editions.items.length > 0 ? (
            <>
              {discoveryError && (
                <p className="stale-data-note" role="alert">
                  No se pudieron actualizar estas ediciones. Mostramos los datos anteriores; el precio y la disponibilidad pueden haber cambiado.
                  {" "}
                  <Button variant="text" type="button" onClick={() => void discoveryQuery.refetch()}>
                    Volver a intentar
                  </Button>
                </p>
              )}
              <p className="discovery-count">
                {editions.totalCountValue > BigInt(editions.items.length)
                  ? `Mostramos ${numberFormat.format(editions.items.length)} de ${numberFormat.format(editions.totalCountValue)} ediciones del catálogo.`
                  : `${numberFormat.format(editions.totalCountValue)} ${editions.totalCountValue === 1n ? "edición" : "ediciones"} del catálogo.`}
              </p>
              <EditionGrid editions={editions.items} criteria={discoveryCriteria} />
            </>
          ) : (
            <div className="empty-state discovery-empty">
              <div className="empty-rule" aria-hidden="true" />
              <h3>Aún no hay ediciones publicadas.</h3>
              <p>Vuelve a consultar el catálogo para revisar las ediciones disponibles.</p>
              <Button variant="secondary" type="button" onClick={() => void discoveryQuery.refetch()}>
                Actualizar catálogo
              </Button>
            </div>
          )}
        </section>

        <CategoryNavigation
          categories={categoriesQuery.data?.items || []}
          selectedSlug=""
          criteria={readCatalogCriteria("")}
          loading={categoriesQuery.isFetching}
          error={categoriesError ? `${categoriesError.title}. ${categoriesError.detail}` : ""}
          onRetry={() => void categoriesQuery.refetch()}
        />
      </main>

      <SiteFooter />
    </>
  );
}
