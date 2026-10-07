import { Skeleton } from "@mantine/core";
import { useDelayedPending } from "@/shared/hooks/useDelayedPending";
import layout from "./catalogLayout.module.css";
import card from "./BookCard.module.css";
import offer from "./OfferCard.module.css";
import type { CatalogMedia } from "./catalogMedia";

/** Mirrors BookCard's rows (shelf, identity, price, stock, actions) — or OfferCard's on Ofertas — so results replace it without a jump. */
export function EditionLoadingGrid({ count, presentation = "catalog", media = "physical" }: { count: number; presentation?: "catalog" | "offers"; media?: CatalogMedia }) {
  const commerce = presentation === "catalog";
  const showSkeleton = useDelayedPending(true);
  return <div className={`${layout.grid} ${layout.storeGrid}${commerce ? ` ${layout.commerceGrid}` : ` ${layout.offerGrid}`}`} data-presentation="catalog" style={{ visibility: showSkeleton ? "visible" : "hidden" }} aria-hidden="true">
    {Array.from({ length: count }, (_, index) => <div key={index} className={layout.item}>{commerce ? <div className={card.card} data-media={media}>
      <div className={card.shelf}><Skeleton className={card.loadingShelf} h="auto" animate={false} /></div>
      <div className={card.identity}>
        <Skeleton h="1.3em" w="85%" mb={8} animate={false} />
        <Skeleton h="1.1em" w="55%" animate={false} />
      </div>
      <div className={card.commercial}>
        <Skeleton className={card.price} h="1.3em" w={72} animate={false} />
        <Skeleton className={card.availability} h="1em" w={88} animate={false} />
        <div className={card.actionLine} />
      </div>
      <div />
    </div> : <div className={offer.card}>
      <Skeleton className={offer.stage} h="auto" animate={false} />
      <div className={offer.identity}>
        <Skeleton h="1.2em" w="85%" mb={8} animate={false} />
        <Skeleton h="1em" w="55%" animate={false} />
      </div>
      <div className={offer.pricing}><Skeleton h="1.3em" w={150} animate={false} /></div>
      <div className={offer.more}><Skeleton h="1em" w={110} mt={8} animate={false} /></div>
      <div />
    </div>}</div>)}
  </div>;
}
