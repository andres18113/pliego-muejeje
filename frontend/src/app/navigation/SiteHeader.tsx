import { ActionIcon, Box, Group, Modal, UnstyledButton } from "@mantine/core";
import { useEffect, useRef, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { readCatalogCriteria, safeCatalogReturnHref } from "@/features/catalog/catalogUrl";
import { MaterialSymbol } from "@/shared/ui/MaterialSymbol";
import { storefrontDestinations } from "@/shared/navigation/storefrontDestinations";
import { HeaderAccount, HeaderCart } from "./HeaderAccount";
import { HeaderSearch } from "./HeaderSearch";
import classes from "./SiteHeader.module.css";
import homeClasses from "./HomeHeader.module.css";

type HeaderPanel = "search" | "account" | "navigation" | null;

export function SiteHeader() {
  const location = useLocation();
  const [panel, setPanel] = useState<HeaderPanel>(null);
  const [scrolled, setScrolled] = useState(() => window.scrollY > 8);
  const searchTrigger = useRef<HTMLButtonElement>(null);
  const criteria = readCatalogCriteria(location.pathname === "/catalog" ? location.search
    : new URL(safeCatalogReturnHref(new URLSearchParams(location.search).get("from")), window.location.origin).search);
  const selected = location.pathname === "/ofertas" ? "offers"
    : criteria.format === "EBOOK" ? "ebooks" : criteria.format === "AUDIOBOOK" ? "audio"
    : location.pathname.startsWith("/catalog") ? "books" : null;

  useEffect(() => { setPanel(null); }, [location.key]);
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
    update(); window.addEventListener("scroll", update, { passive: true });
    return () => window.removeEventListener("scroll", update);
  }, []);

  function links(mobile = false) {
    return <nav className={mobile ? classes.mobileNavigation : classes.navigation} aria-label="Navegación principal">
      {storefrontDestinations.map((item) => <UnstyledButton component={Link} key={item.id} to={item.href}
        className={classes.navLink} aria-current={selected === item.id ? "page" : undefined}>{item.label}</UnstyledButton>)}
    </nav>;
  }

  return <Box component="header" className={`${classes.header}${location.pathname === "/" ? ` ${homeClasses.header}` : ""}`} data-home={location.pathname === "/" || undefined} data-scrolled={scrolled || undefined} data-panel={panel ?? undefined} data-testid="site-header">
    <a className={classes.skip} href="#contenido-principal" onClick={(event) => {
      const main = document.getElementById("contenido-principal");
      if (!main) return;
      event.preventDefault(); main.focus(); main.scrollIntoView({ block: "start", behavior: "instant" });
    }}>Saltar al contenido</a>
    <Group className={classes.bar} wrap="nowrap">
      <Group className={classes.primary} wrap="nowrap">
        <ActionIcon className={classes.menuTrigger} aria-label="Abrir navegación" aria-expanded={panel === "navigation"} aria-haspopup="dialog" onClick={() => setPanel("navigation")}><MaterialSymbol name="menu" context="header" /></ActionIcon>
        <UnstyledButton component={Link} to="/" className={classes.wordmark} aria-label="PLIEGO, ir al inicio">PLIEGO</UnstyledButton>
      </Group>
      {links()}
      <Group component="nav" aria-label="Búsqueda, carrito y cuenta" className={classes.actions} wrap="nowrap" gap={0}>
        <UnstyledButton ref={searchTrigger} className={classes.searchTrigger} aria-label="Buscar libros en el catálogo" aria-keyshortcuts="/" aria-haspopup="dialog" aria-expanded={panel === "search"} onClick={() => setPanel("search")}><MaterialSymbol name="search" size={22} /><span className={classes.searchText}>Buscar libros</span><kbd className={classes.searchKey} aria-hidden="true">/</kbd></UnstyledButton>
        <HeaderCart />
        <HeaderAccount opened={panel === "account"} onChange={(opened) => setPanel((current) => opened ? "account" : current === "account" ? null : current)} />
      </Group>
    </Group>
    <Modal opened={panel === "navigation"} onClose={() => setPanel(null)} title="Navegación" size="sm" closeButtonProps={{ "aria-label": "Cerrar navegación" }} transitionProps={{ duration: 0 }}>
      {links(true)}
    </Modal>
    <HeaderSearch criteria={criteria} topics={[]} opened={panel === "search"} onClose={(restoreFocus) => {
      setPanel(null);
      if (restoreFocus) requestAnimationFrame(() => searchTrigger.current?.focus({ preventScroll: true }));
    }} />
  </Box>;
}
