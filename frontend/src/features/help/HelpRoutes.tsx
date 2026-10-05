import { Link, useParams, useSearchParams } from "react-router-dom";
import { useState } from "react";
import type { HelpCriteria } from "@/shared/api/help";
import { useHelpArticle, useHelpArticles, useHelpCategories } from "./helpQuery";

/** Functional semantic scaffolding. Claude may style these elements without changing API rules. */
export function HelpPage() {
  const [params, setParams] = useSearchParams();
  const [queryText, setQueryText] = useState(params.get("que") ?? "");
  const pageValue = Number(params.get("page") ?? 0);
  const applicability = params.get("applicability");
  const criteria: HelpCriteria = { query: params.get("que") ?? "", category: params.get("category") ?? "", applicability: applicability === "GENERAL" || applicability === "PHYSICAL" || applicability === "EBOOK" || applicability === "AUDIOBOOK" ? applicability : "", page: Number.isSafeInteger(pageValue) && pageValue >= 0 ? pageValue : 0, pageSize: 20 };
  const categories = useHelpCategories();
  const articles = useHelpArticles(criteria);
  const state = articles.viewState;
  function change(name: string, value: string) { const next = new URLSearchParams(params); next.delete("page"); if (value) next.set(name, value); else next.delete(name); setParams(next); }
  return <main id="contenido-principal" tabIndex={-1}><h1>Ayuda</h1>
    <form onSubmit={event => { event.preventDefault(); change("que", queryText.trim()); }}><label>Buscar en Ayuda<input name="que" value={queryText} onChange={event => setQueryText(event.currentTarget.value)} /></label><button type="submit">Buscar</button></form>
    <label>Tema<select value={criteria.category} onChange={event => change("category", event.currentTarget.value)}><option value="">Todos los temas</option>{categories.data?.map(category => <option key={category.slug} value={category.slug}>{category.title}</option>)}</select></label>
    <label>Tipo de compra<select value={criteria.applicability} onChange={event => change("applicability", event.currentTarget.value)}><option value="">Todos</option><option value="GENERAL">General</option><option value="PHYSICAL">Libros físicos</option><option value="EBOOK">eBooks</option><option value="AUDIOBOOK">Audiolibros</option></select></label>
    {categories.isError && <p role="alert">No pudimos consultar los temas. <button onClick={() => void categories.refetch()}>Reintentar temas</button></p>}
    {state.status === "loading" && <p role="status">Cargando Ayuda…</p>}
    {state.status === "error" && <section role="alert"><h2>{state.title}</h2><p>{state.detail}</p><button onClick={() => void articles.refetch()}>Reintentar</button></section>}
    {state.status === "empty" && <p>No encontramos artículos para esta búsqueda.</p>}
    {state.status === "ready" && <><ul>{state.data.items.map(article => <li key={article.slug}><Link to={`/ayuda/${encodeURIComponent(article.slug)}`}>{article.title}</Link><p>{article.summary}</p></li>)}</ul>
      <nav aria-label="Páginas de Ayuda"><button disabled={criteria.page === 0} onClick={() => { const next = new URLSearchParams(params); next.set("page", String(criteria.page - 1)); setParams(next); }}>Anterior</button><button disabled={BigInt((criteria.page + 1) * criteria.pageSize) >= BigInt(state.data.totalCount)} onClick={() => { const next = new URLSearchParams(params); next.set("page", String(criteria.page + 1)); setParams(next); }}>Siguiente</button></nav></>}
  </main>;
}
export function HelpArticlePage() {
  const { slug = "" } = useParams();
  const query = useHelpArticle(slug);
  const state = query.viewState;
  return <main id="contenido-principal" tabIndex={-1}><Link to="/ayuda">Ayuda</Link>
    {state.status === "loading" && <p role="status">Cargando artículo…</p>}
    {state.status === "error" && <section role="alert"><h1>{state.httpStatus === 404 ? "Artículo no disponible" : state.title}</h1><p>{state.detail}</p>{state.httpStatus !== 404 && <button onClick={() => void query.refetch()}>Reintentar</button>}</section>}
    {state.status === "ready" && <article><h1>{state.data.title}</h1><p>{state.data.summary}</p>{state.data.body.split(/\n\s*\n/).map((paragraph, index) => <p key={index}>{paragraph}</p>)}</article>}
  </main>;
}
