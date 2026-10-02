import { ActionIcon, Group, VisuallyHidden } from "@mantine/core";
import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { useLocation, useNavigationType } from "react-router-dom";
import type { EditionSummary } from "@/shared/api/catalog";
import { MaterialSymbol } from "@/shared/ui/MaterialSymbol";
import { EditionGrid } from "./EditionGrid";
import type { CatalogCriteria } from "./catalogUrl";
import classes from "./exploration.module.css";

export function HomeDiscoveryRail({ editions, criteria }: { editions: EditionSummary[]; criteria: CatalogCriteria }) {
  const rail = useRef<HTMLUListElement>(null);
  const location = useLocation();
  const navigationType = useNavigationType();
  const id = useId();
  const [position, setPosition] = useState({ overflow: false, start: true, end: true });

  useLayoutEffect(() => {
    if (navigationType === "POP" && rail.current) {
      const saved = window.history.state?.pliegoHomeRailScrollLeft;
      if (typeof saved === "number" && Number.isFinite(saved)) rail.current.scrollLeft = saved;
    }
  }, [navigationType, location.key]);

  useEffect(() => {
    const node = rail.current;
    if (!node) return;
    const update = () => {
      const maximum = Math.max(0, node.scrollWidth - node.clientWidth);
      setPosition({ overflow: maximum > 1, start: node.scrollLeft < 1, end: node.scrollLeft >= maximum - 1 });
      if ((window.history.state?.key ?? "default") === location.key) {
        window.history.replaceState({ ...window.history.state, pliegoHomeRailScrollLeft: node.scrollLeft }, "");
      }
    };
    update();
    node.addEventListener("scroll", update, { passive: true });
    const observer = typeof ResizeObserver === "undefined" ? undefined : new ResizeObserver(update);
    observer?.observe(node);
    window.addEventListener("resize", update);
    return () => { node.removeEventListener("scroll", update); observer?.disconnect(); window.removeEventListener("resize", update); };
  }, [editions.length, location.key]);

  function move(direction: number) {
    const node = rail.current;
    if (!node || (direction < 0 ? position.start : position.end)) return;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    node.scrollBy({ left: direction * Math.max(1, node.clientWidth - 48), behavior: reduced ? "instant" : "smooth" });
  }

  return <>
    <div className={classes.railHeading}>
      <h2 id="discovery-heading" className={classes.sectionTitle}>Ediciones para descubrir</h2>
      {position.overflow && <Group gap={8} wrap="nowrap" role="group" aria-label="Navegación de libros" className={classes.railNavigation}>
        <ActionIcon variant="default" radius="xl" size={48} className={classes.railArrow} aria-label="Ver libros anteriores" aria-controls={id} aria-disabled={position.start} style={{ visibility: position.start ? "hidden" : undefined }} onClick={() => move(-1)}><MaterialSymbol name="arrow_back" size={24} /></ActionIcon>
        <ActionIcon variant="default" radius="xl" size={48} className={classes.railArrow} aria-label="Ver más libros" aria-controls={id} aria-disabled={position.end} onClick={() => move(1)}><MaterialSymbol name="arrow_forward" size={24} /></ActionIcon>
      </Group>}
    </div>
    <EditionGrid editions={editions} criteria={criteria} presentation="rail" railRef={rail} railId={id} />
    <VisuallyHidden>Desliza para descubrir libros o usa los controles de navegación. Cada libro conserva sus enlaces y acciones.</VisuallyHidden>
  </>;
}
