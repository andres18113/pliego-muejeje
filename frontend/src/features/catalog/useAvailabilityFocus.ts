import { useLayoutEffect, useRef, type FocusEvent } from "react";

/** A stock update may remove/disable the focused action. Recover locally without stealing other focus. */
export function useAvailabilityFocus(enabled: boolean, fallback: () => HTMLElement | null, restored?: () => HTMLElement | null) {
  const focusedAction = useRef<HTMLButtonElement | null>(null);
  const recovered = useRef<{ target: HTMLElement; action: HTMLButtonElement } | null>(null);
  const recovery = useRef(fallback);
  recovery.current = fallback;
  const restoration = useRef(restored);
  restoration.current = restored;
  useLayoutEffect(() => {
    if (enabled) {
      const previous = recovered.current;
      recovered.current = null;
      // Checkout's warning disappears on recovery; return to its now-enabled action.
      if (previous && !previous.target.isConnected && document.activeElement === document.body) {
        const target = previous.action.isConnected && !previous.action.disabled ? previous.action : restoration.current?.();
        target?.focus({ preventScroll: true });
      }
      return;
    }
    const action = focusedAction.current;
    if (!action) return;
    if (document.activeElement !== action && document.activeElement !== document.body) return;
    if (action.isConnected && !action.disabled) return;
    focusedAction.current = null;
    const target = recovery.current();
    if (target) {
      recovered.current = { target, action };
      target.focus({ preventScroll: true });
    }
  }, [enabled]);
  return {
    onFocus: (event: FocusEvent<HTMLButtonElement>) => { focusedAction.current = event.currentTarget; },
    onBlur: (event: FocusEvent<HTMLButtonElement>) => {
      if (event.relatedTarget && event.relatedTarget !== document.body) focusedAction.current = null;
    },
  };
}
