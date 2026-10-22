import { useRef, type ComponentPropsWithRef } from "react";

/** A RUC is the longest Ecuadorian identification PLIEGO accepts. */
export const IDENTIFICATION_MAX_DIGITS = 13;
export const identificationInputRejections = {
  digits: "Escribe solo números: sin letras, espacios ni guiones.",
  length: "Máximo 13 dígitos: la cédula tiene 10 y el RUC 13.",
} as const;

type Props = Omit<ComponentPropsWithRef<"input">, "type" | "maxLength"> & { onInputRejected?: (reason: string) => void };

/** Formatting a person may paste with a number; removing it never changes the identification. */
const SEPARATORS = /[\s.\-–—]/g;
function rejection(value: string): string | null {
  if (/[^0-9]/.test(value)) return identificationInputRejections.digits;
  if (value.length > IDENTIFICATION_MAX_DIGITS) return identificationInputRejections.length;
  return null;
}

/**
 * The cédula/RUC field accepts only digits, at most 13 (ADR 0041). An edit that would break that is rejected as a
 * whole — typing, paste, drop, autofill — and explained through `onInputRejected`; the accepted value stays as it
 * was, never silently truncated or turned into another number. A pasted number keeps its digits and drops only
 * spaces, dots and dashes used to format it.
 */
export function EcuadorianCedulaInput({ onInputRejected, onChange, onKeyDown, onPaste, onDrop, onFocus, ...props }: Props) {
  const accepted = useRef(String(props.value ?? props.defaultValue ?? ""));
  if (props.value !== undefined) accepted.current = String(props.value);

  function selectionLength(input: HTMLInputElement) { return (input.selectionEnd ?? 0) - (input.selectionStart ?? 0); }
  /** Replace the selection the way typing would, so React and react-hook-form see an ordinary change. */
  function insert(input: HTMLInputElement, text: string) {
    const start = input.selectionStart ?? input.value.length, end = input.selectionEnd ?? input.value.length;
    const next = input.value.slice(0, start) + text + input.value.slice(end);
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, next);
    input.setSelectionRange(start + text.length, start + text.length);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  }

  return <input autoComplete="off" spellCheck={false} {...props} type="text" inputMode="numeric" pattern="[0-9]*" maxLength={IDENTIFICATION_MAX_DIGITS}
    onFocus={event => {
      // react-hook-form may restore an uncontrolled value directly to the native input.
      accepted.current = event.currentTarget.value;
      onFocus?.(event);
    }}
    onKeyDown={event => {
      onKeyDown?.(event);
      const input = event.currentTarget;
      if (input.readOnly || event.defaultPrevented || event.ctrlKey || event.metaKey || event.altKey || event.key.length !== 1) return;
      if (!/[0-9]/.test(event.key)) { event.preventDefault(); onInputRejected?.(identificationInputRejections.digits); return; }
      // The native limit would ignore the key silently; say why instead.
      if (input.value.length - selectionLength(input) >= IDENTIFICATION_MAX_DIGITS) { event.preventDefault(); onInputRejected?.(identificationInputRejections.length); }
    }}
    onPaste={event => {
      onPaste?.(event);
      const input = event.currentTarget;
      if (event.defaultPrevented || input.readOnly) return;
      event.preventDefault();
      const pasted = event.clipboardData.getData("text").replace(SEPARATORS, "");
      const candidate = input.value.slice(0, input.selectionStart ?? 0) + pasted + input.value.slice(input.selectionEnd ?? input.value.length);
      const reason = rejection(candidate);
      if (reason) { onInputRejected?.(reason); return; }
      insert(input, pasted);
    }}
    onDrop={event => {
      onDrop?.(event);
      if (event.defaultPrevented || event.currentTarget.readOnly) return;
      const reason = rejection(event.currentTarget.value + event.dataTransfer.getData("text").replace(SEPARATORS, ""));
      if (reason) { event.preventDefault(); onInputRejected?.(reason); }
    }}
    onChange={event => {
      // The last guard for anything else that edits the field (autofill, IME, assistive input).
      const input = event.currentTarget;
      const reason = rejection(input.value);
      if (reason) {
        const position = Math.max(0, (input.selectionStart ?? input.value.length) - (input.value.length - accepted.current.length));
        input.value = accepted.current;
        input.setSelectionRange(position, position);
        onInputRejected?.(reason);
        return;
      }
      accepted.current = input.value;
      onChange?.(event);
    }} />;
}
