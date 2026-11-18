import { useEffect, useRef, useState, type CSSProperties } from "react";
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
 * when it can be taken back, offers the one action that does so in yellow. It never blocks the page and holds one
 * message at a time: a new one replaces it instead of stacking. It leaves on its own after `duration`, a thin line
 * along its foot showing the time left; while it is hovered, focused or working the time stops, and it resumes where
 * it stopped. With reduced motion the line is not drawn; the timing and the pause stay.
 */
export function UndoToast({ toast, onDismiss, duration = 9000, progress = true }: {
  toast: UndoToastMessage | null;
  onDismiss: () => void;
  duration?: number;
  /** The time-left line; off only for notices whose window is too long to read as a countdown. */
  progress?: boolean;
}) {
  const [held, setHeld] = useState(false);
  const dismiss = useRef(onDismiss);
  dismiss.current = onDismiss;
  const remaining = useRef(duration);
  const busy = Boolean(toast?.action?.busy);
  const paused = held || busy;
  const key = toast?.key;
  // A new message gets the whole window (declared before the timer, so it runs after the old timer's cleanup).
  useEffect(() => { remaining.current = duration; }, [key, duration]);
  useEffect(() => {
    if (key === undefined || paused) return;
    const started = Date.now();
    const timer = window.setTimeout(() => dismiss.current(), remaining.current);
    return () => {
      window.clearTimeout(timer);
      remaining.current = Math.max(0, remaining.current - (Date.now() - started));
    };
  }, [key, paused, duration]);
  useEffect(() => { if (key === undefined) setHeld(false); }, [key]);

  return <div className={classes.region} role="status" aria-live="polite" aria-atomic="true">
    {toast && <div key={toast.key} className={classes.toast} data-undo-toast data-paused={paused || undefined}
      style={{ "--toast-duration": `${duration}ms` } as CSSProperties}
      onMouseEnter={() => setHeld(true)} onMouseLeave={() => setHeld(false)}
      onFocus={() => setHeld(true)} onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setHeld(false); }}
      onKeyDown={(event) => { if (event.key === "Escape") { event.stopPropagation(); onDismiss(); } }}>
      <p className={classes.message}>{toast.message}{toast.detail && <span className="visually-hidden">: {toast.detail}</span>}</p>
      {toast.action && <button type="button" className={classes.action} aria-disabled={toast.action.busy || undefined} aria-busy={toast.action.busy || undefined}
        onClick={() => { if (!toast.action!.busy) toast.action!.onPress(); }}>{toast.action.busy && toast.action.busyLabel ? toast.action.busyLabel : toast.action.label}</button>}
      <button type="button" className={classes.close} aria-label="Cerrar aviso" onClick={onDismiss}><MaterialSymbol name="close" aria-hidden="true" size={20} /></button>
      {progress && <span className={classes.progress} aria-hidden="true" data-undo-toast-progress />}
    </div>}
  </div>;
}
