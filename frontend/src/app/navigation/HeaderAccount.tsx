import { ActionIcon, Menu, Text, VisuallyHidden } from "@mantine/core";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { useSession } from "@/app/session";
import { authLocation, safeAuthReturnHref } from "@/features/auth/authLocation";
import { cartUnitCount, useCustomerCart } from "@/features/purchase/cartQuery";
import { getProfile, profileQueryKey } from "@/shared/api/customer";
import { ApiRequestError } from "@/shared/api/errors";
import { MaterialSymbol } from "@/shared/ui/MaterialSymbol";
import classes from "./SiteHeader.module.css";

export function HeaderCart() {
  const { session } = useSession();
  const location = useLocation();
  const isCustomer = session?.user.role === "CUSTOMER";
  const cart = useCustomerCart(isCustomer, { fresh: false });
  const units = cart.data ? cartUnitCount(cart.data.items) : null;
  const detail = units === null ? (cart.isError ? "unidades no disponibles" : "consultando unidades") : units === 1 ? "1 unidad" : `${units} unidades`;
  if (session?.user.role === "ADMIN") return null;
  return (
    <ActionIcon component={Link} to="/cart" variant="subtle" className={classes.icon} aria-label={isCustomer ? `Carrito, ${detail}` : "Carrito"} title="Carrito" aria-current={location.pathname === "/cart" ? "page" : undefined}>
      <MaterialSymbol name="shopping_cart" context="header" />
      {isCustomer && units !== null && units > 0 && <span className={classes.cartCount} aria-hidden="true" data-testid="header-cart-count">{units > 99 ? "99+" : units}</span>}
      {isCustomer && <VisuallyHidden aria-live="polite" aria-atomic="true">{detail}</VisuallyHidden>}
    </ActionIcon>
  );
}

export function HeaderAccount({ opened, onChange }: { opened: boolean; onChange: (opened: boolean) => void }) {
  const { session, clear, logout } = useSession();
  const location = useLocation();
  const trigger = useRef<HTMLButtonElement>(null);
  const dropdown = useRef<HTMLDivElement>(null);
  const [loggingOut, setLoggingOut] = useState(false);
  const [logoutError, setLogoutError] = useState(false);
  const isCustomer = session?.user.role === "CUSTOMER";
  const profile = useQuery({
    queryKey: profileQueryKey,
    queryFn: ({ signal }) => getProfile(signal),
    enabled: opened && isCustomer,
    meta: { authRequired: true },
    staleTime: 60_000,
    retry: false,
  });
  useEffect(() => {
    if (session && profile.error instanceof ApiRequestError && profile.error.status === 401) clear("expired");
  }, [clear, profile.error, session]);
  useEffect(() => {
    if (!session) { setLogoutError(false); setLoggingOut(false); }
  }, [session]);

  const returnTo = safeAuthReturnHref(location.pathname === "/sign-in" || location.pathname === "/register"
    ? new URLSearchParams(location.search).get("from") : `${location.pathname}${location.search}`);
  if (!session) return (
    <ActionIcon component={Link} to={authLocation("/sign-in", returnTo)} variant="subtle" className={classes.icon} aria-label="Iniciar sesión" title="Iniciar sesión">
      <MaterialSymbol name="account_circle" context="header" />
    </ActionIcon>
  );

  async function signOut() {
    if (loggingOut) return;
    setLoggingOut(true);
    setLogoutError(false);
    try { await logout(); onChange(false); }
    catch { setLogoutError(true); onChange(true); }
    finally { setLoggingOut(false); }
  }

  return (
    <Menu opened={opened} onChange={onChange} withInitialFocusPlaceholder={false} position="bottom-end" offset={12} width={272} zIndex={70} returnFocus={false} transitionProps={{ duration: 0 }} classNames={{ dropdown: classes.accountPanel, item: classes.accountItem }}>
      <Menu.Target>
        <ActionIcon ref={trigger} variant="subtle" className={classes.icon} aria-label="Menú de cuenta" title="Mi cuenta" onKeyDown={(event) => {
          if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
          event.preventDefault();
          onChange(true);
          const last = event.key === "ArrowUp";
          requestAnimationFrame(() => {
            const items = dropdown.current?.querySelectorAll<HTMLElement>('[role="menuitem"]');
            items?.[last ? items.length - 1 : 0]?.focus();
          });
        }}>
          <MaterialSymbol name="account_circle" context="header" />
        </ActionIcon>
      </Menu.Target>
      <Menu.Dropdown ref={dropdown} onKeyDown={(event) => {
        if (event.key === "Escape") requestAnimationFrame(() => trigger.current?.focus({ preventScroll: true }));
      }}>
        <div className={classes.identity}>
          <Text fw={600} size="sm">{isCustomer && profile.data ? `${profile.data.firstNames} ${profile.data.lastNames}` : isCustomer ? "Tu cuenta" : "Administración"}</Text>
          <Text size="xs" className={classes.muted}>{session.user.email}</Text>
          {profile.isError && <Text size="xs" className={classes.muted}>No pudimos consultar tu nombre.</Text>}
        </div>
        <Menu.Divider />
        {isCustomer ? <>
          <Menu.Item component={Link} to="/account" data-autofocus leftSection={<MaterialSymbol name="account_circle" />} aria-current={location.pathname.startsWith("/account") ? "page" : undefined}>Mi cuenta</Menu.Item>
          <Menu.Item component={Link} to="/orders" leftSection={<MaterialSymbol name="shopping_bag" />} aria-current={location.pathname.startsWith("/orders") ? "page" : undefined}>Mis pedidos</Menu.Item>
          <Menu.Item component={Link} to="/favorites" leftSection={<MaterialSymbol name="favorite" />} aria-current={location.pathname === "/favorites" ? "page" : undefined}>Favoritos</Menu.Item>
        </> : <Menu.Item component={Link} to="/admin" data-autofocus leftSection={<MaterialSymbol name="inventory_2" />}>Administración</Menu.Item>}
        <Menu.Divider />
        {logoutError && <Text role="alert" size="sm" className={classes.error}>No se pudo cerrar la sesión. Comprueba tu conexión e inténtalo otra vez.</Text>}
        <Menu.Item closeMenuOnClick={false} disabled={loggingOut} onClick={() => void signOut()} leftSection={<MaterialSymbol name="logout" />}>{loggingOut ? "Cerrando sesión…" : "Cerrar sesión"}</Menu.Item>
      </Menu.Dropdown>
    </Menu>
  );
}
