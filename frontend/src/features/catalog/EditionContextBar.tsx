import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from "react";
import { BackButton } from "@/app/navigation/BackButton";
import { BookCover } from "./BookCover";
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
 * The edition's context bar, as on product pages: when the page's top has scrolled away it is simply there, fixed at
 * the top — back arrow and title on the left, today's price and the jacket on the right — and at the top it is simply
 * gone. No slide, no fade: it replaces the wayfinding row at the moment that row leaves, so nothing sweeps or jumps.
 * It exists only while shown, so the page never holds a hidden second arrow, title or price.
 */
export function EditionContextBar({ visible, ...props }: Parameters<typeof Bar>[0] & { visible: boolean }) {
  return visible ? <Bar {...props} /> : null;
}

function Bar({ title, price, originalPrice, cover, onHiddenWithFocus }: {
  title: string;
  price: string | null;
  originalPrice: string | null;
  cover: { url: string | null; license: string | null; attribution: string | null };
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
          {originalPrice && <s className={classes.contextWas}><span className="visually-hidden">Precio anterior </span>{originalPrice}</s>}
          <span>{originalPrice && <span className="visually-hidden">Precio actual </span>}{price}</span>
        </p>}
        <span className={classes.contextCover}>
          <BookCover url={cover.url} license={cover.license} attribution={cover.attribution} title={title} size="compact" decorative />
        </span>
      </div>
    </div>
  </div>;
}
