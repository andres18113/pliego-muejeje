import type { HTMLAttributes } from "react";
import { MaterialSymbol } from "@/shared/ui/MaterialSymbol";
import classes from "./OfferChips.module.css";

type ChipProps = Omit<HTMLAttributes<HTMLParagraphElement>, "children"> & { [key: `data-${string}`]: string | boolean | undefined };

/** The saving as one pale-green chip with Material `sell` (Ofertas cards and the edition page). The amount is the API's. */
export function SavingsChip({ amountLabel, className, ...rest }: ChipProps & { amountLabel: string }) {
  return <p {...rest} className={[classes.chip, classes.saving, className].filter(Boolean).join(" ")}><MaterialSymbol name="sell" size={16} aria-hidden="true" /><span>Ahorras {amountLabel}</span></p>;
}

/** The days left as one pale-red chip; callers render it only when `offerUrgencyLabel` returns a label. */
export function UrgencyChip({ label, className, ...rest }: ChipProps & { label: string }) {
  return <p {...rest} className={[classes.chip, classes.urgency, className].filter(Boolean).join(" ")}>{label}</p>;
}
