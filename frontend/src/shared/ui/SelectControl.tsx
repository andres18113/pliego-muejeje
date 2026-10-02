import { MaterialSymbol } from "@/shared/ui/MaterialSymbol";
import { Select } from "@base-ui/react/select";
import type { FocusEventHandler, Ref } from "react";
import { cn } from "@/lib/utils";

export interface SelectControlOption {
  value: string;
  label: string;
  disabled?: boolean;
}

interface SelectControlProps {
  id: string;
  value: string;
  options: readonly SelectControlOption[];
  onValueChange: (value: string) => void;
  name?: string;
  disabled?: boolean;
  invalid?: boolean;
  describedBy?: string;
  onBlur?: FocusEventHandler<HTMLButtonElement>;
  inputRef?: Ref<HTMLInputElement>;
  className?: string;
}

export function SelectControl({
  id,
  value,
  options,
  onValueChange,
  name,
  disabled = false,
  invalid = false,
  describedBy,
  onBlur,
  inputRef,
  className,
}: SelectControlProps) {
  return (
    <Select.Root
      name={name}
      value={value}
      items={options}
      inputRef={inputRef}
      onValueChange={(nextValue) => onValueChange(nextValue ?? "")}
      itemToStringLabel={(selectedValue) => options.find((option) => option.value === selectedValue)?.label ?? selectedValue}
    >
      <Select.Trigger
        id={id}
        className={cn("pliego-select-trigger", className)}
        disabled={disabled}
        aria-invalid={invalid || undefined}
        aria-describedby={describedBy}
        onBlur={onBlur}
      >
        <Select.Value>
          {(selectedValue: string | null) => options.find((option) => option.value === selectedValue)?.label ?? ""}
        </Select.Value>
        <MaterialSymbol name="expand_more" className="pliego-select-chevron" aria-hidden="true" size={21} />
      </Select.Trigger>
      <Select.Portal>
        <Select.Positioner
          className="pliego-dropdown-positioner"
          side="bottom"
          align="start"
          sideOffset={5}
          alignItemWithTrigger={false}
          collisionAvoidance={{ side: "flip", align: "shift", fallbackAxisSide: "none" }}
        >
          <Select.Popup className="pliego-dropdown-popup pliego-select-popup">
            <Select.List className="pliego-select-list">
              {options.map((option) => (
                <Select.Item
                  key={option.value}
                  value={option.value}
                  disabled={option.disabled}
                  className="pliego-select-option"
                >
                  <Select.ItemText>{option.label}</Select.ItemText>
                  <Select.ItemIndicator className="pliego-select-check">
                    <MaterialSymbol name="check" aria-hidden="true" size={16} />
                  </Select.ItemIndicator>
                </Select.Item>
              ))}
            </Select.List>
          </Select.Popup>
        </Select.Positioner>
      </Select.Portal>
    </Select.Root>
  );
}
