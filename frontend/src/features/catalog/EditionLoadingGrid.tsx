import { Skeleton } from "@mantine/core";
import { useDelayedPending } from "@/shared/hooks/useDelayedPending";
import layout from "./catalogLayout.module.css";
import card from "./BookCard.module.css";
import type { CatalogMedia } from "./catalogMedia";

/** Mirrors BookCard's rows (shelf, identity, price, stock, actions) so results replace it without a jump. */
export function EditionLoadingGrid({ count, presentation = "catalog", media = "physical" }: { count: number; presentation?: "catalog" | "offers"; media?: CatalogMedia }) {
  const commerce = presentation === "catalog";
  const showSkeleton = useDelayedPending(true);
  return <div className={`${layout.grid} ${layout.storeGrid}${commerce ? ` ${layout.commerceGrid}` : ` ${layout.offerGrid}`}`} data-presentation="catalog" style={{ visibility: showSkeleton ? "visible" : "hidden" }} aria-hidden="true">
    {Array.from({ length: count }, (_, index) => <div key={index} className={layout.item}><div className={card.card} data-media={commerce ? media : undefined}>
      {commerce ? <div className={card.shelf}><Skeleton className={card.loadingShelf} h="auto" animate={false} /></div> : <Skeleton className={card.loadingShelf} h="auto" animate={false} />}
      <div className={card.identity}>
        <Skeleton h="1.3em" w="85%" mb={8} animate={false} />
        <Skeleton h="1.1em" w="55%" animate={false} />
      </div>
      <div className={card.commercial}>
        <Skeleton className={card.price} h="1.3em" w={72} animate={false} />
        <Skeleton className={card.availability} h="1em" w={88} animate={false} />
        {commerce ? <div className={card.actionLine} /> : <div className={card.actionLine}><div className={card.actions}><Skeleton className={card.loadingActions} style={{ flex: 1 }} animate={false} /><Skeleton className={card.loadingActions} w={44} animate={false} /></div></div>}
      </div>
      <div />
    </div></div>)}
  </div>;
}
