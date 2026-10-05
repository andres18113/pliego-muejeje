import { Combobox, useCombobox } from "@mantine/core";
import { MaterialSymbol } from "@/shared/ui/MaterialSymbol";
import field from "./CountryPicker.module.css";
import classes from "./QuantityPicker.module.css";

/**
 * PLIEGO's quantity choice: the same field-shaped trigger and floating paper list as the country and phone
 * pickers, without their search — a quantity list is short. The trigger keeps focus while the list is open
 * (↓/↑ move, Enter chooses, Escape closes); the chosen quantity reads ultramar with a check. The caller
 * decides which quantities are offered and validates the choice; the picker only reports it.
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
  const combobox = useCombobox({
    onDropdownClose: () => combobox.resetSelectedOption(),
    onDropdownOpen: () => combobox.selectActiveOption(),
  });

  return (
    <Combobox
      store={combobox}
      position="bottom-start"
      offset={6}
      withinPortal
      zIndex={300}
      hideDetached={false}
      middlewares={{ flip: true, shift: { padding: 12 } }}
      transitionProps={{ duration: 0 }}
      classNames={{ dropdown: classes.panel, options: classes.list, option: classes.option }}
      onOptionSubmit={(next) => {
        combobox.closeDropdown();
        if (Number(next) !== value) onChange(Number(next));
      }}
    >
      <Combobox.Target targetType="button">
        <button
          type="button"
          role="combobox"
          className={`${field.trigger} ${classes.trigger}`}
          aria-label={label}
          aria-describedby={describedBy}
          aria-disabled={busy || undefined}
          data-open={combobox.dropdownOpened || undefined}
          data-quantity={value}
          onClick={() => { if (busy) combobox.closeDropdown(); else combobox.toggleDropdown(); }}
          onKeyDown={(event) => { if (busy && event.key !== "Tab") event.preventDefault(); }}
        >
          <span className={classes.caption}>{visibleLabel}</span>
          <span className={classes.value}>{value}</span>
          <MaterialSymbol name="expand_more" aria-hidden="true" size={20} className={field.chevron} />
        </button>
      </Combobox.Target>
      <Combobox.Dropdown data-quantity-panel="">
        <Combobox.Options aria-label={label}>
          {choices.map((choice) => (
            <Combobox.Option key={choice} value={String(choice)} active={choice === value} aria-selected={choice === value}>
              <span>{choice}</span>
              <MaterialSymbol name="check" aria-hidden="true" size={18} className={classes.check} />
            </Combobox.Option>
          ))}
        </Combobox.Options>
      </Combobox.Dropdown>
    </Combobox>
  );
}
