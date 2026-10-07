import { Link } from "react-router-dom";
import { BackToCatalogLink } from "@/shared/ui/BackToCatalogLink";
import { BrandLogo } from "@/shared/ui/BrandLogo";
import classes from "./SiteFooter.module.css";

export function SiteFooter({ returnHref = "/catalog", historyBack = false }: { returnHref?: string; historyBack?: boolean }) {
  // The compact closing of every page under the storefront's front pages (Home and Catalog end on the full storefront footer).
  return (
    <footer className={classes.footer}>
      <div className={`page-frame ${classes.content}`}>
        <div className={classes.brand}>
          <Link className={classes.wordmark} to="/" aria-label="PLIEGO"><BrandLogo /></Link>
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
