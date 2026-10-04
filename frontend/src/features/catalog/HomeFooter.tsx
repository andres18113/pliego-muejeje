import { Box } from "@mantine/core";
import { Link } from "react-router-dom";
import type { PublicCategory } from "@/shared/api/catalog";
import { categoryGroups } from "./catalogCategories";
import { catalogHref, readCatalogCriteria } from "./catalogUrl";
import classes from "./homeFooter.module.css";

export function HomeFooter({ categories }: { categories: PublicCategory[] }) {
  const roots = categoryGroups(categories).map(({ category }) => category);
  return <Box component="footer" className={classes.footer}>
    <div className={classes.inner}>
      <div className={classes.top}>
        <h2>Una página<br />lleva a otra.</h2>
        <nav aria-label="Navegación del pie de página" className={classes.navigation}>
          <div><h3>Encuentra tu lectura</h3><Link to="/catalog">Todos los libros</Link>{roots.map((category) => <Link to={catalogHref({ ...readCatalogCriteria(""), category: category.slug })} key={category.slug}>{category.name}</Link>)}</div>
          <div><h3>Tu librería</h3><Link to="/favorites">Favoritos</Link><Link to="/cart">Carrito</Link><Link to="/account">Mi cuenta</Link></div>
        </nav>
      </div>
      <div className={classes.signature}><Link to="/" aria-label="PLIEGO, ir al inicio">PLIEGO</Link><p>Libros para mirar el mundo de otra manera.</p></div>
    </div>
  </Box>;
}
