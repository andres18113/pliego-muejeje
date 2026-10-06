import { ChoicePicker } from "./ChoicePicker";

/**
 * PLIEGO's quantity choice: the shared choice picker (the country picker's trigger and floating paper list,
 * without search — a quantity list is short). The caller decides which quantities are offered and validates
 * the choice; the picker only reports it.
 */
export function QuantityPicker({ label, value, choices, onChange, busy = false, describedBy, visibleLabel = "Cant." }: {
  /** Accessible name, e.g. "Cantidad de Cien años de soledad". */
  label: string;
  value: number;
  choices: number[];
  onChange: (quantity: number) => void;
  /** A change is in flight: the trigger stays focusable but does not open. */
  busy?: boolean;
  describedBy?: string;
  visibleLabel?: string;
}) {
  return (
    <ChoicePicker
      label={label}
      caption={visibleLabel}
      value={String(value)}
      options={choices.map((choice) => ({ value: String(choice), label: String(choice) }))}
      onChange={(next) => onChange(Number(next))}
      busy={busy}
      describedBy={describedBy}
      triggerProps={{ "data-quantity": value }}
      panelProps={{ "data-quantity-panel": "" }}
    />
  );
}
