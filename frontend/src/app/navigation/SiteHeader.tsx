import { ActionIcon, Box, Drawer, Group, UnstyledButton } from "@mantine/core";
import { useEffect, useRef, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { readCatalogCriteria, safeCatalogReturnHref } from "@/features/catalog/catalogUrl";
import { MaterialSymbol } from "@/shared/ui/MaterialSymbol";
import { useStorefrontNavigation } from "@/features/storefront/storefrontQuery";
import { HeaderAccount, HeaderCart } from "./HeaderAccount";
import { DesktopNavigation, MobileNavigation } from "./HeaderNavigation";
import navigationClasses from "./HeaderNavigation.module.css";
import { HeaderSearch } from "./HeaderSearch";
import classes from "./SiteHeader.module.css";
import homeClasses from "./HomeHeader.module.css";

/** One header surface at a time: search, account, the phone sheet or one section menu. */
type HeaderPanel = "search" | "account" | "navigation" | `menu:${string}` | null;

export function SiteHeader() {
  const location = useLocation();
  const navigation = useStorefrontNavigation();
  const destinations = navigation.data?.sections ?? [];
  const [panel, setPanel] = useState<HeaderPanel>(null);
  const [scrolled, setScrolled] = useState(() => window.scrollY > 8);
  const searchTrigger = useRef<HTMLButtonElement>(null);
  const criteria = readCatalogCriteria(location.pathname === "/catalog" ? location.search
    : new URL(safeCatalogReturnHref(new URLSearchParams(location.search).get("from")), window.location.origin).search);
  const navigationLocation = location.pathname.startsWith("/catalog/editions/")
    ? new URL(safeCatalogReturnHref(new URLSearchParams(location.search).get("from")), window.location.origin)
    : new URL(`${location.pathname}${location.search}`, window.location.origin);
  const selected = destinations.find((section) => {
    const destination = new URL(section.href, window.location.origin);
    return (navigationLocation.pathname === destination.pathname || navigationLocation.pathname.startsWith(`${destination.pathname}/`))
      && [...destination.searchParams].every(([key, value]) => navigationLocation.searchParams.get(key) === value);
  })?.key;

  useEffect(() => { setPanel(null); }, [location.key]);
  useEffect(() => {
    const shortcut = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (event.key !== "/" || event.metaKey || event.ctrlKey || event.altKey || (panel !== null && !panel.startsWith("menu:"))
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

  const menuKey = panel?.startsWith("menu:") ? panel.slice(5) : null;
  // A section menu closes on a press anywhere outside its own item; Escape is handled where focus is.
  useEffect(() => {
    if (!menuKey) return;
    const outside = (event: PointerEvent) => { if (!(event.target instanceof Element) || !event.target.closest("[data-header-menu]")) setPanel(null); };
    const escape = (event: KeyboardEvent) => { if (event.key === "Escape") setPanel(null); };
    document.addEventListener("pointerdown", outside);
    document.addEventListener("keydown", escape);
    return () => { document.removeEventListener("pointerdown", outside); document.removeEventListener("keydown", escape); };
  }, [menuKey]);

  return <Box component="header" className={`${classes.header}${location.pathname === "/" ? ` ${homeClasses.header}` : ""}`} data-home={location.pathname === "/" || undefined} data-scrolled={scrolled || undefined} data-panel={menuKey ? "menu" : panel ?? undefined} data-testid="site-header">
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
      <DesktopNavigation navigation={navigation} selected={selected} openKey={menuKey} onOpenChange={(key) => setPanel(key ? `menu:${key}` : (current) => current?.startsWith("menu:") ? null : current)} />
      <Group component="nav" aria-label="Búsqueda, carrito y cuenta" className={classes.actions} wrap="nowrap" gap={0}>
        <UnstyledButton ref={searchTrigger} className={classes.searchTrigger} aria-label="Buscar libros en el catálogo" aria-keyshortcuts="/" aria-haspopup="dialog" aria-expanded={panel === "search"} onClick={() => setPanel("search")}><MaterialSymbol name="search" size={22} /><span className={classes.searchText}>Buscar libros</span><kbd className={classes.searchKey} aria-hidden="true">/</kbd></UnstyledButton>
        <HeaderCart />
        <HeaderAccount opened={panel === "account"} onChange={(opened) => setPanel((current) => opened ? "account" : current === "account" ? null : current)} />
      </Group>
    </Group>
    {menuKey && <div className={classes.menuVeil} aria-hidden="true" />}
    <Drawer opened={panel === "navigation"} onClose={() => setPanel(null)} title="Navegación" position="left" size={380} closeButtonProps={{ "aria-label": "Cerrar navegación" }} transitionProps={{ duration: 0 }}
      classNames={{ content: navigationClasses.sheet, header: navigationClasses.sheetHeader, title: navigationClasses.sheetTitle }}>
      <MobileNavigation navigation={navigation} selected={selected} onNavigate={() => setPanel(null)} />
    </Drawer>
    <HeaderSearch criteria={criteria} topics={[]} opened={panel === "search"} onClose={(restoreFocus) => {
      setPanel(null);
      if (restoreFocus) requestAnimationFrame(() => searchTrigger.current?.focus({ preventScroll: true }));
    }} />
  </Box>;
}
