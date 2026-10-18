import { MaterialSymbol } from "@/shared/ui/MaterialSymbol";
import type { MouseEvent, ReactNode } from "react";
import { useContext } from "react";
import { BackNavigationContext } from "@/app/navigation/BackNavigationContext";
import { safeAuthReturnHref } from "@/features/auth/authLocation";
import { Link, useNavigate } from "react-router-dom";

export function CatalogReturnLink({
  to,
  historyBack = false,
  className,
  children,
}: {
  to: string;
  historyBack?: boolean;
  className?: string;
  children: ReactNode;
}) {
  const navigate = useNavigate();
  const back = useContext(BackNavigationContext);

  function returnToPreviousPage(event: MouseEvent<HTMLAnchorElement>) {
    if (!historyBack || event.defaultPrevented || event.button !== 0
        || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    if (back?.canGoBack) back.goBack();
    else void navigate(safeAuthReturnHref(to), { replace: true });
  }

  return <Link className={className} to={to} onClick={returnToPreviousPage}>{children}</Link>;
}

export function BackToCatalogLink({
  to,
  placement = "page",
  historyBack = false,
}: {
  to: string;
  placement?: "page" | "footer";
  historyBack?: boolean;
}) {
  const inFooter = placement === "footer";
  const pathname = new URL(to, window.location.origin).pathname.replace(/\/+$/, "") || "/";
  const label = /^\/catalog\/editions\//.test(pathname) ? "Volver a la edición"
    : pathname === "/ofertas" ? "Volver a Ofertas"
    : pathname === "/favorites" ? "Volver a Favoritos"
    : pathname === "/cart" ? "Volver al carrito"
    : pathname === "/checkout" ? "Volver a finalizar la compra"
    : pathname === "/account" ? "Volver a mi cuenta"
    : pathname === "/account/addresses" ? "Volver a mis direcciones"
    : pathname === "/orders" ? "Volver a mis pedidos"
    : /^\/orders\/[1-9][0-9]*$/.test(pathname) ? "Volver al pedido"
    : pathname === "/biblioteca" ? "Volver a mi biblioteca"
    : /^\/biblioteca\/[1-9][0-9]*$/.test(pathname) ? "Volver a la edición de mi biblioteca"
    : pathname === "/" ? "Volver al inicio"
    : "Volver al catálogo";

  return (
    <CatalogReturnLink className={inFooter ? "back-to-top" : "back-to-catalog"} to={to} historyBack={historyBack}>
      <MaterialSymbol name="arrow_back" aria-hidden="true" size={inFooter ? 15 : 16} />
      <span>{label}</span>
    </CatalogReturnLink>
  );
}
