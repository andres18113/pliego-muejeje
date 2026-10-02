import { MaterialSymbol } from "@/shared/ui/MaterialSymbol";
import { useRef } from "react";

export type TransactionButtonState = "idle" | "pending" | "success";

export function TransactionButtonLabel({
  state,
  idle,
  pending,
  success,
  reserve = idle,
}: {
  state: TransactionButtonState;
  idle: string;
  pending: string;
  success: string;
  reserve?: string;
}) {
  const label = state === "pending" ? pending : state === "success" ? success : idle;
  const initialState = useRef(state);

  return (
    <span className="transaction-button-label">
      <span className="transaction-button-label-sizer" aria-hidden="true">{reserve}</span>
      <span
        key={state}
        className="transaction-button-label-current"
        data-animate={initialState.current === state ? undefined : "true"}
      >
        {state === "success" && <MaterialSymbol name="check" aria-hidden="true" size={16} />}
        {label}
      </span>
    </span>
  );
}
