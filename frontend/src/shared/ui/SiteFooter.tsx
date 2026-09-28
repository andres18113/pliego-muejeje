import { Link } from "react-router-dom";
import { BackToCatalogLink } from "@/shared/ui/BackToCatalogLink";

export function SiteFooter({ returnHref = "/catalog" }: { returnHref?: string }) {
  return (
    <footer className="site-footer">
      <div className="page-frame footer-content">
        <Link className="footer-wordmark" to="/">PLIEGO</Link>
        <p>Catálogo público</p>
        <BackToCatalogLink to={returnHref} placement="footer" />
      </div>
    </footer>
  );
}
