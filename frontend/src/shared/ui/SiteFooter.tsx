import { Link, useLocation } from "react-router-dom";
import { BackToCatalogLink } from "@/shared/ui/BackToCatalogLink";

export function SiteFooter({ returnHref = "/catalog", historyBack = false }: { returnHref?: string; historyBack?: boolean }) {
  const { pathname } = useLocation();
  return (
    <footer className="site-footer">
      <div className="page-frame footer-content">
        <Link className="footer-wordmark" to="/">PLIEGO</Link>
        <p>Catálogo público</p>
        {pathname !== "/" && pathname !== "/catalog" && <BackToCatalogLink to={returnHref} placement="footer" historyBack={historyBack} />}
      </div>
    </footer>
  );
}
