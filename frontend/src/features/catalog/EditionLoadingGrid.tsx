import { Paper, Skeleton } from "@mantine/core";
import { useDelayedPending } from "@/shared/hooks/useDelayedPending";
import layout from "./catalogLayout.module.css";
import card from "./BookCard.module.css";

export function EditionLoadingGrid({ count, presentation = "catalog" }: { count: number; presentation?: "catalog" | "showcase" }) {
  const showSkeleton = useDelayedPending(true);
  return <div className={`${layout.grid}${presentation === "showcase" ? ` ${layout.showcase}` : ""}`} style={{ visibility: showSkeleton ? "visible" : "hidden" }} aria-hidden="true">
    {Array.from({ length: count }, (_, index) => <Paper key={index} radius="md" withBorder className={card.card} style={{ containerType: "inline-size" }}>
      <Skeleton className={card.cover} h="auto" style={{ aspectRatio: "2 / 3" }} animate={false} />
      <Skeleton h="calc(2 * var(--mantine-line-height-md))" mb="2xs" animate={false} />
      <Skeleton h="calc(2 * var(--mantine-line-height-sm))" mb="xs" animate={false} />
      <Skeleton h="var(--mantine-line-height-lg)" mb="xs" animate={false} />
      <Skeleton h="calc(var(--mantine-line-height-xs) + var(--mantine-spacing-2xs))" mb="xs" animate={false} />
      <Skeleton className={card.loadingActions} animate={false} />
    </Paper>)}
  </div>;
}
