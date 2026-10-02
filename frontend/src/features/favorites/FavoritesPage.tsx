import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { useLocation, useNavigate } from "react-router-dom";
import { Button, ButtonLink } from "@/components/ui/button";
import { useSession } from "@/app/session";
import { AccountNavigation } from "@/features/account/AccountNavigation";
import { CatalogBookCard } from "@/features/catalog/CatalogBookCard";
import layout from "@/features/catalog/catalogLayout.module.css";
import { favoriteListQueryKey, favoriteStatusQueryKey, listCustomerFavorites } from "@/shared/api/favorites";
import { ApiRequestError } from "@/shared/api/errors";
import { CustomerOnly, PurchasePage } from "@/features/purchase/PurchaseChrome";
import { ReadFailure } from "@/features/purchase/CartPage";

const pageSize = 20;

export function FavoritesPage() {
  return <PurchasePage title="Favoritos" contentClassName={layout.shell}><CustomerOnly intent="/favorites" task="ver tus favoritos"><FavoritesContent /></CustomerOnly></PurchasePage>;
}

function FavoritesContent() {
  const location = useLocation();
  const navigate = useNavigate();
  const { session, clear } = useSession();
  const page = readFavoritesPage(location.search);
  const userId = session?.user.userId ?? "";
  const query = useQuery({
    queryKey: favoriteListQueryKey(userId, page, pageSize),
    queryFn: ({ signal }) => listCustomerFavorites(page, pageSize, signal),
    meta: { authRequired: true },
    staleTime: 0,
    refetchOnMount: "always",
    retry: false,
  });

  useEffect(() => {
    if (query.error instanceof ApiRequestError && query.error.status === 401) clear("expired");
  }, [clear, query.error]);

  useEffect(() => {
    document.title = "Favoritos · PLIEGO";
  }, []);

  const favoritePage = query.data;
  const currentHref = `${location.pathname}${location.search}`;
  const editions = favoritePage?.items ?? [];

  function goToPage(nextPage: number) {
    navigate(nextPage === 0 ? "/favorites" : `/favorites?page=${nextPage}`);
  }

  return <div className="account-page favorites-page">
    <header className="purchase-heading">
      <h1>Favoritos</h1>
      <p>Guarda las ediciones que quieres volver a consultar.</p>
    </header>
    <AccountNavigation />
    {query.isPending ? <p className="purchase-loading" role="status">Consultando tus favoritos…</p> : !favoritePage ? <ReadFailure title="No pudimos consultar tus favoritos." onRetry={() => void query.refetch()} retrying={query.isFetching} /> : <>
      {query.isError && <p className="stale-data-note" role="status">No pudimos actualizar tus favoritos. Se muestra la última consulta disponible. <Button variant="text" type="button" onClick={() => void query.refetch()}>Actualizar</Button></p>}
      {favoritePage.totalCountValue === 0n ? (
        <section className="favorites-empty" aria-labelledby="favorites-empty-heading">
          <h2 id="favorites-empty-heading">Aún no guardaste favoritos.</h2>
          <p>En el catálogo, elige “Agregar a favoritos” en la tarjeta de una edición.</p>
          <ButtonLink variant="primary" to="/catalog">Explorar el catálogo</ButtonLink>
        </section>
      ) : editions.length === 0 ? (
        <section className="favorites-empty" aria-labelledby="favorites-page-empty-heading">
          <h2 id="favorites-page-empty-heading">No hay más ediciones en esta página.</h2>
          <p>Puede que hayas quitado el último favorito de esta página.</p>
          <Button variant="secondary" type="button" onClick={() => goToPage(Math.max(0, page - 1))}>Volver a la página anterior</Button>
        </section>
      ) : <>
        <div className="favorites-summary">
          <p><strong>{new Intl.NumberFormat("es-EC").format(favoritePage.totalCountValue)}</strong> {favoritePage.totalCountValue === 1n ? "edición guardada" : "ediciones guardadas"}</p>
          <p>Página {new Intl.NumberFormat("es-EC").format(page + 1)}</p>
        </div>
        <h2 className="visually-hidden" id="favorite-editions-heading">Ediciones guardadas</h2>
        <ul className={`edition-grid ${layout.grid}`} aria-labelledby="favorite-editions-heading">
          {editions.map((edition) => {
            const detailHref = `/catalog/editions/${encodeURIComponent(edition.editionId)}?from=${encodeURIComponent(currentHref)}`;
            return <li className={`edition-item ${layout.item}`} key={edition.editionId}><CatalogBookCard
              edition={edition}
              detailHref={detailHref}
              returnHref={currentHref}
              isFavorite
              favoriteReady
              favoriteQueryKey={favoriteStatusQueryKey(userId, [edition.editionId])}
            /></li>;
          })}
        </ul>
        <nav className="favorites-pagination" aria-label="Páginas de favoritos">
          <Button variant="secondary" type="button" disabled={page === 0 || query.isFetching} onClick={() => goToPage(page - 1)}>Anterior</Button>
          <span>Página {new Intl.NumberFormat("es-EC").format(page + 1)}</span>
          <Button variant="secondary" type="button" disabled={BigInt(page + 1) * BigInt(pageSize) >= favoritePage.totalCountValue || query.isFetching} onClick={() => goToPage(page + 1)}>Siguiente</Button>
        </nav>
      </>}
    </>}
  </div>;
}

function readFavoritesPage(search: string) {
  const raw = new URLSearchParams(search).get("page");
  if (!raw || !/^(0|[1-9][0-9]{0,7})$/.test(raw)) return 0;
  const value = Number(raw);
  return Number.isSafeInteger(value) && value <= 99_999_999 ? value : 0;
}
