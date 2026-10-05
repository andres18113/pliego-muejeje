import { Link, useParams, useSearchParams } from "react-router-dom";
import type { LibraryCriteria } from "@/shared/api/library";
import { CustomerOnly } from "@/features/purchase/PurchaseChrome";
import { useOwnedItem, useOwnedItems } from "./libraryQuery";
import { libraryFilters, libraryRoutes } from "./libraryViewModel";

/** Ownership verification only. Reader/player/content capabilities are explicitly outside scope. */
export function LibraryPage() {
  return <main id="contenido-principal" tabIndex={-1}><CustomerOnly intent={libraryRoutes.list} task="ver Mi biblioteca"><LibraryList /></CustomerOnly></main>;
}
function LibraryList() {
  const [params, setParams] = useSearchParams();
  const type = params.get("productType");
  const pageValue = Number(params.get("page") ?? 0);
  const criteria: LibraryCriteria = { productType: type === "EBOOK" || type === "AUDIOBOOK" ? type : "", page: Number.isSafeInteger(pageValue) && pageValue >= 0 ? pageValue : 0, pageSize: 20 };
  const query = useOwnedItems(criteria);
  const state = query.viewState;
  return <><h1>Mi biblioteca</h1><label>Mostrar<select value={criteria.productType} onChange={event => { const next = new URLSearchParams(params); next.delete("page"); if (event.currentTarget.value) next.set("productType", event.currentTarget.value); else next.delete("productType"); setParams(next); }}>{libraryFilters.map(filter => <option key={filter.value} value={filter.value}>{filter.label}</option>)}</select></label>
    {state.status === "loading" && <p role="status">Cargando Mi biblioteca…</p>}
    {state.status === "error" && <section role="alert"><h2>{state.title}</h2><p>{state.detail}</p><button onClick={() => void query.refetch()}>Reintentar</button></section>}
    {state.status === "empty" && <section><h2>Aún no tienes títulos en esta vista.</h2><p>Las compras digitales con pago aprobado aparecerán aquí.</p><Link to="/catalog">Ver catálogo</Link></section>}
    {state.status === "ready" && <><ul>{state.data.items.map(item => <li key={item.ownedItemId}>{item.coverUrl && <img src={item.coverUrl} alt={`Portada de ${item.title}`} width="100" loading="lazy" />}<Link to={item.detailHref}>{item.title}</Link><p>{item.authors}</p><p>{item.mediaLabel}</p><p>{item.ownershipLabel}</p><p>Adquirido el <time dateTime={item.acquiredAt}>{item.acquiredAt}</time></p></li>)}</ul><nav aria-label="Páginas de Mi biblioteca"><button disabled={criteria.page === 0} onClick={() => { const next = new URLSearchParams(params); next.set("page", String(criteria.page - 1)); setParams(next); }}>Anterior</button><button disabled={BigInt((criteria.page + 1) * criteria.pageSize) >= BigInt(state.data.totalCount)} onClick={() => { const next = new URLSearchParams(params); next.set("page", String(criteria.page + 1)); setParams(next); }}>Siguiente</button></nav></>}
  </>;
}
export function OwnedItemPage() {
  const { ownedItemId = "" } = useParams();
  return <main id="contenido-principal" tabIndex={-1}><CustomerOnly intent={libraryRoutes.detail(ownedItemId)} task="ver esta adquisición"><OwnedItemDetail ownedItemId={ownedItemId} /></CustomerOnly></main>;
}
function OwnedItemDetail({ ownedItemId }: { ownedItemId: string }) {
  const query = useOwnedItem(ownedItemId);
  const state = query.viewState;
  return <><Link to={libraryRoutes.list}>Mi biblioteca</Link>
    {state.status === "loading" && <p role="status">Cargando adquisición…</p>}
    {state.status === "error" && <section role="alert"><h1>{state.httpStatus === 404 ? "Adquisición no disponible" : state.title}</h1><p>{state.detail}</p>{state.httpStatus !== 404 && <button onClick={() => void query.refetch()}>Reintentar</button>}</section>}
    {state.status === "ready" && <article><h1>{state.data.title}</h1>{state.data.coverUrl && <img src={state.data.coverUrl} alt={`Portada de ${state.data.title}`} width="160" />}<p>{state.data.authors}</p><p>{state.data.mediaLabel}</p><p>{state.data.ownershipLabel}</p><p>{state.data.accessLabel}</p><p>Adquirido el <time dateTime={state.data.acquiredAt}>{state.data.acquiredAt}</time></p><dl>{state.data.bibliographicMetadata.map(row => <div key={row.label}><dt>{row.label}</dt><dd>{row.value}</dd></div>)}</dl><section aria-label="Información de compra"><h2>Compras de origen</h2><ul>{state.data.sourcePurchases.map(source => <li key={source.orderItemId}>Pedido {source.orderId} · Ítem {source.orderItemId} · <time dateTime={source.acquiredAt}>{source.acquiredAt}</time> · {source.orderState} · {source.paymentState} · {source.grantState}</li>)}</ul></section><nav aria-label="Acciones de la adquisición">{state.data.availableActions.map((action, index) => <Link key={`${action.type}-${index}`} to={action.href}>{action.label}</Link>)}</nav></article>}
  </>;
}
