import { useEffect } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import type { HelpCriteria } from "@/shared/api/help";
import { MaterialSymbol, type MaterialSymbolName } from "@/shared/ui/MaterialSymbol";
import { NotFoundScene } from "@/shared/ui/NotFoundScene";
import { SiteFooter } from "@/shared/ui/SiteFooter";
import { useHelpArticle, useHelpArticles, useHelpCategories } from "./helpQuery";
import classes from "./help.module.css";

const applicabilityLabels = { GENERAL: "General", PHYSICAL: "Libros físicos", EBOOK: "eBooks", AUDIOBOOK: "Audiolibros" } as const;

/** A resource's symbol comes from its published topic; a topic without one of its own falls back to what the article applies to. */
const topicSymbols: Record<string, MaterialSymbolName> = { compras: "shopping_bag", retiro: "storefront", pagos: "payments", "cancelaciones-y-reembolsos": "currency_exchange", "cuenta-y-correo": "person", "entrega-a-domicilio": "local_shipping", ebooks: "mobile", audiolibros: "headphones" };
const applicabilitySymbols: Record<keyof typeof applicabilityLabels, MaterialSymbolName> = { GENERAL: "help", PHYSICAL: "local_shipping", EBOOK: "mobile", AUDIOBOOK: "headphones" };
const resourceSymbol = (article: { categorySlug: string; applicability: keyof typeof applicabilityLabels }) => topicSymbols[article.categorySlug] ?? applicabilitySymbols[article.applicability];

/**
 * Ayuda: a calm opening ("Estamos aquí para ayudarte.") and the published articles as support-resource cards —
 * resources first, no search or filter controls. The cards are the API's articles; topic, applicability, search
 * and page stay in the URL (links from articles and other pages use them) and are answered by the API.
 */
export function HelpPage() {
  const [params, setParams] = useSearchParams();
  const pageValue = Number(params.get("page") ?? 0);
  const applicability = params.get("applicability");
  const criteria: HelpCriteria = { query: params.get("que") ?? "", category: params.get("category") ?? "", applicability: applicability === "GENERAL" || applicability === "PHYSICAL" || applicability === "EBOOK" || applicability === "AUDIOBOOK" ? applicability : "", page: Number.isSafeInteger(pageValue) && pageValue >= 0 ? pageValue : 0, pageSize: 20 };
  const categories = useHelpCategories();
  const articles = useHelpArticles(criteria);
  const state = articles.viewState;
  const topicTitle = (slug: string) => categories.data?.find(category => category.slug === slug)?.title;
  // What the address narrows the resources to, in the customer's words; nothing when it shows everything.
  const scope = [criteria.category ? topicTitle(criteria.category) : null, criteria.applicability ? applicabilityLabels[criteria.applicability] : null, criteria.query ? `«${criteria.query}»` : null].filter((part): part is string => Boolean(part));
  const narrowed = Boolean(criteria.category || criteria.applicability || criteria.query);
  function goToPage(page: number) { const next = new URLSearchParams(params); if (page > 0) next.set("page", String(page)); else next.delete("page"); setParams(next); }
  useEffect(() => { document.title = "Ayuda · PLIEGO"; }, []);
  return <>
    <main className={`page-frame ${classes.page} ${classes.landing}`} id="contenido-principal" tabIndex={-1} data-storefront-surface>
      <header className={classes.masthead}>
        <h1 className={classes.title}>Estamos aquí para ayudarte.</h1>
      </header>

      <section className={classes.resources} aria-labelledby="help-resources-heading">
        <h2 id="help-resources-heading" className={classes.resourcesTitle}>Echa un vistazo a estos recursos de asistencia</h2>
        {narrowed && <p className={classes.scope}>{scope.length > 0 && <span>Recursos sobre {scope.join(", ")}.</span>} <Link to="/ayuda">Ver todos los recursos</Link></p>}

        {state.status === "loading" && <>
          <p className="visually-hidden" role="status">Cargando Ayuda…</p>
          <ul className={`${classes.cards} ${classes.pending}`} aria-hidden="true">{[0, 1, 2].map(card => <li key={card} className={classes.card}><span /><span /><span /></li>)}</ul>
        </>}
        {state.status === "error" && <div className={classes.notice} role="alert">
          <h3>{state.title}</h3>
          <p>{state.detail}</p>
          <button type="button" className={classes.action} onClick={() => void articles.refetch()}>Reintentar</button>
        </div>}
        {state.status === "empty" && <div className={classes.notice} data-kind="empty">
          {criteria.page > 0
            ? <><h3>No hay más recursos en esta página.</h3><button type="button" className={classes.action} onClick={() => goToPage(0)}>Ir a la primera página</button></>
            : <>
              <h3>{narrowed ? "No encontramos recursos para esto." : "Aún no hay recursos publicados."}</h3>
              {narrowed && <Link className={classes.action} to="/ayuda">Ver todos los recursos</Link>}
            </>}
        </div>}
        {state.status === "ready" && <>
          <ul className={classes.cards}>{state.data.items.map(article => {
            const topic = topicTitle(article.categorySlug);
            const medium = article.applicability !== "GENERAL" ? applicabilityLabels[article.applicability] : null;
            return <li key={article.slug} className={classes.card}>
              <MaterialSymbol name={resourceSymbol(article)} size={28} className={classes.cardSymbol} />
              <h3 className={classes.cardTitle}><Link to={`/ayuda/${encodeURIComponent(article.slug)}`}>{article.title}</Link></h3>
              {article.summary && <p className={classes.cardSummary}>{article.summary}</p>}
              <p className={classes.cardMeta}>
                <span className={classes.cardTopics}>{topic && topic !== article.title && <span>{topic}</span>}{medium && medium !== article.title && medium !== topic && <span>{medium}</span>}</span>
                <MaterialSymbol name="arrow_forward" className={classes.cardGo} />
              </p>
            </li>;
          })}</ul>
          {BigInt(state.data.totalCount) > BigInt(criteria.pageSize) && <nav className={classes.pages} aria-label="Páginas de Ayuda">
            <button type="button" className={classes.pageStep} disabled={criteria.page === 0} onClick={() => goToPage(criteria.page - 1)}><MaterialSymbol name="arrow_back" />Anterior</button>
            <span className={classes.pagePosition}>Página {criteria.page + 1} de {Math.ceil(Number(state.data.totalCount) / criteria.pageSize)}</span>
            <button type="button" className={classes.pageStep} disabled={BigInt((criteria.page + 1) * criteria.pageSize) >= BigInt(state.data.totalCount)} onClick={() => goToPage(criteria.page + 1)}>Siguiente<MaterialSymbol name="arrow_forward" /></button>
          </nav>}
        </>}
      </section>
    </main>
    <SiteFooter />
  </>;
}

export function HelpArticlePage() {
  const { slug = "" } = useParams();
  const query = useHelpArticle(slug);
  const categories = useHelpCategories();
  const state = query.viewState;
  const article = state.status === "ready" ? state.data : null;
  const topic = article ? categories.data?.find(category => category.slug === article.categorySlug) : undefined;
  useEffect(() => { document.title = article ? `${article.title} · Ayuda · PLIEGO` : "Ayuda · PLIEGO"; }, [article]);
  return <>
    <main className={`page-frame ${classes.page} ${classes.reading}`} id="contenido-principal" tabIndex={-1} data-storefront-surface>
      <Link to="/ayuda" className={classes.back}><MaterialSymbol name="arrow_back" /><span>Volver a Ayuda</span></Link>
      {state.status === "loading" && <>
        <p className="visually-hidden" role="status">Cargando artículo…</p>
        <div className={`${classes.article} ${classes.pending}`} aria-hidden="true"><span /><span /><span /><span /></div>
      </>}
      {state.status === "error" && (state.httpStatus === 404
        ? <div role="alert"><NotFoundScene /></div>
        : <section className={classes.notice} role="alert">
          <h1>{state.title}</h1>
          <p>{state.detail}</p>
          <button type="button" className={classes.action} onClick={() => void query.refetch()}>Reintentar</button>
        </section>)}
      {article && <>
        <article className={classes.article}>
          <p className={classes.context}>
            {topic && <Link to={`/ayuda?category=${encodeURIComponent(topic.slug)}`}>{topic.title}</Link>}
            {article.applicability !== "GENERAL" && applicabilityLabels[article.applicability] !== topic?.title && <span>{applicabilityLabels[article.applicability]}</span>}
          </p>
          <h1 className={classes.articleTitle}>{article.title}</h1>
          {article.summary && <p className={classes.lead}>{article.summary}</p>}
          {/* Plain text only: paragraphs are split on blank lines and markup-like strings stay text. */}
          <div className={classes.body}>{article.body.split(/\n\s*\n/).map((paragraph, index) => <p key={index}>{paragraph}</p>)}</div>
        </article>
        <aside className={classes.onward} aria-label="Más ayuda">
          <h2>¿Necesitas algo más?</h2>
          <div className={classes.onwardLinks}>
            {topic && <Link to={`/ayuda?category=${encodeURIComponent(topic.slug)}`}>Más sobre {topic.title}</Link>}
            <Link to="/ayuda">Ver todos los recursos de Ayuda</Link>
          </div>
        </aside>
      </>}
    </main>
    <SiteFooter />
  </>;
}
