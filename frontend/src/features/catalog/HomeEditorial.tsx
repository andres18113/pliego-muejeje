import { Link } from "react-router-dom";
import type { EditionSummary, PublicCategory } from "@/shared/api/catalog";
import { MaterialSymbol } from "@/shared/ui/MaterialSymbol";
import { BookCover } from "./BookCover";
import { StockStatus } from "./StockStatus";
import { HomeActionLink } from "./HomeActions";
import { HomeMascot } from "./HomeMascot";
import { categoryGroups } from "./catalogCategories";
import { catalogHref, readCatalogCriteria } from "./catalogUrl";
import { useCategoryPreviews } from "./useCategoryPreviews";
import { formatEdition, formatUsd } from "./formatters";
import classes from "./homeEditorial.module.css";

const homeCategoryHref = (slug: string) => catalogHref({ ...readCatalogCriteria(""), category: slug });
const editionHref = (book: EditionSummary) => `/catalog/editions/${encodeURIComponent(book.editionId)}?from=${encodeURIComponent("/")}`;
const subjectCopy: Record<string, { message: string; symbol?: string }> = {
  filosofia: { message: "Una buena pregunta puede cambiarlo todo.", symbol: "?" },
  literatura: { message: "Hay otras vidas esperando entre estas páginas.", symbol: "¶" },
  matematicas: { message: "Encontrar el orden. Entender lo extraordinario.", symbol: "∑" },
};

export function HomeEditorial() {
  return <section className={classes.hero} aria-labelledby="page-title">
    <div className={classes.heroInner}>
      <div className={classes.heroCopy}>
        <h1 id="page-title">Abre un libro.<br />Mira más allá.</h1>
        <p>Para cambiar de idea, perderte en una historia o entender algo nuevo.</p>
        <HomeActionLink to="/catalog">Explorar libros</HomeActionLink>
      </div>
      <HomeMascot className={classes.heroMascot} />
    </div>
  </section>;
}

export function HomeCategories({ categories }: { categories: PublicCategory[] }) {
  const roots = categoryGroups(categories).map(({ category }) => category);
  const previews = useCategoryPreviews(roots);
  if (!roots.length) return null;
  return <nav id="explora-temas" className={classes.worlds} aria-label="Explora por tema">
    <div className={classes.worldsIntro}><h2 id="worlds-heading">{roots.length === 3 ? "Tres formas" : "Más formas"} de mirar.</h2><p>Piensa. Imagina. Comprende. Elige por dónde quieres empezar.</p></div>
    <ul className={classes.worldList}>{roots.map((category, index) => {
      const books = (previews[index]?.data?.items ?? []).slice(0, 2);
      const copy = subjectCopy[category.slug];
      return <li key={category.slug} className={classes.worldItem} data-world={category.slug}>
        <Link className={classes.worldLink} to={homeCategoryHref(category.slug)} aria-label={category.name}>
          <span className={classes.worldSymbol} aria-hidden="true">{copy?.symbol ?? category.name.charAt(0)}</span>
          <span className={classes.worldCopy}><span className={classes.worldName}>{category.name}</span><span className={classes.worldMessage}>{copy?.message ?? "Encuentra más libros para seguir descubriendo."}</span></span>
          <span className={classes.worldBooks} aria-hidden="true">{books.map((book) => <BookCover key={book.editionId} url={book.coverUrl} license={null} attribution={null} title={book.title} size="card" decorative />)}</span>
          <MaterialSymbol name="arrow_forward" size={28} className={classes.worldArrow} />
        </Link>
      </li>;
    })}</ul>
  </nav>;
}

export function HomeLiterature({ categories }: { categories: PublicCategory[] }) {
  const category = categories.find((item) => item.slug === "literatura");
  const previews = useCategoryPreviews(category ? [category] : []);
  const book = previews[0]?.data?.items[1] ?? previews[0]?.data?.items[0];
  if (!book || !category) return null;
  return <section className={classes.feature} aria-labelledby="literature-heading">
    <div className={classes.featureCopy}>
      <p className={classes.featureKicker}>Para leer despacio</p>
      <h2 id="literature-heading">{book.title}</h2>
      <p className={classes.featureAuthor}>{book.authors}</p>
      <p className={classes.featureEdition}>{book.publisher}, {formatEdition(book.format).toLocaleLowerCase("es")}</p>
      <div className={classes.featureCommerce}><strong>{formatUsd(book.price)}</strong><StockStatus available={book.available} size="compact" variant="text" /></div>
      <div className={classes.featureActions}>
        <HomeActionLink to={editionHref(book)} tone="yellow">Ver esta edición</HomeActionLink>
        <Link className={classes.featureMore} to={homeCategoryHref(category.slug)}>Explorar Literatura</Link>
      </div>
    </div>
    <Link to={editionHref(book)} className={classes.featureArt} tabIndex={-1} aria-hidden="true"><span className={classes.featureStage}><BookCover url={book.coverUrl} license={null} attribution={null} title={book.title} size="card" decorative /></span></Link>
  </section>;
}
