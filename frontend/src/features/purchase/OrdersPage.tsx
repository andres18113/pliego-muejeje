import { useEffect } from "react";
import { useQueries } from "@tanstack/react-query";
import { Link, useSearchParams } from "react-router-dom";
import { Button, ButtonLink } from "@/components/ui/button";
import { useSession } from "@/app/session";
import { BookCover } from "@/features/catalog/BookCover";
import { formatUsd } from "@/features/catalog/formatters";
import { getPublicEdition } from "@/shared/api/catalog";
import { ApiRequestError } from "@/shared/api/errors";
import type { OrderDetail, OrderSummary } from "@/shared/api/orders";
import { ReadFailure } from "./CartPage";
import { CustomerOnly, PurchasePage } from "./PurchaseChrome";
import { booksLabel, deliveryWindowLabel, orderDateLabel, paymentStateLabel, unitsLabel } from "./purchaseText";
import { storyFromState, type OrderStory } from "./orderStory";
import { useCustomerOrders } from "./ordersQuery";
import type { MisPedidosOrder } from "./orderViewModel";
import { MaterialSymbol } from "@/shared/ui/MaterialSymbol";
import classes from "./orders.module.css";
import { AccountShell } from "@/features/account/AccountShell";

const pageSize = 10;

export function OrdersPage() {
  return <PurchasePage title="Mis pedidos"><CustomerOnly intent="/orders" task="ver tus pedidos"><OrdersContent /></CustomerOnly></PurchasePage>;
}

function OrdersContent() {
  const { clear } = useSession();
  const [searchParams, setSearchParams] = useSearchParams();
  const rawPage = searchParams.get("page") ?? "0";
  const page = /^(0|[1-9][0-9]{0,4})$/.test(rawPage) ? Number(rawPage) : 0;
  const changePage = (next: number) => setSearchParams(next === 0 ? {} : { page: String(next) });
  const query = useCustomerOrders(page,pageSize);
  useEffect(() => {
    if (query.error instanceof ApiRequestError && query.error.status === 401) clear("expired");
  }, [clear, query.error]);
  useEffect(() => {
    if (query.data && page > 0 && Number(query.data.totalCount) <= page * pageSize) setSearchParams({});
  }, [page, query.data, setSearchParams]);

  const total = query.data ? Number(query.data.totalCount) : 0;
  const rows = (query.data?.items ?? []).map((order,index) => presentOrder(order,query.viewModels[index]!,query.details[index]));
  const open = rows.filter((row) => row.open), past = rows.filter((row) => !row.open);
  return <AccountShell title="Mis pedidos" trail="Pedidos" intro="Cada compra con su estado actual, sus libros y su total.">
    <section className={`orders-history ${classes.history}`} aria-labelledby="orders-heading">
    <h2 id="orders-heading" className="visually-hidden">Pedidos</h2>
    {query.isPending ? <p className="purchase-loading" role="status">Consultando tus pedidos…</p> : null}
    {query.isError && !query.data ? <ReadFailure title="No pudimos consultar tus pedidos." onRetry={() => void query.refetch()} retrying={query.isFetching} /> : null}
    {query.data && <>
      {query.isError && <p className="stale-data-note" role="status">No pudimos actualizar tus pedidos. Se muestra la última consulta disponible. <Button variant="text" type="button" onClick={() => void query.refetch()}>Actualizar</Button></p>}
      {query.isFetching && !query.isPending && !query.isError && <p className="purchase-loading" role="status">Actualizando tus pedidos…</p>}
      {query.data.items.length === 0 ? <div className={`purchase-empty orders-empty ${classes.empty}`}>
        <h2>Aún no tienes pedidos.</h2>
        <p>Cuando completes una compra, podrás consultar aquí su estado y sus libros.</p>
        <ButtonLink variant="primary" to="/catalog">Explorar el catálogo</ButtonLink>
      </div> : <>
        {open.length > 0 && <section className={classes.group} aria-labelledby="orders-open-heading">
          <h3 id="orders-open-heading" className={classes.groupTitle}>En curso</h3>
          <ol className={`orders-list ${classes.open}`}>
            {open.map((row) => <li key={row.order.orderId}><OrderUnit {...row} group="open" page={page} /></li>)}
          </ol>
        </section>}
        {past.length > 0 && <section className={classes.group} aria-labelledby="orders-past-heading">
          <h3 id="orders-past-heading" className={open.length > 0 ? classes.groupTitle : "visually-hidden"}>Anteriores</h3>
          <ol className={`orders-list ${classes.past}`}>
            {past.map((row) => <li key={row.order.orderId}><OrderUnit {...row} group="past" page={page} /></li>)}
          </ol>
        </section>}
        {total > pageSize && <nav className={`orders-pagination ${classes.pagination}`} aria-label="Páginas de pedidos">
          <Button variant="secondary" type="button" disabled={page === 0 || query.isFetching} onClick={() => changePage(page - 1)}>Anterior</Button>
          <span>Página {page + 1} de {Math.max(1, Math.ceil(total / pageSize))}</span>
          <Button variant="secondary" type="button" disabled={(page + 1) * pageSize >= total || query.isFetching} onClick={() => changePage(page + 1)}>Siguiente</Button>
        </nav>}
      </>}
    </>}
    </section>
  </AccountShell>;
}

interface OrderRow { order: OrderSummary; viewModel: MisPedidosOrder; detail?: OrderDetail; paymentState?: string | null; story: OrderStory; open: boolean }

/** Presentation only: an order is "en curso" while its server-reported state still expects something to happen. */
function presentOrder(order: OrderSummary, viewModel: MisPedidosOrder, detail?: OrderDetail): OrderRow {
  const paymentState = detail ? detail.payment?.state : order.paymentState;
  const story = storyFromState(viewModel.state,paymentState);
  return { order, viewModel, detail, paymentState, story, open: story.tone === "progress" || story.kind === "awaiting-payment" };
}

/**
 * One order as one linked unit in one grammar. Orders en curso are mist objects led by the state in display
 * type; finished ones are quiet outlined sheets read as identity, date, total, "Ver pedido", then the state and
 * its books. Titles and quantities come from the order; only the cover is looked up by edition, as in the
 * order detail. A format mark can join each title once the contract defines digital orders.
 */
function OrderUnit({ order, viewModel, detail, paymentState, story, group, page }: OrderRow & { group: "open" | "past"; page: number }) {
  const window = viewModel.fulfillmentType === "HOME_DELIVERY" ? deliveryWindowLabel(
    detail ? detail.shipment?.estimatedDeliveryFrom ?? null : order.estimatedDeliveryFrom,
    detail ? detail.shipment?.estimatedDeliveryTo ?? null : order.estimatedDeliveryTo,
  ) : null;
  const note = story.kind === "cancelled" ? (paymentState === "REFUNDED" ? "Pago reembolsado" : paymentState ? `Pago ${paymentStateLabel(paymentState).toLowerCase()}` : null)
    : story.kind === "payment-rejected" ? "El pago fue rechazado; no se cobró este pedido."
      : story.kind === "awaiting-payment" ? "Esperamos la confirmación del pago."
        : (story.kind === "preparing" || story.kind === "in-transit") && window ? `Llega ${window}` : null;
  const items = viewModel.items.slice(0,3);
  const editionIds = items.map((item) => detail?.items.find((line) => line.orderItemId === item.orderItemId)?.editionId);
  const covers = useQueries({ queries: editionIds.map((editionId) => ({
    queryKey: ["order-item-cover", editionId],
    queryFn: ({ signal }: { signal: AbortSignal }) => getPublicEdition(editionId!, signal),
    enabled: Boolean(editionId), staleTime: 60 * 60 * 1000, retry: false,
  })) });
  const itemCount = detail ? viewModel.items.length : order.itemCount;
  const remaining = itemCount !== null ? Math.max(0, itemCount - items.length) : 0;
  const more = remaining > 0 ? <span className={classes.more}>y {booksLabel(remaining)} más</span> : null;
  const placed = viewModel.date ? orderDateLabel(viewModel.date) : "Fecha no disponible";
  const outcome = story.kind === "delivered" ? "done" : "closed";
  return <Link className={classes.unit} data-group={group} data-outcome={group === "past" ? outcome : undefined} to={`/orders/${order.orderId}`} state={{ ordersPage: page }}>
    <span className={classes.what}>
    <span className={classes.story}>
      <strong className={classes.state}>{group === "past" && outcome === "done" && <MaterialSymbol name="check" size={18} />}{story.headline}</strong>{" "}
      {note && <span className={classes.note}>{note}</span>}
    </span>{" "}
    {items.length > 0 && <span className={classes.books}>
      {items.map((item, index) => {
        const edition = covers[index]?.data;
        return <span key={item.orderItemId} className={classes.book}>
          <span className={classes.cover}><BookCover url={edition?.coverUrl ?? null} license={edition?.coverLicense ?? null} attribution={edition?.coverAttribution ?? null} title={item.title} size="compact" decorative /></span>
          <span className={classes.bookTitle}>{item.title}{item.quantity > 1 && <span className={classes.quantity}> × {item.quantity}</span>}{(index < items.length - 1 || more) && <span className="visually-hidden">, </span>}</span>
        </span>;
      })}
      {more && " "}{more}
    </span>}
    </span>{" "}
    <span className={classes.receipt}>
    <span className={classes.meta}>
      <span>Pedido N.° {order.orderId}</span>{" "}
      {group === "past" && <><span>{placed}</span>{" "}</>}
      {viewModel.units !== null && <span>{unitsLabel(viewModel.units)}</span>}{" "}
      {(detail ? detail.invoice?.state === "ISSUED" : order.invoiceState === "ISSUED") && <span className={classes.document}>Factura emitida</span>}
    </span>{" "}
    {group === "open" && <><span className={classes.placed}><span className={classes.label}>Realizado </span>{placed}</span>{" "}</>}
    <span className={classes.total}><span className={classes.label}>Total </span>{formatUsd(viewModel.pricing.total)}</span>{" "}
    <span className={classes.go}>Ver pedido<MaterialSymbol name="chevron_right" aria-hidden="true" size={20} /></span>
    </span>
  </Link>;
}
