import { Popover } from "@mantine/core";
import { useEffect, useId, useLayoutEffect, useRef, useState, type PointerEvent } from "react";
import { MaterialSymbol } from "@/shared/ui/MaterialSymbol";
import classes from "./digitalCopyNote.module.css";

export const digitalCopyLabel = "Copia digital individual";
/** ADR-0042: a paid digital copy becomes an active title in Mi biblioteca, and an account holds one active copy. */
export const digitalCopyExplanation = "Al comprarlo, este título se añade a tu biblioteca digital. Solo puedes adquirirlo una vez por cuenta.";

/**
 * Where the explanation may start: below the sticky store or purchase header, and inside the nearest scrolling
 * container (the cart drawer's list), so flipping never lays it over a header or outside what can be seen.
 */
function visibleTop(trigger: HTMLElement) {
  let top = Math.max(0, ...[...document.querySelectorAll<HTMLElement>("[data-purchase-header], [data-testid='site-header']")]
    .map((bar) => bar.getBoundingClientRect().bottom));
  for (let node = trigger.parentElement; node && node !== document.body; node = node.parentElement) {
    if (/(auto|scroll)/.test(getComputedStyle(node).overflowY) && node.scrollHeight > node.clientHeight) {
      top = Math.max(top, node.getBoundingClientRect().top);
      break;
    }
  }
  return top;
}

/**
 * A digital line's quantity, said as a short visible label with an `info` toggletip beside it. A mouse shows the
 * explanation on hover, keyboard focus shows it, and a click or tap keeps it open until Escape, a second press or a
 * press outside. Any scroll — the page or a nested list — dismisses it, so it never drifts away from its icon. The
 * explanation is always the button's description, so assistive technology hears it unopened.
 */
export function DigitalCopyNote({ className }: { className?: string }) {
  const id = useId();
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const [pinned, setPinned] = useState(false);
  // Set by every way of closing; only a new hover, focus or press clears it.
  const [dismissed, setDismissed] = useState(false);
  const leaveTimer = useRef<number | null>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const [top, setTop] = useState(0);
  const opened = !dismissed && (hovered || focused || pinned);

  // Measured before paint on every opening, so the first frame is already placed clear of the header.
  useLayoutEffect(() => { if (opened && trigger.current) setTop(visibleTop(trigger.current)); }, [opened]);
  // Scrolling anywhere dismisses it until the next hover, focus or press. Armed two frames after opening, so the
  // browser's own scroll that brings a newly focused button into view does not close what focus just opened.
  useEffect(() => {
    if (!opened) return;
    const dismiss = () => { setPinned(false); setDismissed(true); };
    let frame = requestAnimationFrame(() => {
      frame = requestAnimationFrame(() => { frame = 0; window.addEventListener("scroll", dismiss, { capture: true, passive: true }); });
    });
    return () => { if (frame) cancelAnimationFrame(frame); window.removeEventListener("scroll", dismiss, { capture: true }); };
  }, [opened]);

  useEffect(() => () => { if (leaveTimer.current !== null) window.clearTimeout(leaveTimer.current); }, []);
  // Escape dismisses it wherever focus is, even when only hovered (WCAG 1.4.13), and stops there so an enclosing
  // drawer stays open.
  useEffect(() => {
    if (!opened) return;
    const escape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.stopPropagation();
      setPinned(false);
      setDismissed(true);
    };
    window.addEventListener("keydown", escape, true);
    return () => window.removeEventListener("keydown", escape, true);
  }, [opened]);
  // Hover stays open while the pointer travels from the icon to the explanation (WCAG 1.4.13: hoverable).
  const enter = (event: PointerEvent) => {
    if (event.pointerType !== "mouse") return;
    if (leaveTimer.current !== null) window.clearTimeout(leaveTimer.current);
    if (!hovered) setDismissed(false);
    setHovered(true);
  };
  const leave = (event: PointerEvent) => {
    if (event.pointerType !== "mouse") return;
    leaveTimer.current = window.setTimeout(() => setHovered(false), 150);
  };
  const close = () => { setPinned(false); setDismissed(true); };

  return <span className={`${classes.note}${className ? ` ${className}` : ""}`}>
    <span>{digitalCopyLabel}</span>
    {/* withRoles off: the explanation is a tooltip described by its id, not a dialog with generated roles and ids. */}
    <Popover opened={opened} onChange={(next) => { if (!next) close(); }} onDismiss={close} position="top" withArrow arrowSize={10} withRoles={false}
      width="min(272px, calc(100vw - 32px))" keepMounted
      // Above its icon when there is room under the header, below it otherwise; 8px from every visible edge.
      middlewares={{ flip: { padding: { top: top + 8, right: 8, bottom: 8, left: 8 } }, shift: { padding: 8 } }} shadow="none" closeOnEscape={false} trapFocus={false} returnFocus={false}
      // Simply there or gone, like PLIEGO's other surfaces: no fade that leaves a half-transparent sheet over the line.
      transitionProps={{ duration: 0 }}>
      <Popover.Target>
        <button ref={trigger} type="button" className={classes.trigger} aria-label="Más información sobre la copia digital individual"
          aria-describedby={id} aria-controls={id} aria-expanded={opened}
          // A second press on an open, pinned explanation closes it even while hovered or focused.
          onClick={() => { if (opened && pinned) close(); else { setDismissed(false); setPinned(true); } }}
          onFocus={() => { setFocused(true); setDismissed(false); }} onBlur={() => { setFocused(false); setPinned(false); }}
          onPointerEnter={enter} onPointerLeave={leave}>
          <MaterialSymbol name="info" size={18} aria-hidden="true" />
        </button>
      </Popover.Target>
      <Popover.Dropdown id={id} role="tooltip" className={classes.panel} onPointerEnter={enter} onPointerLeave={leave}>
        {digitalCopyExplanation}
      </Popover.Dropdown>
    </Popover>
  </span>;
}
