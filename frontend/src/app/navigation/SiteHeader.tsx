import { ActionIcon, Box, Group, Modal, UnstyledButton } from "@mantine/core";
import { useQuery } from "@tanstack/react-query";
import { useMediaQuery } from "@mantine/hooks";
import { useEffect, useRef, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { readCatalogCriteria, safeCatalogReturnHref } from "@/features/catalog/catalogUrl";
import { categoryGroups } from "@/features/catalog/catalogCategories";
import { getPublicCategories } from "@/shared/api/catalog";
import { MaterialSymbol } from "@/shared/ui/MaterialSymbol";
import { HeaderAccount, HeaderCart } from "./HeaderAccount";
import { HeaderSearch } from "./HeaderSearch";
import { HeaderCategories } from "./HeaderCategories";
import classes from "./SiteHeader.module.css";
import homeClasses from "./HomeHeader.module.css";

type HeaderPanel = "search" | "account" | "categories" | null;

export function SiteHeader() {
  const location = useLocation();
  const [panel, setPanel] = useState<HeaderPanel>(null);
  const [category, setCategory] = useState("");
  const [scrolled, setScrolled] = useState(() => window.scrollY > 8);
  const searchTrigger = useRef<HTMLButtonElement>(null);
  const categoryTrigger = useRef<HTMLElement | null>(null);
  const desktopMenu = useMediaQuery("(min-width: 1280px)");
  const menuPanel = useRef<HTMLDivElement>(null);
  const hoverTimer = useRef<number | undefined>(undefined);
  const openedByHover = useRef(false);
  const categories = useQuery({ queryKey: ["public-catalog", "categories"], queryFn: ({ signal }) => getPublicCategories(signal), staleTime: 60_000 });
  const roots = categoryGroups(categories.data?.items ?? []).map(({ category: item }) => item);
  const criteria = readCatalogCriteria(location.pathname === "/catalog" ? location.search
    : new URL(safeCatalogReturnHref(new URLSearchParams(location.search).get("from")), window.location.origin).search);

  useEffect(() => { window.clearTimeout(hoverTimer.current); setPanel(null); }, [location.key]);
  useEffect(() => () => window.clearTimeout(hoverTimer.current), []);
  useEffect(() => {
    if (panel !== "categories" || !desktopMenu) return;
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") { event.preventDefault(); closeCategories(); }
    };
    document.addEventListener("keydown", escape);
    return () => document.removeEventListener("keydown", escape);
  }, [panel, desktopMenu]);
  // "/" opens search from anywhere except while typing in another field.
  useEffect(() => {
    const shortcut = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (event.key !== "/" || event.metaKey || event.ctrlKey || event.altKey || panel !== null
          || target?.closest("input, textarea, select, [contenteditable='true'], [role='dialog']")) return;
      event.preventDefault(); setPanel("search");
    };
    document.addEventListener("keydown", shortcut);
    return () => document.removeEventListener("keydown", shortcut);
  }, [panel]);
  useEffect(() => {
    const update = () => setScrolled(window.scrollY > 8);
    update();
    window.addEventListener("scroll", update, { passive: true });
    return () => window.removeEventListener("scroll", update);
  }, []);

  function closeCategories() {
    window.clearTimeout(hoverTimer.current);
    setPanel(null);
    if (!openedByHover.current || menuPanel.current?.contains(document.activeElement)) requestAnimationFrame(() => categoryTrigger.current?.focus({ preventScroll: true }));
    openedByHover.current = false;
  }
  function bar(overlay = false) {
    return <Group className={classes.bar} wrap="nowrap" justify="space-between">
      <Group className={classes.primary} wrap="nowrap">
        <ActionIcon className={classes.menuTrigger} aria-label={overlay ? "Cerrar categorías" : "Abrir navegación"} aria-expanded={panel === "categories"} aria-haspopup="dialog" onClick={(event) => {
          if (overlay) closeCategories(); else { categoryTrigger.current = event.currentTarget; setCategory(""); setPanel("categories"); }
        }}><MaterialSymbol name={overlay ? "close" : "menu"} context="header" /></ActionIcon>
        <UnstyledButton component={Link} to="/" className={classes.wordmark} aria-label="PLIEGO, ir al inicio">PLIEGO</UnstyledButton>
        <nav className={classes.navigation} aria-label="Navegación principal">
          <UnstyledButton component={Link} to="/catalog" className={classes.navLink} aria-current={location.pathname === "/catalog" && !criteria.category ? "page" : undefined} aria-label="Catálogo">Catálogo</UnstyledButton>
          {roots.map((item) => <UnstyledButton key={item.slug} className={classes.navLink} aria-expanded={panel === "categories" && category === item.slug} aria-haspopup={desktopMenu ? undefined : "dialog"} aria-controls={desktopMenu && panel === "categories" ? "categorias-escritorio" : undefined} aria-current={criteria.category === item.slug ? "page" : undefined} onMouseEnter={(event) => {
            window.clearTimeout(hoverTimer.current);
            if (panel === "categories") { setCategory(item.slug); return; }
            if (!desktopMenu || panel) return;
            const trigger = event.currentTarget;
            hoverTimer.current = window.setTimeout(() => {
              categoryTrigger.current = trigger; openedByHover.current = true; setCategory(item.slug); setPanel("categories");
            }, 180);
          }} onMouseLeave={() => window.clearTimeout(hoverTimer.current)} onKeyDown={(event) => {
            if (event.key !== "ArrowDown") return;
            event.preventDefault(); categoryTrigger.current = event.currentTarget; openedByHover.current = false; setCategory(item.slug); setPanel("categories");
            requestAnimationFrame(() => menuPanel.current?.querySelector<HTMLAnchorElement>("a")?.focus());
          }} onClick={(event) => {
            window.clearTimeout(hoverTimer.current); openedByHover.current = false;
            if (!overlay) categoryTrigger.current = event.currentTarget;
            setCategory(item.slug); setPanel("categories");
          }}>{item.name}</UnstyledButton>)}
        </nav>
      </Group>
      <Group component="nav" aria-label="Búsqueda, carrito y cuenta" className={classes.actions} wrap="nowrap" gap={0}>
        <UnstyledButton ref={overlay ? undefined : searchTrigger} className={classes.searchTrigger} aria-label="Buscar en el catálogo" aria-keyshortcuts="/" aria-haspopup="dialog" aria-expanded={panel === "search"} onClick={() => setPanel("search")}><MaterialSymbol name="search" size={22} /><span className={classes.searchText}>Buscar libros</span><kbd className={classes.searchKey} aria-hidden="true">/</kbd></UnstyledButton>
        <HeaderCart />
        <HeaderAccount opened={!overlay && panel === "account"} onChange={(opened) => setPanel((current) => opened ? "account" : current === "account" ? null : current)} />
        {overlay && <ActionIcon className={`${classes.icon} ${classes.desktopClose}`} aria-label="Cerrar categorías" onClick={closeCategories}><MaterialSymbol name="close" /></ActionIcon>}
      </Group>
    </Group>;
  }
  const categoryContent = <HeaderCategories categories={categories.data?.items ?? []} selected={category} onSelect={setCategory} loading={categories.isPending} error={categories.isError} onRetry={() => void categories.refetch()} />;
  return <Box component="header" className={`${classes.header}${location.pathname === "/" ? ` ${homeClasses.header}` : ""}`} data-home={location.pathname === "/" || undefined} data-scrolled={scrolled || undefined} data-panel={panel ?? undefined} data-testid="site-header" onMouseEnter={() => window.clearTimeout(hoverTimer.current)} onMouseLeave={() => {
    window.clearTimeout(hoverTimer.current);
    if (desktopMenu && panel === "categories") hoverTimer.current = window.setTimeout(() => {
      if (!menuPanel.current?.contains(document.activeElement)) closeCategories();
    }, 180);
  }} onBlur={(event) => {
    if (desktopMenu && panel === "categories" && event.relatedTarget && !event.currentTarget.contains(event.relatedTarget as Node)) { openedByHover.current = true; closeCategories(); }
  }}>
    <a className={classes.skip} href="#contenido-principal" onClick={(event) => {
      const main = document.getElementById("contenido-principal");
      if (!main) return;
      event.preventDefault(); main.focus(); main.scrollIntoView({ block: "start", behavior: "instant" });
    }}>Saltar al contenido</a>
    {bar()}
    {desktopMenu && panel === "categories" && <div ref={menuPanel} id="categorias-escritorio" className={classes.desktopMenu}>
      <button type="button" className={classes.menuBackdrop} tabIndex={-1} aria-label="Cerrar categorías" onClick={closeCategories} />
      {categoryContent}
    </div>}
    <Modal opened={panel === "categories" && !desktopMenu} onClose={closeCategories} title="Categorías" withCloseButton={false} size={1392} xOffset={6} yOffset={12} zIndex={100} returnFocus={false} transitionProps={{ duration: 0 }} overlayProps={{ backgroundOpacity: .75 }} classNames={{ inner: classes.overlayInner, content: classes.overlayContent, body: classes.overlayBody, header: classes.overlayHeading }}>
      {bar(true)}
      {categoryContent}
    </Modal>
    <HeaderSearch criteria={criteria} topics={roots} opened={panel === "search"} onClose={(restoreFocus) => {
      setPanel(null);
      if (restoreFocus) requestAnimationFrame(() => searchTrigger.current?.focus({ preventScroll: true }));
    }} />
  </Box>;
}
