import { useEffect, useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from "react";
import { BackButton } from "@/app/navigation/BackButton";
import classes from "./editionDetail.module.css";

/**
 * True once the page's own wayfinding row (back arrow + trail) has left the top of the viewport. The site header
 * scrolls away with the page here, so exactly one back arrow is ever in view: the page's at the top, the bar's below.
 */
export function useContextBarVisible(watched: RefObject<HTMLElement | null>) {
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    let frame = 0;
    const measure = () => {
      frame = 0;
      const row = watched.current;
      if (row) setVisible(row.getBoundingClientRect().bottom <= 0);
    };
    const schedule = () => { if (!frame) frame = requestAnimationFrame(measure); };
    measure();
    window.addEventListener("scroll", schedule, { passive: true });
    window.addEventListener("resize", schedule);
    return () => {
      window.removeEventListener("scroll", schedule);
      window.removeEventListener("resize", schedule);
      if (frame) cancelAnimationFrame(frame);
    };
  }, [watched]);
  return visible;
}

/**
 * The edition's context bar, as on product pages: when the page's top has scrolled away it is simply there, a floating
 * pill at the top — back arrow and title on the left; today's price (the previous one struck after it) and the scene's
 * own "Agregar al carrito" grouped on the right — and at the top it is simply gone. No slide, no fade: it replaces the
 * wayfinding row at the moment that row leaves, so nothing sweeps or jumps. It exists only while shown, so the page
 * never holds a hidden second arrow, title or price.
 */
export function EditionContextBar({ visible, ...props }: Parameters<typeof Bar>[0] & { visible: boolean }) {
  return visible ? <Bar {...props} /> : null;
}

function Bar({ title, price, originalPrice, action, onHiddenWithFocus }: {
  title: string;
  price: string | null;
  originalPrice: string | null;
  /** The purchase scene's action at bar size (its own mutation and states), or its unavailability; none for staff. */
  action: ReactNode;
  /** Focus inside the bar when it goes must land somewhere visible. */
  onHiddenWithFocus: () => void;
}) {
  const bar = useRef<HTMLDivElement>(null);
  const hidden = useRef(onHiddenWithFocus);
  hidden.current = onHiddenWithFocus;
  useLayoutEffect(() => {
    const node = bar.current;
    // Runs before the bar leaves the document, while focus can still be seen inside it.
    return () => { if (node?.contains(document.activeElement)) requestAnimationFrame(() => hidden.current()); };
  }, []);
  return <div ref={bar} className={classes.contextBar} role="region" aria-label="Resumen del libro">
    <div className={classes.contextInner}>
      <div className={classes.contextLead}>
        <BackButton />
        <p className={classes.contextTitle}>{title}</p>
      </div>
      <div className={classes.contextTrail}>
        {price && <p className={classes.contextPrice}>
          <span>{originalPrice && <span className="visually-hidden">Precio actual </span>}{price}</span>
          {originalPrice && <s className={classes.contextWas}><span className="visually-hidden">Precio anterior </span>{originalPrice}</s>}
        </p>}
        {action}
      </div>
    </div>
  </div>;
}
