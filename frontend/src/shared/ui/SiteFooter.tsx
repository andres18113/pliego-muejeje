import { Link, useLocation } from "react-router-dom";
import { BackToCatalogLink } from "@/shared/ui/BackToCatalogLink";
import classes from "./SiteFooter.module.css";

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
  // Every other page: the same closing, quiet on paper — the wordmark, its line, the way back and the same three places.
  return (
    <footer className={classes.footer}>
      <div className={`page-frame ${classes.content}`}>
        <div className={classes.brand}>
          <Link className={classes.wordmark} to="/">PLIEGO<span aria-hidden="true">.</span></Link>
          <p>Libros para mirar el mundo de otra manera.</p>
        </div>
        <nav className={classes.nav} aria-label="Navegación del pie de página">
          <BackToCatalogLink to={returnHref} placement="footer" historyBack={historyBack} />
          <Link to="/catalog">Todos los libros</Link>
          <Link to="/favorites">Favoritos</Link>
          <Link to="/cart">Carrito</Link>
        </nav>
      </div>
    </footer>
  );
}
