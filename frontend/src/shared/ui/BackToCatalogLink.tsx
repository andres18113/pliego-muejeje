import { MaterialSymbol } from "@/shared/ui/MaterialSymbol";
import type { MouseEvent, ReactNode } from "react";
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

  function returnToPreviousPage(event: MouseEvent<HTMLAnchorElement>) {
    if (!historyBack || event.defaultPrevented || event.button !== 0
        || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    navigate(-1);
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

  return (
    <CatalogReturnLink className={inFooter ? "back-to-top" : "back-to-catalog"} to={to} historyBack={historyBack}>
      <MaterialSymbol name="arrow_back" aria-hidden="true" size={inFooter ? 15 : 16} />
      <span>Volver al catálogo</span>
    </CatalogReturnLink>
  );
}
