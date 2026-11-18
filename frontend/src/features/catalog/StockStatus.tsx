import { Text } from "@mantine/core";
import { MaterialSymbol } from "@/shared/ui/MaterialSymbol";
import { resolveStockStatus, type StockAvailability } from "./stockStatusModel";
import classes from "./StockStatus.module.css";

export interface StockStatusProps extends StockAvailability {
  size?: "compact" | "normal";
  variant?: "text" | "badge" | "quiet";
  id?: string;
  className?: string;
  /** Off where the surface states the reason itself (the edition page) or has room only for the state's name (cards, rows). */
  explained?: boolean;
}

export function StockStatus({ available, unavailabilityReason, size = "normal", variant = "text", id, className, explained = true }: StockStatusProps) {
  const status = resolveStockStatus({ available, unavailabilityReason });
  return <Text component="span" size={size === "compact" ? "xs" : "sm"} fw={400} id={id}
    className={[classes.root, className].filter(Boolean).join(" ")}
    data-stockstatus data-variant={variant} data-size={size} data-state={status.state} data-tone={status.tone}>
    <span className={classes.primary}>
      {variant === "quiet" ? <span className={classes.mark} data-stockstatus-mark aria-hidden="true" /> : <MaterialSymbol name={status.icon} size={size === "compact" ? 16 : 20} className={classes.icon} />}
      <span className={classes.label} data-stockstatus-label>{status.label}</span>
    </span>
    {explained && status.explanation && <>{" "}<span className={classes.explanation} data-stockstatus-explanation>{status.explanation}</span></>}
  </Text>;
}
