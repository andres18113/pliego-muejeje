import { useId, useState } from "react";
import { ActionIcon, Button, Text, Tooltip } from "@mantine/core";
import type { QueryKey } from "@tanstack/react-query";
import { MaterialSymbol } from "@/shared/ui/MaterialSymbol";
import { useFavoriteControl } from "./useBookCardActions";
import { favoriteActionLabel, type BookCardFeedback } from "./bookCardModel";

/**
 * Detail-page presentation; the same controller powers the BookCard action. "icon" is the catalog card's heart
 * (a 44px disc with its name in a tooltip) for the jacket's corner; "button" spells the action out.
 */
export function FavoriteButton({ editionId, title, isFavorite, ready, queryKey, returnHref, className, appearance = "button" }: {
  editionId: string; title: string; isFavorite: boolean; ready: boolean; queryKey: QueryKey; returnHref: string; className?: string;
  appearance?: "button" | "icon";
}) {
  const uid = useId();
  const [feedback, setFeedback] = useState<BookCardFeedback | null>(null);
  const control = useFavoriteControl({ editionId, isFavorite, ready, queryKey, returnHref, onFeedback: setFeedback });
  const selected = "selected" in control ? control.selected : undefined;
  const label = favoriteActionLabel(control);
  const common = {
    type: "button" as const, "aria-pressed": selected, "aria-busy": control.state === "pending" || undefined,
    disabled: !("onPress" in control) && control.state !== "pending", "aria-disabled": control.state === "pending" || undefined,
    onClick: "onPress" in control ? control.onPress : undefined, "aria-describedby": feedback || "reason" in control ? uid : undefined,
  };
  return <>
    {appearance === "icon" ? (
      <Tooltip label={label} events={{ hover: true, focus: true, touch: false }} position="left" withArrow>
        <ActionIcon className={className} size={44} radius="xl" variant="transparent" aria-label={`${label}: ${title}`} {...common}>
          <MaterialSymbol name={selected ? "favorite" : "favorite_border"} fill={selected} size={22} />
        </ActionIcon>
      </Tooltip>
    ) : <Button className={className} radius="sm" variant={selected ? "light" : "default"} color="pliego" aria-label={`${label}: ${title}`} {...common}
      leftSection={<MaterialSymbol name={selected ? "favorite" : "favorite_border"} fill={selected} size={20} />}>
      {label}
    </Button>}
    {(feedback || "reason" in control) && <Text id={uid} size="xs" c="var(--pliego-text-muted)" role={feedback ? feedback.kind === "error" ? "alert" : "status" : undefined}
      // The heart's fill already shows a confirmed save; only a problem or a reason needs words on screen.
      className={appearance === "icon" && feedback?.kind === "success" ? "visually-hidden" : undefined}>
      {feedback?.message ?? ("reason" in control ? control.reason : "")}
    </Text>}
  </>;
}
