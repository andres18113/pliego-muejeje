import type { QueryClient } from "@tanstack/react-query";
import { readCatalogCriteria } from "@/features/catalog/catalogUrl";
import { isEditionId, publicCategoriesQuery, publicEditionQuery, publicEditionsQuery, publicFilterOptionsQuery } from "@/features/catalog/publicCatalogQueries";
import { helpArticleQuery, helpCategoriesQuery } from "@/features/help/helpQuery";
import { prefetchStorefrontNavigation } from "@/features/storefront/storefrontQuery";
import { offerClockSettled } from "./realtime/offerRefresh";

/** Pages that never show the storefront header (their own focused header, or the admin area). */
const withoutStorefrontHeader = /^\/(cart|checkout|admin)(\/|$)/;

/**
 * First load only: the public reads the opening page needs start as soon as they may, instead of after the route's
 * code and the session restore. Reads that carry prices (ADR 0058) wait until the server has answered the offer clock;
 * Help carries none and starts at once. They are the same for every visitor, so the page's own queries simply find
 * them in the cache; later in-app navigation is unchanged.
 */
export function prefetchInitialPublicReads(queryClient: QueryClient, { pathname, search }: Pick<Location, "pathname" | "search"> = window.location) {
  const path = pathname.length > 1 ? pathname.replace(/\/+$/, "") : pathname;
  return Promise.all([prefetchHelpReads(queryClient, path), prefetchPricedReads(queryClient, path, search)]);
}

/** A Help article and the topics its context line names: no prices, so no clock to wait for. */
function prefetchHelpReads(queryClient: QueryClient, path: string) {
  const article = /^\/ayuda\/([^/]+)$/.exec(path);
  if (!article) return Promise.resolve();
  let slug = "";
  try { slug = decodeURIComponent(article[1]); } catch { return Promise.resolve(); /* malformed: the page reports it */ }
  return Promise.all([queryClient.prefetchQuery(helpArticleQuery(slug)), queryClient.prefetchQuery(helpCategoriesQuery())]);
}

function prefetchPricedReads(queryClient: QueryClient, path: string, search: string) {
  return offerClockSettled().then(() => {
    const reads: Promise<unknown>[] = [];
    if (!withoutStorefrontHeader.test(path)) reads.push(prefetchStorefrontNavigation(queryClient));
    if (path === "/catalog") {
      const criteria = readCatalogCriteria(search);
      const scope = criteria.productType || "GLOBAL";
      reads.push(
        queryClient.prefetchQuery(publicEditionsQuery(criteria)),
        queryClient.prefetchQuery(publicCategoriesQuery(scope)),
        queryClient.prefetchQuery(publicFilterOptionsQuery(scope)),
      );
    }
    const edition = /^\/catalog\/editions\/([^/]+)$/.exec(path);
    if (edition) {
      let editionId = "";
      try { editionId = decodeURIComponent(edition[1]); } catch { /* malformed: the page reports it */ }
      if (isEditionId(editionId)) reads.push(queryClient.prefetchQuery(publicEditionQuery(editionId)));
    }
    return Promise.all(reads);
  });
}
