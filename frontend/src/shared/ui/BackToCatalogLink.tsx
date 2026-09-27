import { ArrowLeft } from "lucide-react";
import { Link } from "react-router-dom";

export function BackToCatalogLink({
  to,
  placement = "page",
}: {
  to: string;
  placement?: "page" | "footer";
}) {
  const inFooter = placement === "footer";

  return (
    <Link className={inFooter ? "back-to-top" : "back-to-catalog"} to={to}>
      <ArrowLeft aria-hidden="true" size={inFooter ? 15 : 16} strokeWidth={inFooter ? 1.8 : undefined} />
      <span>Volver al catálogo</span>
    </Link>
  );
}
