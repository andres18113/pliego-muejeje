import { useMemo } from "react";
import { useLocation } from "react-router-dom";
import { useSession } from "@/app/session";
import { useFavoriteSessionFailure, useFavoriteStatuses } from "@/features/favorites/favoriteStatus";
import { favoriteStatusQueryKey } from "@/shared/api/favorites";
import type { EditionSummary } from "@/shared/api/catalog";
import { catalogHref, type CatalogCriteria } from "./catalogUrl";
import { rememberCatalogReturnPosition } from "./catalogScrollRestoration";
import { CatalogBookCard } from "./CatalogBookCard";
import layout from "./catalogLayout.module.css";

interface EditionGridProps {
  editions: EditionSummary[];
  criteria: CatalogCriteria;
}

export function EditionGrid({ editions, criteria }: EditionGridProps) {
  const location = useLocation();
  const { session, clear } = useSession();
  const customerId = session?.user.role === "CUSTOMER" ? session.user.userId : null;
  const editionIds = useMemo(() => editions.map((edition) => edition.editionId), [editions]);
  const favoritesQuery = useFavoriteStatuses(editionIds, customerId);
  useFavoriteSessionFailure(favoritesQuery.error, clear);
  const sourceHref = `${location.pathname}${location.search}${location.hash}`;

  return (
    <>
      {favoritesQuery.isError && customerId && <p className="edition-favorites-read-error" role="status">No pudimos consultar cuáles están guardados. Vuelve a cargar la página para comprobarlo.</p>}
      <ul className={`edition-grid ${layout.grid} ${layout.storeGrid}`} data-presentation="catalog">
      {editions.map((edition) => (
        <li className={`edition-item ${layout.item}`} key={edition.editionId}><CatalogBookCard
          edition={edition}
          detailHref={`/catalog/editions/${encodeURIComponent(edition.editionId)}?from=${encodeURIComponent(catalogHref(criteria))}`}
          returnHref={sourceHref}
          isFavorite={favoritesQuery.statusByEdition.get(edition.editionId) ?? false}
          favoriteReady={!customerId || Boolean(favoritesQuery.data)}
          favoriteQueryKey={favoriteStatusQueryKey(customerId ?? "guest", favoritesQuery.stableIds)}
          catalogReturn
          onOpen={(event) => {
            if (event.defaultPrevented || event.button !== 0
                || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
            rememberCatalogReturnPosition({ locationKey: location.key, href: sourceHref, scrollY: window.scrollY });
          }}
        /></li>
      ))}
      </ul>
    </>
  );
}
