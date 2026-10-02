import { useId, useState } from "react";
import { Button, Text } from "@mantine/core";
import type { QueryKey } from "@tanstack/react-query";
import { MaterialSymbol } from "@/shared/ui/MaterialSymbol";
import { useFavoriteControl } from "./useBookCardActions";
import { favoriteActionLabel, type BookCardFeedback } from "./bookCardModel";

/** Detail-page presentation; the same controller powers the BookCard action. */
export function FavoriteButton({ editionId, title, isFavorite, ready, queryKey, returnHref, className }: {
  editionId: string; title: string; isFavorite: boolean; ready: boolean; queryKey: QueryKey; returnHref: string; className?: string;
}) {
  const uid = useId();
  const [feedback, setFeedback] = useState<BookCardFeedback | null>(null);
  const control = useFavoriteControl({ editionId, isFavorite, ready, queryKey, returnHref, onFeedback: setFeedback });
  const selected = "selected" in control ? control.selected : undefined;
  const label = favoriteActionLabel(control);
  return <>
    <Button className={className} radius="sm" variant={selected ? "light" : "default"} color="pliego" type="button"
      aria-label={`${label}: ${title}`} aria-pressed={selected} aria-busy={control.state === "pending" || undefined}
      disabled={control.state !== "ready"} onClick={"onPress" in control ? control.onPress : undefined}
      aria-describedby={feedback || "reason" in control ? uid : undefined}
      leftSection={<MaterialSymbol name={selected ? "favorite" : "favorite_border"} fill={selected} size={20} />}>
      {label}
    </Button>
    {(feedback || "reason" in control) && <Text id={uid} size="xs" c="var(--pliego-text-muted)" role={feedback ? feedback.kind === "error" ? "alert" : "status" : undefined}>
      {feedback?.message ?? ("reason" in control ? control.reason : "")}
    </Text>}
  </>;
}
