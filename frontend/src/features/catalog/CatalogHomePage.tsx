import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@mantine/core";
import { CategoryDirectory } from "./CategoryDirectory";
import classes from "./exploration.module.css";
import { describeApiError } from "@/shared/api/errors";
import { getPublicCategories, searchPublicEditions } from "@/shared/api/catalog";
import { SiteFooter } from "@/shared/ui/SiteFooter";
import { HomeDiscoveryRail } from "./HomeDiscoveryRail";
import { EditionLoadingGrid } from "./EditionLoadingGrid";
import { readCatalogCriteria } from "./catalogUrl";
import { useDelayedPending } from "@/shared/hooks/useDelayedPending";
import { useCatalogReturnScrollRestoration } from "./catalogScrollRestoration";

const discoveryCriteria = { ...readCatalogCriteria(""), page: 0, pageSize: 8 };
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
  const editions = discoveryQuery.data;
  const discoveryEditions = editions?.items.slice(0, discoveryCriteria.pageSize) ?? [];
  useCatalogReturnScrollRestoration(!discoveryQuery.isFetching && !categoriesQuery.isFetching);
  const showDiscoveryPending = useDelayedPending(discoveryQuery.isPending);

  return (
    <div className={classes.surface}>

      <main id="contenido-principal" tabIndex={-1} className={classes.home}>
        <div className={classes.shell}>
        <section className={classes.intro} aria-labelledby="page-title">
          <div>
            <h1 id="page-title">Una lectura empieza por una pista.</h1>
            <p>Abre un libro y descubre a dónde te lleva.</p>
          </div>
        </section>

        <section
          className={classes.shelf}
          aria-labelledby="discovery-heading"
          aria-busy={discoveryQuery.isPending}
        >
          <p className="visually-hidden" role="status" aria-live="polite" aria-atomic="true">
            {discoveryQuery.isPending
              ? "Cargando ediciones…"
              : editions
                ? `${numberFormat.format(discoveryEditions.length)} ediciones cargadas.`
                : ""}
          </p>

          {discoveryQuery.isPending ? (
            <>
              <p className={classes.note} hidden={!showDiscoveryPending}>Cargando ediciones…</p>
              <h2 id="discovery-heading" className={classes.sectionTitle}>Ediciones para descubrir</h2>
              <EditionLoadingGrid count={6} />
            </>
          ) : discoveryError && !editions ? (
            <div className={classes.notice} role="alert">
              <h2 id="discovery-heading" className={classes.sectionTitle}>Ediciones para descubrir</h2>
              <p className={classes.noticeTitle}>{discoveryError.title}</p>
              <p>{discoveryError.detail}</p>
              <Button variant="light" type="button" onClick={() => void discoveryQuery.refetch()}>
                Volver a intentar
              </Button>
            </div>
          ) : editions && editions.items.length > 0 ? (
            <>
              {discoveryError && (
                <p className={classes.notice} role="alert">
                  No se pudieron actualizar estas ediciones. Mostramos los datos anteriores; el precio y la disponibilidad pueden haber cambiado.
                  {" "}
                  <Button variant="subtle" type="button" onClick={() => void discoveryQuery.refetch()}>
                    Volver a intentar
                  </Button>
                </p>
              )}
              <HomeDiscoveryRail editions={discoveryEditions} criteria={discoveryCriteria} />
            </>
          ) : (
            <div className={classes.empty}>
              <h2 id="discovery-heading" className={classes.sectionTitle}>Ediciones para descubrir</h2>

              <h3>Aún no hay ediciones publicadas.</h3>
              <p>Vuelve a consultar el catálogo para revisar las ediciones disponibles.</p>
              <Button variant="light" type="button" onClick={() => void discoveryQuery.refetch()}>
                Actualizar catálogo
              </Button>
            </div>
          )}
        </section>

        <CategoryDirectory home categories={categoriesQuery.data?.items ?? []} criteria={readCatalogCriteria("")} loading={categoriesQuery.isPending} error={categoriesQuery.isError ? "error" : ""} />
        </div>
      </main>

      <SiteFooter />
    </div>
  );
}
