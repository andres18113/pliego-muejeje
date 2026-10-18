import { useRef, type ComponentPropsWithRef } from "react";
import { personNameInputError } from "@/shared/validation/person";

type Props = ComponentPropsWithRef<"input"> & { onInputRejected?: (reason: string) => void };

/** Reject an invalid edit as a whole: never silently turn a pasted name into another name. */
export function PersonNameInput({ onInputRejected, onChange, onPaste, onFocus, onBeforeInput, maxLength = 120, ...props }: Props) {
  const accepted = useRef(String(props.value ?? props.defaultValue ?? ""));
  if (props.value !== undefined) accepted.current = String(props.value);
  // Native maxLength counts raw UTF-16, not the database's normalized code points.
  // Both typing and paste are bounded below without truncating a valid decomposed name.
  return <input {...props} onFocus={event => {
    // RHF may restore an uncontrolled draft directly to the native input.
    accepted.current = event.currentTarget.value;
    onFocus?.(event);
  }} onBeforeInput={event => {
    accepted.current = event.currentTarget.value;
    onBeforeInput?.(event);
  }} onChange={event => {
    const input = event.currentTarget;
    const error = personNameInputError(input.value, maxLength);
    if (error) {
      const position = Math.max(0, (input.selectionStart ?? input.value.length) - (input.value.length - accepted.current.length));
      input.value = accepted.current;
      input.setSelectionRange(position, position);
      onInputRejected?.(error);
      return;
    }
    accepted.current = input.value;
    onChange?.(event);
  }} onPaste={event => {
    onPaste?.(event);
    if (event.defaultPrevented) return;
    const input = event.currentTarget;
    const candidate = input.value.slice(0, input.selectionStart ?? 0) + event.clipboardData.getData("text") + input.value.slice(input.selectionEnd ?? input.value.length);
    const error = personNameInputError(candidate, maxLength);
    if (error) { event.preventDefault(); onInputRejected?.(error); }
  }} />;
}
