import { Link, useParams, useSearchParams } from "react-router-dom";
import { Button, ButtonLink } from "@/components/ui/button";
import { AccountShell } from "@/features/account/AccountShell";
import { BookCover } from "@/features/catalog/BookCover";
import { CustomerOnly, PurchasePage } from "@/features/purchase/PurchaseChrome";
import type { LibraryCriteria } from "@/shared/api/library";
import { MaterialSymbol } from "@/shared/ui/MaterialSymbol";
import { acquiredDateLabel, editionFacts, mediaSymbol, titlesCountLabel } from "./libraryPresentation";
import { useOwnedItem, useOwnedItems } from "./libraryQuery";
import { libraryFilters, libraryRoutes, type OwnedItemViewModel } from "./libraryViewModel";
import classes from "./library.module.css";

/** Ownership verification only. Reader/player/content capabilities are explicitly outside scope. */
export function LibraryPage() {
  return <PurchasePage title="Mi biblioteca"><CustomerOnly intent={libraryRoutes.list} task="ver Mi biblioteca"><LibraryList /></CustomerOnly></PurchasePage>;
}

const emptyByFilter: Record<LibraryCriteria["productType"], { title: string; action: string; href: string }> = {
  "": { title: "Aún no tienes títulos digitales.", action: "Ver catálogo", href: "/catalog" },
  EBOOK: { title: "Aún no tienes eBooks.", action: "Ver eBooks", href: "/catalog?productType=EBOOK" },
  AUDIOBOOK: { title: "Aún no tienes audiolibros.", action: "Ver audiolibros", href: "/catalog?productType=AUDIOBOOK" },
};

function LibraryList() {
  const [params, setParams] = useSearchParams();
  const type = params.get("productType");
  const pageValue = Number(params.get("page") ?? 0);
  const criteria: LibraryCriteria = { productType: type === "EBOOK" || type === "AUDIOBOOK" ? type : "", page: Number.isSafeInteger(pageValue) && pageValue >= 0 ? pageValue : 0, pageSize: 20 };
  const query = useOwnedItems(criteria);
  const state = query.viewState;
  const empty = emptyByFilter[criteria.productType];
  function show(productType: LibraryCriteria["productType"]) {
    const next = new URLSearchParams(params);
    next.delete("page");
    if (productType) next.set("productType", productType); else next.delete("productType");
    setParams(next);
  }
  function goToPage(page: number) {
    const next = new URLSearchParams(params);
    if (page > 0) next.set("page", String(page)); else next.delete("page");
    setParams(next);
  }
  return <AccountShell title="Mi biblioteca" trail="Mi biblioteca" intro="Los eBooks y audiolibros que pertenecen a tu cuenta.">
    <div className={classes.collection}>
      <div className={classes.filters} role="group" aria-label="Mostrar">
        {libraryFilters.map(filter => <button key={filter.value} type="button" className={classes.chip} aria-pressed={criteria.productType === filter.value} onClick={() => show(filter.value)}>{filter.label}</button>)}
      </div>

      {state.status === "loading" && <>
        <p className="visually-hidden" role="status">Cargando Mi biblioteca…</p>
        <ul className={classes.shelf} aria-hidden="true">{[0, 1, 2, 3].map(index => <li key={index} className={`${classes.owned} ${classes.pending}`}><span className={classes.pendingCover} /><span className={classes.pendingLines}><span /><span /><span /></span></li>)}</ul>
      </>}

      {state.status === "error" && <section className={classes.notice} role="alert">
        <h2>{state.title}</h2>
        <p>{state.detail}</p>
        <Button variant="secondary" type="button" onClick={() => void query.refetch()}>Reintentar</Button>
      </section>}

      {state.status === "empty" && <section className={classes.notice} data-kind="empty">
        <MaterialSymbol name={criteria.productType === "AUDIOBOOK" ? "headphones" : "menu_book"} size={32} className={classes.noticeSymbol} />
        <h2>{criteria.page > 0 ? "No hay más títulos en esta página." : empty.title}</h2>
        {criteria.page > 0
          ? <Button variant="secondary" type="button" onClick={() => goToPage(0)}>Volver al inicio de Mi biblioteca</Button>
          : <><p>Lo que compres en formato digital aparece aquí cuando el pago queda aprobado.</p><ButtonLink variant="primary" to={empty.href}>{empty.action}</ButtonLink></>}
      </section>}

      {state.status === "ready" && <>
        <p className={classes.count}>{titlesCountLabel(state.data.totalCount)}</p>
        <ul className={classes.shelf}>{state.data.items.map(item => <OwnedCard key={item.ownedItemId} item={item} />)}</ul>
        {BigInt(state.data.totalCount) > BigInt(criteria.pageSize) && <nav className={classes.pages} aria-label="Páginas de Mi biblioteca">
          <button type="button" className={classes.pageStep} disabled={criteria.page === 0} onClick={() => goToPage(criteria.page - 1)}><MaterialSymbol name="arrow_back" />Anterior</button>
          <span className={classes.pagePosition}>Página {criteria.page + 1} de {Math.ceil(Number(state.data.totalCount) / criteria.pageSize)}</span>
          <button type="button" className={classes.pageStep} disabled={BigInt((criteria.page + 1) * criteria.pageSize) >= BigInt(state.data.totalCount)} onClick={() => goToPage(criteria.page + 1)}>Siguiente<MaterialSymbol name="arrow_forward" /></button>
        </nav>}
      </>}
    </div>
  </AccountShell>;
}

/** One owned title as one object: the title is the link and its target covers the whole object. */
function OwnedCard({ item }: { item: OwnedItemViewModel }) {
  return <li className={classes.owned} data-ownership={item.ownershipState}>
    <span className={classes.ownedCover}><BookCover url={item.coverUrl} license={null} attribution={null} title={item.title} size="compact" decorative /></span>
    <div className={classes.ownedText}>
      <p className={classes.media}><MaterialSymbol name={mediaSymbol(item.productType)} size={18} /><span>{item.mediaLabel}</span></p>
      <h2 className={classes.ownedTitle}><Link to={item.detailHref}>{item.title}</Link></h2>
      {item.authors && <p className={classes.ownedAuthors}>{item.authors}</p>}
      {item.ownershipState === "OWNED"
        ? <p className={classes.ownedNote}><span>Adquirido el <time dateTime={item.acquiredAt}>{acquiredDateLabel(item.acquiredAt)}</time></span></p>
        : <p className={classes.ownedNote}><MaterialSymbol name="block" size={18} /><span>{item.ownershipLabel}</span></p>}
    </div>
    <MaterialSymbol name="arrow_forward" className={classes.ownedGo} />
  </li>;
}

export function OwnedItemPage() {
  const { ownedItemId = "" } = useParams();
  return <PurchasePage title="Mi biblioteca"><CustomerOnly intent={libraryRoutes.detail(ownedItemId)} task="ver esta adquisición"><OwnedItemDetail ownedItemId={ownedItemId} /></CustomerOnly></PurchasePage>;
}

function OwnedItemDetail({ ownedItemId }: { ownedItemId: string }) {
  const query = useOwnedItem(ownedItemId);
  const state = query.viewState;
  return <div className={`account-page ${classes.page}`} data-storefront-surface>
    <Link to={libraryRoutes.list} className={classes.back}><MaterialSymbol name="arrow_back" /><span>Volver a Mi biblioteca</span></Link>

    {state.status === "loading" && <>
      <p className="visually-hidden" role="status">Cargando adquisición…</p>
      <div className={`${classes.scene} ${classes.pending}`} aria-hidden="true"><span className={classes.pendingCover} /><span className={classes.pendingLines}><span /><span /><span /></span></div>
    </>}

    {state.status === "error" && <section className={classes.notice} role="alert">
      <h1>{state.httpStatus === 404 ? "Adquisición no disponible" : state.title}</h1>
      <p>{state.detail}</p>
      {state.httpStatus === 404
        ? <ButtonLink variant="secondary" to={libraryRoutes.list}>Ir a Mi biblioteca</ButtonLink>
        : <Button variant="secondary" type="button" onClick={() => void query.refetch()}>Reintentar</Button>}
    </section>}

    {state.status === "ready" && <OwnedItemArticle item={state.data} />}
  </div>;
}

function OwnedItemArticle({ item }: { item: OwnedItemViewModel }) {
  const owned = item.ownershipState === "OWNED";
  const facts = editionFacts(item);
  return <article className={classes.detail} data-ownership={item.ownershipState}>
    <div className={classes.scene}>
      <div className={classes.jacket}><BookCover url={item.coverUrl} license={null} attribution={null} title={item.title} size="detail" loading="eager" /></div>
      <div className={classes.identity}>
        <p className={classes.media}><MaterialSymbol name={mediaSymbol(item.productType)} size={20} /><span>{item.mediaLabel}</span></p>
        <h1 className={classes.title} data-long={item.title.length > 60 || undefined}>{item.title}</h1>
        {item.authors && <p className={classes.authors}>{item.authors}</p>}
        <div className={classes.ownership}>
          <p className={classes.ownershipState}><MaterialSymbol name={owned ? "check_circle" : "block"} fill={owned} size={22} /><span>{item.ownershipLabel}</span></p>
          <p>Adquirido el <time dateTime={item.acquiredAt}>{acquiredDateLabel(item.acquiredAt)}</time></p>
        </div>
        {item.availableActions.length > 0 && <nav className={classes.actions} aria-label="Acciones de la adquisición">
          {item.availableActions.map((action, index) => <Link key={`${action.type}-${index}`} to={action.href} className={classes.action} data-action={action.type}>{action.label}</Link>)}
        </nav>}
      </div>
    </div>

    <div className={classes.record}>
      {facts.length > 0 && <section className={classes.facts} aria-labelledby="library-facts-heading">
        <h2 id="library-facts-heading">Datos de la edición</h2>
        <dl>{facts.map(fact => <div key={fact.label}><dt>{fact.label}</dt><dd>{fact.value}</dd></div>)}</dl>
      </section>}
      <section className={classes.purchases} aria-labelledby="library-purchases-heading">
        <h2 id="library-purchases-heading">Información de compra</h2>
        <ul>{item.sourcePurchases.map(source => <li key={source.orderItemId} className={classes.purchase} data-grant={source.grantState}>
          <p className={classes.purchaseOrder}>Pedido N.° {source.orderId}</p>
          <p className={classes.purchaseDate}><time dateTime={source.acquiredAt}>{acquiredDateLabel(source.acquiredAt)}</time></p>
          <dl>
            <div><dt>Pedido</dt><dd>{source.orderStateLabel}</dd></div>
            <div><dt>Pago</dt><dd>{source.paymentStateLabel}</dd></div>
            <div><dt>Titularidad</dt><dd>{source.grantStateLabel}</dd></div>
          </dl>
        </li>)}</ul>
      </section>
    </div>
  </article>;
}
