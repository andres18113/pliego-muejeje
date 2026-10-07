import { Combobox, useCombobox } from "@mantine/core";
import type { HTMLAttributes } from "react";
import { MaterialSymbol } from "@/shared/ui/MaterialSymbol";
import field from "./CountryPicker.module.css";
import classes from "./QuantityPicker.module.css";

type DataAttributes = { [key: `data-${string}`]: string | number | undefined };

/**
 * PLIEGO's short single choice: the country picker's field-shaped trigger and floating paper list,
 * without search. The trigger keeps focus while the list is open (↓/↑ move, Enter chooses, Escape
 * closes); the chosen option reads ultramar with a check. The caller owns the options and the value.
 */
export function ChoicePicker<T extends string>({ label, caption, value, options, onChange, busy = false, describedBy, className, align = "start", appearance = "default", triggerProps, panelProps }: {
  /** Accessible name of the control and of its list. */
  label: string;
  /** Muted words before the value inside the trigger, e.g. "Cant." or "Ordenar por". */
  caption?: string;
  value: T;
  options: { value: T; label: string }[];
  onChange: (value: T) => void;
  /** A change is in flight: the trigger stays focusable but does not open. */
  busy?: boolean;
  describedBy?: string;
  className?: string;
  /** Which trigger edge the list lines up with; at a line's end the list opens toward the content. The list is as wide as its longest option. */
  align?: "start" | "end";
  /** "quiet": a borderless, transparent trigger (caption, value, chevron) and a white list with a faint neutral hover; the choice is marked only by ultramar text and a check (commerce toolbars). */
  appearance?: "default" | "quiet";
  triggerProps?: DataAttributes;
  panelProps?: HTMLAttributes<HTMLDivElement> & DataAttributes;
}) {
  const combobox = useCombobox({
    onDropdownClose: () => combobox.resetSelectedOption(),
    onDropdownOpen: () => combobox.selectActiveOption(),
  });
  const current = options.find((option) => option.value === value);

  return (
    <Combobox
      store={combobox}
      position={`bottom-${align}`}
      width="max-content"
      offset={6}
      withinPortal
      zIndex={300}
      hideDetached={false}
      middlewares={{ flip: true, shift: { padding: 12 } }}
      transitionProps={{ duration: 0 }}
      classNames={{ dropdown: classes.panel, options: classes.list, option: classes.option }}
      onOptionSubmit={(next) => {
        combobox.closeDropdown();
        if (next !== value) onChange(next as T);
      }}
    >
      <Combobox.Target targetType="button" withExpandedAttribute>
        <button
          type="button"
          role="combobox"
          className={[field.trigger, classes.trigger, className].filter(Boolean).join(" ")}
          aria-label={label}
          aria-describedby={describedBy}
          aria-disabled={busy || undefined}
          data-open={combobox.dropdownOpened || undefined}
          data-appearance={appearance === "quiet" ? "quiet" : undefined}
          {...triggerProps}
          onClick={() => { if (busy) combobox.closeDropdown(); else combobox.toggleDropdown(); }}
          onKeyDown={(event) => { if (busy && event.key !== "Tab") event.preventDefault(); }}
        >
          {caption && <span className={classes.caption}>{caption}</span>}
          <span className={classes.value}>{current?.label ?? value}</span>
          <MaterialSymbol name="expand_more" aria-hidden="true" size={20} className={field.chevron} />
        </button>
      </Combobox.Target>
      <Combobox.Dropdown data-appearance={appearance === "quiet" ? "quiet" : undefined} {...panelProps}>
        <Combobox.Options aria-label={label}>
          {options.map((option) => (
            <Combobox.Option key={option.value} value={option.value} active={option.value === value} aria-selected={option.value === value}>
              <span>{option.label}</span>
              <MaterialSymbol name="check" aria-hidden="true" size={18} className={classes.check} />
            </Combobox.Option>
          ))}
        </Combobox.Options>
      </Combobox.Dropdown>
    </Combobox>
  );
}
