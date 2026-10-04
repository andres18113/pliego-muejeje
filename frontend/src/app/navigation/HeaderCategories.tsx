import { Button, UnstyledButton } from "@mantine/core";
import { Link } from "react-router-dom";
import type { PublicCategory } from "@/shared/api/catalog";
import { BookCover } from "@/features/catalog/BookCover";
import { categoryGroups } from "@/features/catalog/catalogCategories";
import { catalogHref, readCatalogCriteria } from "@/features/catalog/catalogUrl";
import { useCategoryPreviews } from "@/features/catalog/useCategoryPreviews";
import { MaterialSymbol } from "@/shared/ui/MaterialSymbol";
import classes from "./SiteHeader.module.css";

export function HeaderCategories({ categories, selected, onSelect, loading, error, onRetry }: {
  categories: PublicCategory[]; selected: string; onSelect: (slug: string) => void; loading: boolean; error: boolean; onRetry: () => void;
}) {
  const groups = categoryGroups(categories);
  const group = groups.find(({ category }) => category.slug === selected);
  const roots = groups.map(({ category }) => category);
  const previews = useCategoryPreviews(roots);
  const books = previews[roots.findIndex((item) => item.slug === selected)]?.data?.items ?? [];
  const destination = (slug: string) => catalogHref({ ...readCatalogCriteria(""), category: slug });
  return <nav className={classes.megaPanel} aria-label="Explora las categorías">
    {loading && <p role="status">Cargando categorías…</p>}
    {error && <div role="alert"><p>No pudimos actualizar las categorías.</p><Button variant="subtle" onClick={onRetry}>Reintentar</Button></div>}
    {!group ? <ul className={classes.categoryList}>
      <li><Link to="/catalog" className={classes.categoryRow}>Todos los libros<MaterialSymbol name="arrow_forward" /></Link></li>
      {roots.map((item, index) => <li key={item.slug}><UnstyledButton className={classes.categoryRow} onClick={() => onSelect(item.slug)}>{item.name}<span className={classes.categoryThumb}>{previews[index]?.data?.items[0] ? <BookCover url={previews[index].data!.items[0].coverUrl} title={item.name} license={null} attribution={null} decorative size="card" /> : <MaterialSymbol name="menu_book" />}</span></UnstyledButton></li>)}
    </ul> : <>
      <UnstyledButton className={classes.menuBack} onClick={() => onSelect("")}><MaterialSymbol name="arrow_back" />Categorías</UnstyledButton>
      <div className={classes.megaColumns}>
        <section className={classes.menuBooks} aria-label={group.category.name}>
          <h2>{group.category.name}</h2>
          <ul className={classes.menuBookGrid}>{books.map((book) => <li key={book.editionId}><Link className={classes.menuBook} to={`/catalog/editions/${book.editionId}?from=${encodeURIComponent(destination(selected))}`}>
            <div><BookCover url={book.coverUrl} license={null} attribution={null} title={book.title} size="card" decorative /></div><span>{book.title}</span>
          </Link></li>)}</ul>
          <Link className={classes.browseCategory} to={destination(selected)}>Ver todos los libros de {group.category.name}<MaterialSymbol name="arrow_forward" /></Link>
          {previews[roots.findIndex((item) => item.slug === selected)]?.isError && <p role="status">No pudimos cargar las portadas. Puedes explorar esta categoría.</p>}
        </section>
        {group.children.length > 0 && <section className={classes.moreCategories}><h2>Explorar {group.category.name}</h2><ul>{group.children.map(({ category: item }) => <li key={item.slug}><Link to={destination(item.slug)}>{item.name}</Link></li>)}</ul></section>}
        <section className={classes.moreCategories}><h2>Más categorías</h2><ul>{roots.filter((item) => item.slug !== selected).map((item) => <li key={item.slug}><UnstyledButton onClick={() => onSelect(item.slug)}>{item.name}<MaterialSymbol name="chevron_right" size={20} /></UnstyledButton></li>)}</ul></section>
      </div>
    </>}
  </nav>;
}
