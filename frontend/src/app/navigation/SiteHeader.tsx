import { ActionIcon, Box, Group, UnstyledButton } from "@mantine/core";
import { useEffect, useRef, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { readCatalogCriteria, safeCatalogReturnHref } from "@/features/catalog/catalogUrl";
import { MaterialSymbol } from "@/shared/ui/MaterialSymbol";
import { HeaderAccount, HeaderCart } from "./HeaderAccount";
import { HeaderSearch } from "./HeaderSearch";
import classes from "./SiteHeader.module.css";

type HeaderPanel = "search" | "account" | null;

/** Persistent route chrome. Route changes close overlays without stealing page focus. */
export function SiteHeader() {
  const location = useLocation();
  const [panel, setPanel] = useState<HeaderPanel>(null);
  const [scrolled, setScrolled] = useState(() => window.scrollY > 8);
  const searchTrigger = useRef<HTMLButtonElement>(null);
  const criteria = readCatalogCriteria(location.pathname === "/catalog"
    ? location.search
    : new URL(safeCatalogReturnHref(new URLSearchParams(location.search).get("from")), window.location.origin).search);

  useEffect(() => setPanel(null), [location.key]);
  useEffect(() => {
    const update = () => setScrolled(window.scrollY > 8);
    update();
    window.addEventListener("scroll", update, { passive: true });
    return () => window.removeEventListener("scroll", update);
  }, []);

  return (
    <Box component="header" className={classes.header} data-scrolled={scrolled || undefined} data-testid="site-header">
      <a className={classes.skip} href="#contenido-principal" onClick={(event) => {
        const main = document.getElementById("contenido-principal");
        if (!main) return;
        event.preventDefault();
        main.focus();
        main.scrollIntoView({ block: "start", behavior: "instant" });
      }}>Saltar al contenido</a>
      <Group className={classes.bar} wrap="nowrap" justify="space-between">
        <Group className={classes.primary} wrap="nowrap">
          <UnstyledButton component={Link} to="/" className={classes.wordmark} aria-label="PLIEGO, ir al inicio">PLIEGO</UnstyledButton>
          <nav className={classes.navigation} aria-label="Navegación principal">
            <UnstyledButton component={Link} to="/catalog" className={classes.catalogLink} aria-current={location.pathname === "/catalog" ? "page" : undefined} aria-label="Catálogo"><span className={classes.catalogLabel}>Catálogo</span><MaterialSymbol name="menu_book" context="header" className={classes.mobileCatalogIcon} /></UnstyledButton>
          </nav>
        </Group>
        <Group component="nav" aria-label="Búsqueda, carrito y cuenta" className={classes.actions} wrap="nowrap" gap={4}>
          <ActionIcon ref={searchTrigger} variant="subtle" className={classes.icon} aria-label="Buscar en el catálogo" title="Buscar" aria-haspopup="dialog" aria-expanded={panel === "search"} onClick={() => setPanel("search")}>
            <MaterialSymbol name="search" context="header" />
          </ActionIcon>
          <HeaderCart />
          <HeaderAccount opened={panel === "account"} onChange={(opened) => setPanel((current) => opened ? "account" : current === "account" ? null : current)} />
        </Group>
      </Group>
      <HeaderSearch criteria={criteria} opened={panel === "search"} onClose={(restoreFocus) => {
        setPanel(null);
        if (restoreFocus) requestAnimationFrame(() => searchTrigger.current?.focus({ preventScroll: true }));
      }} />
    </Box>
  );
}
