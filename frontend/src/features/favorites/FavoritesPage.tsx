import { stockReadOptions } from "@/features/catalog/stockStatusModel";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useLocation, useNavigate } from "react-router-dom";
import { Button, ButtonLink } from "@/components/ui/button";
import { useSession } from "@/app/session";
import { AccountShell } from "@/features/account/AccountShell";
import { MaterialSymbol } from "@/shared/ui/MaterialSymbol";
import { UndoToast, type UndoToastMessage } from "@/shared/ui/UndoToast";
import { FavoriteRow } from "./FavoriteRow";
import classes from "./favorites.module.css";
import { addCustomerFavorite, favoriteListQueryKey, favoriteStatusQueryKey, listCustomerFavorites, type FavoriteStatus } from "@/shared/api/favorites";
import { ApiRequestError } from "@/shared/api/errors";
import { CustomerOnly, PurchasePage } from "@/features/purchase/PurchaseChrome";
import { ReadFailure } from "@/features/purchase/CartPage";

const pageSize = 20;

export function FavoritesPage() {
  return <PurchasePage title="Favoritos"><CustomerOnly intent="/favorites" task="ver tus favoritos"><FavoritesContent /></CustomerOnly></PurchasePage>;
}

function FavoritesContent() {
  const collection = useRef<HTMLDivElement>(null);
  const focusedRow = useRef<{ node: HTMLElement; index: number } | null>(null);
  const location = useLocation();
  const navigate = useNavigate();
  const { session, clear } = useSession();
  const page = readFavoritesPage(location.search);
  const userId = session?.user.userId ?? "";
  const query = useQuery({
    queryKey: favoriteListQueryKey(userId, page, pageSize),
    ...stockReadOptions,
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

  // Removing is immediate; the toast is where it can be taken back. Only the latest removal is on offer.
  const queryClient = useQueryClient();
  const toastKey = useRef(0);
  const [toast, setToast] = useState<(Omit<UndoToastMessage, "action"> & { removed?: { editionId: string; title: string }; retry?: boolean }) | null>(null);
  const restore = useMutation({ mutationFn: (editionId: string) => addCustomerFavorite(editionId), retry: false });

  function offerUndo(removed: { editionId: string; title: string }) {
    setToast({ key: ++toastKey.current, message: "Quitado de favoritos", detail: removed.title, removed });
  }

  async function undoRemoval(removed: { editionId: string; title: string }) {
    if (restore.isPending) return;
    try {
      await restore.mutateAsync(removed.editionId);
    } catch (error) {
      if (error instanceof ApiRequestError && error.status === 401) { clear("expired"); return; }
      setToast({ key: ++toastKey.current, message: "No pudimos restaurarlo en favoritos", detail: removed.title, removed, retry: true });
      return;
    }
    queryClient.setQueriesData<FavoriteStatus[]>({ queryKey: ["customer-favorite-status", userId] }, old => old?.map(status => status.editionId === removed.editionId ? { ...status, favorite: true } : status));
    await queryClient.invalidateQueries({ queryKey: ["customer-favorites", userId] });
    setToast({ key: ++toastKey.current, message: "Restaurado en favoritos", detail: removed.title });
    // Focus follows the book back to its row; if it returned to another page, to the list's heading.
    requestAnimationFrame(() => {
      const target = collection.current?.querySelector<HTMLElement>(`[data-edition-id="${removed.editionId}"] [data-bookcard-favorite]`)
        ?? collection.current?.querySelector<HTMLElement>("#favorite-editions-heading, .favorites-empty h2");
      target?.focus({ preventScroll: true });
      target?.scrollIntoView?.({ block: "nearest" });
    });
  }

  useLayoutEffect(() => {
    const removed = focusedRow.current;
    if (!removed || removed.node.isConnected) return;
    focusedRow.current = null;
    if (document.activeElement !== document.body) return;
    const rows = collection.current?.querySelectorAll<HTMLElement>("[data-favorite-row]");
    const row = rows?.[Math.min(removed.index, rows.length - 1)];
    const target = row?.querySelector<HTMLElement>("[data-bookcard-favorite]") ?? collection.current?.querySelector<HTMLElement>(".favorites-empty h2");
    target?.focus({ preventScroll: true });
  }, [query.data]);

  const favoritePage = query.data;
  const currentHref = `${location.pathname}${location.search}`;
  const editions = favoritePage?.items ?? [];
  const totalPages = favoritePage ? Number((favoritePage.totalCountValue + BigInt(pageSize) - 1n) / BigInt(pageSize)) : 0;

  function goToPage(nextPage: number) {
    navigate(nextPage === 0 ? "/favorites" : `/favorites?page=${nextPage}`);
  }

  const countLabel = favoritePage ? `${new Intl.NumberFormat("es-EC").format(favoritePage.totalCountValue)} ${favoritePage.totalCountValue === 1n ? "edición guardada" : "ediciones guardadas"}` : null;
  return <AccountShell title="Favoritos" trail="Favoritos" intro="Las ediciones que guardaste para volver a ellas, con su precio y existencias de hoy.">
    <div ref={collection} onFocusCapture={event => {
      const row = (event.target as HTMLElement).closest<HTMLElement>("[data-favorite-row]");
      focusedRow.current = row ? { node: row, index: Array.from(collection.current!.querySelectorAll("[data-favorite-row]")).indexOf(row) } : null;
    }}>
    {query.isPending ? <p className="purchase-loading" role="status">Consultando tus favoritos…</p> : !favoritePage ? <ReadFailure title="No pudimos consultar tus favoritos." onRetry={() => void query.refetch()} retrying={query.isFetching} /> : <>
      {query.isError && <p className="stale-data-note" role="status">No pudimos actualizar tus favoritos. Se muestra la última consulta disponible. <Button variant="text" type="button" onClick={() => void query.refetch()}>Actualizar</Button></p>}
      {favoritePage.totalCountValue === 0n ? (
        <section className={`favorites-empty ${classes.collection} ${classes.empty}`} aria-labelledby="favorites-empty-heading">
          <span className={classes.emptyMark} aria-hidden="true"><MaterialSymbol name="favorite_border" size={28} /></span>
          <h2 id="favorites-empty-heading" tabIndex={-1}>Aún no guardaste favoritos.</h2>
          <p>En el catálogo, elige “Agregar a favoritos” en la tarjeta de una edición.</p>
          <ButtonLink variant="primary" to="/catalog">Explorar el catálogo</ButtonLink>
        </section>
      ) : editions.length === 0 ? (
        <section className={`favorites-empty ${classes.collection} ${classes.empty}`} aria-labelledby="favorites-page-empty-heading">
          <h2 id="favorites-page-empty-heading" tabIndex={-1}>No hay más ediciones en esta página.</h2>
          <p>Puede que hayas quitado el último favorito de esta página.</p>
          <Button variant="secondary" type="button" onClick={() => goToPage(Math.max(0, page - 1))}>Volver a la página anterior</Button>
        </section>
      ) : <section className={classes.collection} aria-labelledby="favorite-editions-heading">
        <header className={`favorites-summary ${classes.summary}`}>
          <h2 id="favorite-editions-heading" tabIndex={-1}>{countLabel}</h2>
          {totalPages > 1 && <p>Página {new Intl.NumberFormat("es-EC").format(page + 1)} de {new Intl.NumberFormat("es-EC").format(totalPages)}</p>}
        </header>
        <ul className={classes.list}>
          {editions.map((edition) => {
            const detailHref = `/catalog/editions/${encodeURIComponent(edition.editionId)}?from=${encodeURIComponent(currentHref)}`;
            return <li key={edition.editionId}><FavoriteRow
              edition={edition}
              detailHref={detailHref}
              returnHref={currentHref}
              queryKey={favoriteStatusQueryKey(userId, [edition.editionId])}
              onRemoved={() => offerUndo({ editionId: edition.editionId, title: edition.title })}
            /></li>;
          })}
        </ul>
        {totalPages > 1 && <nav className={`favorites-pagination ${classes.pagination}`} aria-label="Páginas de favoritos">
          <Button variant="secondary" type="button" disabled={page === 0 || query.isFetching} onClick={() => goToPage(page - 1)}>Anterior</Button>
          <Button variant="secondary" type="button" disabled={BigInt(page + 1) * BigInt(pageSize) >= favoritePage.totalCountValue || query.isFetching} onClick={() => goToPage(page + 1)}>Siguiente</Button>
        </nav>}
      </section>}
    </>}
    </div>
    <UndoToast onDismiss={() => setToast(null)} toast={toast && {
      key: toast.key, message: toast.message, detail: toast.detail,
      action: toast.removed && { label: toast.retry ? "Reintentar" : "Deshacer", busyLabel: "Restaurando…", busy: restore.isPending, onPress: () => void undoRemoval(toast.removed!) },
    }} />
  </AccountShell>;
}

function readFavoritesPage(search: string) {
  const raw = new URLSearchParams(search).get("page");
  if (!raw || !/^(0|[1-9][0-9]{0,7})$/.test(raw)) return 0;
  const value = Number(raw);
  return Number.isSafeInteger(value) && value <= 99_999_999 ? value : 0;
}
