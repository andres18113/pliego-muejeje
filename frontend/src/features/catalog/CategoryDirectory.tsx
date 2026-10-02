import { UnstyledButton } from "@mantine/core";
import { Link } from "react-router-dom";
import type { PublicCategory } from "@/shared/api/catalog";
import { catalogHref, type CatalogCriteria } from "./catalogUrl";
import { categoryGroups, type CategoryGroup } from "./catalogCategories";
import classes from "./exploration.module.css";
export function CategoryDirectory({ categories, criteria, home = false, loading = false, error = "" }: {
  categories: PublicCategory[]; criteria: CatalogCriteria; home?: boolean; loading?: boolean; error?: string;
}) {
  const groups = categoryGroups(categories);
  function links(items: CategoryGroup[]) {
    return items.map(({ category, children }) => <li key={category.slug}>
      <UnstyledButton component={Link} className={classes.topicLink} to={catalogHref({ ...criteria, category: category.slug, page: 0 })} aria-current={!home && criteria.category === category.slug ? "page" : undefined}>{category.name}</UnstyledButton>
      {children.length > 0 && <ul className={classes.subtopics}>{links(children)}</ul>}
    </li>);
  }
  if (home && !groups.length && !loading && !error) return null;
  return <nav aria-label={home ? "Explora por tema" : "Temas del catálogo"} className={home ? classes.homeTopics : classes.topics}>
    {home && <h2 className={classes.sectionTitle}>Explora por tema</h2>}
    <ul className={classes.topicList} data-home={home}>
      {!home && <li><UnstyledButton component={Link} className={classes.topicLink} to={catalogHref({ ...criteria, category: "", page: 0 })} aria-current={!criteria.category ? "page" : undefined}>Todos los libros</UnstyledButton></li>}
      {links(groups)}
    </ul>
    {loading && !groups.length && <p className={classes.note} role="status">Cargando temas…</p>}
    {error && <p className={classes.note} role="alert">No pudimos actualizar los temas. {groups.length ? "Mostramos los últimos disponibles." : "Puedes seguir explorando los libros."}</p>}
  </nav>;
}
