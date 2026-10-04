import { Link, useLocation } from "react-router-dom";
import { BackToCatalogLink } from "@/shared/ui/BackToCatalogLink";

export function SiteFooter({ returnHref = "/catalog", historyBack = false }: { returnHref?: string; historyBack?: boolean }) {
  const { pathname } = useLocation();
  if (pathname === "/" || pathname === "/catalog") return (
    <footer className="site-footer storefront-footer">
      <div className="footer-content">
        <div><Link className="footer-wordmark" to="/">PLIEGO</Link><p>Libros para mirar el mundo de otra manera.</p></div>
        <nav aria-label="Navegación del pie de página"><Link to="/catalog">Todos los libros</Link><Link to="/favorites">Favoritos</Link><Link to="/cart">Carrito</Link></nav>
      </div>
    </footer>
  );
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
