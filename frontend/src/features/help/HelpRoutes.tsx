import { useEffect, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import type { HelpCriteria } from "@/shared/api/help";
import { MaterialSymbol } from "@/shared/ui/MaterialSymbol";
import { SiteFooter } from "@/shared/ui/SiteFooter";
import { useHelpArticle, useHelpArticles, useHelpCategories } from "./helpQuery";
import classes from "./help.module.css";

const applicabilityLabels = { GENERAL: "General", PHYSICAL: "Libros físicos", EBOOK: "eBooks", AUDIOBOOK: "Audiolibros" } as const;
const articlesCountLabel = (totalCount: string) => `${totalCount} ${totalCount === "1" ? "artículo" : "artículos"}`;

/**
 * Ayuda: the name and one line on the paper, one search field, the published topics as chips, then the
 * articles as a typographic index. Search, topic and applicability stay in the URL and are answered by the API.
 */
export function HelpPage() {
  const [params, setParams] = useSearchParams();
  const [queryText, setQueryText] = useState(params.get("que") ?? "");
  const pageValue = Number(params.get("page") ?? 0);
  const applicability = params.get("applicability");
  const criteria: HelpCriteria = { query: params.get("que") ?? "", category: params.get("category") ?? "", applicability: applicability === "GENERAL" || applicability === "PHYSICAL" || applicability === "EBOOK" || applicability === "AUDIOBOOK" ? applicability : "", page: Number.isSafeInteger(pageValue) && pageValue >= 0 ? pageValue : 0, pageSize: 20 };
  const categories = useHelpCategories();
  const articles = useHelpArticles(criteria);
  const state = articles.viewState;
  const narrowed = Boolean(criteria.category || criteria.applicability);
  const topicTitle = (slug: string) => categories.data?.find(category => category.slug === slug)?.title;
  function change(name: string, value: string) { const next = new URLSearchParams(params); next.delete("page"); if (value) next.set(name, value); else next.delete(name); setParams(next); }
  function goToPage(page: number) { const next = new URLSearchParams(params); if (page > 0) next.set("page", String(page)); else next.delete("page"); setParams(next); }
  function showEverything() { setQueryText(""); setParams(new URLSearchParams()); }
  useEffect(() => { document.title = "Ayuda · PLIEGO"; }, []);
  return <>
    <main className={`page-frame ${classes.page}`} id="contenido-principal" tabIndex={-1} data-storefront-surface>
      <header className={classes.masthead}>
        <h1 className={classes.title}>Ayuda</h1>
        <p className={classes.intro}>Respuestas sobre tus compras, entregas, pagos y tu biblioteca digital.</p>
      </header>

      <form className={classes.search} role="search" onSubmit={event => { event.preventDefault(); change("que", queryText.trim()); }}>
        <div className={classes.searchField}>
          <MaterialSymbol name="search" size={24} />
          <input name="que" type="search" aria-label="Buscar en Ayuda" autoComplete="off" placeholder="Describe lo que necesitas" value={queryText} onChange={event => setQueryText(event.currentTarget.value)} />
        </div>
        <button type="submit" className={classes.searchSubmit}>Buscar</button>
      </form>

      {categories.isPending && <p className="visually-hidden" role="status">Cargando temas…</p>}
      {categories.isError && <p className={classes.note} role="alert">No pudimos consultar los temas. <button type="button" className={classes.textAction} onClick={() => void categories.refetch()}>Reintentar temas</button></p>}
      {categories.data && categories.data.length > 0 && <div className={classes.topics} role="group" aria-label="Tema">
        <button type="button" className={classes.chip} aria-pressed={!criteria.category} onClick={() => change("category", "")}>Todos los temas</button>
        {categories.data.map(category => <button type="button" className={classes.chip} key={category.slug} aria-pressed={criteria.category === category.slug} onClick={() => change("category", category.slug)}>{category.title}</button>)}
      </div>}

      <div className={classes.toolbar}>
        <p className={classes.count} role="status">{state.status === "ready" ? articlesCountLabel(state.data.totalCount) : ""}</p>
        <label className={classes.control}><span>Tipo de compra</span>
          <span className={classes.select}><select aria-label="Tipo de compra" value={criteria.applicability} onChange={event => change("applicability", event.currentTarget.value)}>
            <option value="">Todos</option>
            {Object.entries(applicabilityLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select><MaterialSymbol name="expand_more" size={20} /></span>
        </label>
      </div>

      {state.status === "loading" && <>
        <p className="visually-hidden" role="status">Cargando Ayuda…</p>
        <ul className={`${classes.index} ${classes.pending}`} aria-hidden="true">{[0, 1, 2, 3].map(row => <li key={row}><span /><span /></li>)}</ul>
      </>}
      {state.status === "error" && <section className={classes.notice} role="alert">
        <h2>{state.title}</h2>
        <p>{state.detail}</p>
        <button type="button" className={classes.action} onClick={() => void articles.refetch()}>Reintentar</button>
      </section>}
      {state.status === "empty" && <section className={classes.notice} data-kind="empty">
        {criteria.page > 0
          ? <><h2>No hay más artículos en esta página.</h2><button type="button" className={classes.action} onClick={() => goToPage(0)}>Ir a la primera página</button></>
          : <>
            <h2>{criteria.query ? "No encontramos artículos para esta búsqueda." : "No hay artículos con estos filtros."}</h2>
            <p>{criteria.query ? "Prueba con otras palabras o recorre los temas." : "Elige otro tema o tipo de compra."}</p>
            {(criteria.query || narrowed) && <button type="button" className={classes.action} onClick={showEverything}>Ver toda la Ayuda</button>}
          </>}
      </section>}
      {state.status === "ready" && <>
        <ul className={classes.index}>{state.data.items.map(article => {
          const topic = topicTitle(article.categorySlug);
          return <li key={article.slug}>
            <div className={classes.entry}>
              <h2 className={classes.entryTitle}><Link to={`/ayuda/${encodeURIComponent(article.slug)}`}>{article.title}</Link></h2>
              <p className={classes.entrySummary}>{article.summary}</p>
              <p className={classes.entryMeta}>{topic && topic !== article.title && <span>{topic}</span>}{article.applicability !== "GENERAL" && applicabilityLabels[article.applicability] !== article.title && <span>{applicabilityLabels[article.applicability]}</span>}</p>
            </div>
            <MaterialSymbol name="arrow_forward" className={classes.entryGo} />
          </li>;
        })}</ul>
        {BigInt(state.data.totalCount) > BigInt(criteria.pageSize) && <nav className={classes.pages} aria-label="Páginas de Ayuda">
          <button type="button" className={classes.pageStep} disabled={criteria.page === 0} onClick={() => goToPage(criteria.page - 1)}><MaterialSymbol name="arrow_back" />Anterior</button>
          <span className={classes.pagePosition}>Página {criteria.page + 1} de {Math.ceil(Number(state.data.totalCount) / criteria.pageSize)}</span>
          <button type="button" className={classes.pageStep} disabled={BigInt((criteria.page + 1) * criteria.pageSize) >= BigInt(state.data.totalCount)} onClick={() => goToPage(criteria.page + 1)}>Siguiente<MaterialSymbol name="arrow_forward" /></button>
        </nav>}
      </>}
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
      {state.status === "error" && <section className={classes.notice} role="alert">
        <h1>{state.httpStatus === 404 ? "Artículo no disponible" : state.title}</h1>
        <p>{state.detail}</p>
        {state.httpStatus === 404
          ? <Link className={classes.action} to="/ayuda">Ir a Ayuda</Link>
          : <button type="button" className={classes.action} onClick={() => void query.refetch()}>Reintentar</button>}
      </section>}
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
            <Link to="/ayuda">Ver todos los temas de Ayuda</Link>
          </div>
        </aside>
      </>}
    </main>
    <SiteFooter />
  </>;
}
