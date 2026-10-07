import { useMemo, type MouseEventHandler } from "react";
import { useLocation } from "react-router-dom";
import { useSession } from "@/app/session";
import { useFavoriteSessionFailure, useFavoriteStatuses } from "@/features/favorites/favoriteStatus";
import { favoriteStatusQueryKey } from "@/shared/api/favorites";
import type { EditionSummary } from "@/shared/api/catalog";
import { catalogHref, type CatalogCriteria } from "./catalogUrl";
import { rememberCatalogReturnPosition } from "./catalogScrollRestoration";
import { CatalogBookCard } from "./CatalogBookCard";
import { OfferCard } from "./OfferCard";
import { mediaOfFormat } from "./catalogMedia";
import layout from "./catalogLayout.module.css";

interface EditionGridProps {
  editions: EditionSummary[];
  criteria: CatalogCriteria;
  detailReturnHref?: string;
  /**
   * The catalog is PLIEGO's commerce shelf: browse cards (covers on their medium's stage, favorite on
   * the stage, no cart action — buying happens on the edition page) in three wide columns beside the
   * filters on desktop. Offers use their own white merchandising card (`OfferCard`): jacket, urgency
   * when the server says it ends soon, price with the saving, and the offer's conditions on request.
   */
  presentation?: "catalog" | "offers";
}

export function EditionGrid({ editions, criteria, detailReturnHref, presentation = "catalog" }: EditionGridProps) {
  const location = useLocation();
  const { session, clear } = useSession();
  const customerId = session?.user.role === "CUSTOMER" ? session.user.userId : null;
  const editionIds = useMemo(() => editions.map((edition) => edition.editionId), [editions]);
  const favoritesQuery = useFavoriteStatuses(editionIds, customerId);
  useFavoriteSessionFailure(favoritesQuery.error, clear);
  const sourceHref = `${location.pathname}${location.search}${location.hash}`;
  const commerce = presentation === "catalog";

  return (
    <>
      {favoritesQuery.isError && customerId && <p className="edition-favorites-read-error" role="status">No pudimos consultar cuáles están guardados. Vuelve a cargar la página para comprobarlo.</p>}
      <ul className={`edition-grid ${layout.grid} ${layout.storeGrid}${commerce ? ` ${layout.commerceGrid}` : ` ${layout.offerGrid}`}`} data-presentation="catalog">
      {editions.map((edition) => {
        const detailHref = `/catalog/editions/${encodeURIComponent(edition.editionId)}?from=${encodeURIComponent(detailReturnHref ?? catalogHref(criteria))}`;
        const onOpen: MouseEventHandler<HTMLAnchorElement> = (event) => {
          if (event.defaultPrevented || event.button !== 0
              || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
          rememberCatalogReturnPosition({ locationKey: location.key, href: sourceHref, scrollY: window.scrollY });
        };
        const shared = {
          edition, detailHref, returnHref: sourceHref, onOpen,
          isFavorite: favoritesQuery.statusByEdition.get(edition.editionId) ?? false,
          favoriteReady: !customerId || Boolean(favoritesQuery.data),
          favoriteQueryKey: favoriteStatusQueryKey(customerId ?? "guest", favoritesQuery.stableIds),
        };
        return <li className={`edition-item ${layout.item}`} key={edition.editionId}>
          {commerce ? <CatalogBookCard {...shared} catalogReturn media={mediaOfFormat(edition.format)} /> : <OfferCard {...shared} />}
        </li>;
      })}
      </ul>
    </>
  );
}
