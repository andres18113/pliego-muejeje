import { useEffect, useRef, useState } from "react";
import { useSessionOperationScope } from "@/app/sessionOperation";
import { Link, useLocation } from "react-router-dom";
import { MaterialSymbol } from "./MaterialSymbol";
import type { ConfirmedCartAddition } from "./cartAdditionFeedback";
import toastClasses from "./undoToast.module.css";
import classes from "./cartAddedNotification.module.css";

export function useCartAddedNotification() {
  const sequence = useRef(0);
  const scope = useSessionOperationScope("cart-added-notification");
  const [shown, setShown] = useState<{ scope: typeof scope; addition: ConfirmedCartAddition & { key: number } } | null>(null);
  useEffect(() => setShown(null), [scope]);
  return { addition: shown?.scope === scope ? shown.addition : null, show: (value: ConfirmedCartAddition) => {
    if (scope.isCurrent()) setShown({ scope, addition: { ...value, key: ++sequence.current } });
  }, dismiss: () => setShown(null) };
}

/** One non-blocking notification per saved collection. The row's quantity is deliberately not a live region. */
export function CartAddedNotification({ addition, onDismiss, fallbackFocus }: { addition: (ConfirmedCartAddition & { key: number }) | null; onDismiss: () => void; fallbackFocus?: () => HTMLElement | null }) {
  const [held, setHeld] = useState(false);
  const location = useLocation();
  const dismiss = useRef(onDismiss);
  dismiss.current = onDismiss;
  const key = addition?.key;
  const returnFocus = useRef<HTMLElement | null>(null);
  useEffect(() => {
    if (key !== undefined && !document.activeElement?.closest("[data-cart-added-notification]")) returnFocus.current = document.activeElement as HTMLElement | null;
  }, [key]);
  function dismissManually() {
    onDismiss();
    const invoker = returnFocus.current;
    const target = invoker?.isConnected && invoker !== document.body && !invoker.matches(":disabled, [aria-disabled=\"true\"]") ? invoker : fallbackFocus?.();
    if (target?.isConnected) target.focus({ preventScroll: true });
  }
  useEffect(() => {
    if (key === undefined || held) return;
    const timer = window.setTimeout(() => dismiss.current(), 5000);
    return () => window.clearTimeout(timer);
  }, [key, held]);
  useEffect(() => { if (key === undefined) setHeld(false); }, [key]);
  return <div className={toastClasses.region} role="status" aria-live="polite" aria-atomic="true">
    {addition && <div className={toastClasses.toast} data-cart-added-notification
      onMouseEnter={() => setHeld(true)} onMouseLeave={() => setHeld(false)}
      onFocus={() => setHeld(true)} onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setHeld(false); }}
      onKeyDown={event => { if (event.key === "Escape") { event.stopPropagation(); dismissManually(); } }}>
      <div key={addition.key} className={`${toastClasses.message} ${classes.copy}`}>
        <strong>¡Agregado al carrito!</strong>
        <p>Añadiste {addition.addedQuantity} {addition.addedQuantity === 1 ? "unidad" : "unidades"}. Ahora tienes {addition.quantity} {addition.quantity === 1 ? "unidad" : "unidades"} de esta edición en tu carrito.</p>
      </div>
      <Link to="/cart" className={`${toastClasses.action} ${classes.action}`} onClick={event => {
        onDismiss();
        if (location.pathname !== "/cart" || event.button !== 0 || event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) return;
        event.preventDefault();
        const main = document.getElementById("contenido-principal");
        main?.focus({ preventScroll: true });
        main?.scrollIntoView({ block: "start", behavior: "instant" });
      }}>Ver carrito</Link>
      <button type="button" className={toastClasses.close} aria-label="Cerrar aviso de carrito" onClick={dismissManually}><MaterialSymbol name="close" size={20} aria-hidden="true" /></button>
    </div>}
  </div>;
}
