import { useEffect, useRef, useState } from "react";
import { MaterialSymbol } from "@/shared/ui/MaterialSymbol";
import classes from "./undoToast.module.css";

export interface UndoToastMessage {
  /** Changes with every new message, so the same text shown twice still restarts its timer. */
  key: number;
  message: string;
  /** Read after the message by assistive technology only (e.g. the title the message is about). */
  detail?: string;
  action?: { label: string; busyLabel?: string; busy?: boolean; onPress: () => void };
}

/**
 * PLIEGO's snackbar: a small ultramar field at the foot of the viewport that reports what just happened and,
 * when it can be taken back, offers the one action that does so in yellow. It never blocks the page. It leaves
 * on its own, but waits while it is hovered, focused or working.
 */
export function UndoToast({ toast, onDismiss, duration = 9000 }: { toast: UndoToastMessage | null; onDismiss: () => void; duration?: number }) {
  const [held, setHeld] = useState(false);
  const dismiss = useRef(onDismiss);
  dismiss.current = onDismiss;
  const busy = Boolean(toast?.action?.busy);
  const key = toast?.key;
  useEffect(() => {
    if (key === undefined || held || busy) return;
    const timer = window.setTimeout(() => dismiss.current(), duration);
    return () => window.clearTimeout(timer);
  }, [key, held, busy, duration]);
  useEffect(() => { if (key === undefined) setHeld(false); }, [key]);

  return <div className={classes.region} role="status" aria-live="polite" aria-atomic="true">
    {toast && <div key={toast.key} className={classes.toast} data-undo-toast
      onMouseEnter={() => setHeld(true)} onMouseLeave={() => setHeld(false)}
      onFocus={() => setHeld(true)} onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setHeld(false); }}
      onKeyDown={(event) => { if (event.key === "Escape") { event.stopPropagation(); onDismiss(); } }}>
      <p className={classes.message}>{toast.message}{toast.detail && <span className="visually-hidden">: {toast.detail}</span>}</p>
      {toast.action && <button type="button" className={classes.action} aria-disabled={toast.action.busy || undefined} aria-busy={toast.action.busy || undefined}
        onClick={() => { if (!toast.action!.busy) toast.action!.onPress(); }}>{toast.action.busy && toast.action.busyLabel ? toast.action.busyLabel : toast.action.label}</button>}
      <button type="button" className={classes.close} aria-label="Cerrar aviso" onClick={onDismiss}><MaterialSymbol name="close" aria-hidden="true" size={20} /></button>
    </div>}
  </div>;
}
