import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link, useSearchParams } from "react-router-dom";
import { Button, ButtonLink } from "@/components/ui/button";
import { useSession } from "@/app/session";
import { formatUsd } from "@/features/catalog/formatters";
import { ApiRequestError } from "@/shared/api/errors";
import { listOrders } from "@/shared/api/orders";
import { ReadFailure } from "./CartPage";
import { CustomerOnly, PurchasePage } from "./PurchaseChrome";
import { orderDateLabel, orderStateLabel, paymentStateLabel } from "./purchaseText";
import { AccountNavigation } from "@/features/account/AccountNavigation";

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
  const query = useQuery({
    queryKey: ["customer-orders", page],
    queryFn: ({ signal }) => listOrders(page, pageSize, signal),
    meta: { authRequired: true },
    staleTime: 0,
    refetchOnMount: "always",
    retry: false,
  });
  useEffect(() => {
    if (query.error instanceof ApiRequestError && query.error.status === 401) clear("expired");
  }, [clear, query.error]);
  useEffect(() => {
    if (query.data && page > 0 && Number(query.data.totalCount) <= page * pageSize) setSearchParams({});
  }, [page, query.data, setSearchParams]);

  const total = query.data ? Number(query.data.totalCount) : 0;
  return <section className="orders-history" aria-labelledby="orders-heading">
    <header className="purchase-heading">
      <h1 id="orders-heading">Mis pedidos</h1>
      <p>Consulta tus compras, el estado de cada pedido y sus datos de entrega.</p>
    </header>
    <AccountNavigation />
    {query.isPending ? <p className="purchase-loading" role="status">Consultando tus pedidos…</p> : null}
    {query.isError && !query.data ? <ReadFailure title="No pudimos consultar tus pedidos." onRetry={() => void query.refetch()} retrying={query.isFetching} /> : null}
    {query.data && <>
      {query.isError && <p className="stale-data-note" role="status">No pudimos actualizar tus pedidos. Se muestra la última consulta disponible. <Button variant="text" type="button" onClick={() => void query.refetch()}>Actualizar</Button></p>}
      {query.isFetching && !query.isPending && !query.isError && <p className="purchase-loading" role="status">Actualizando tus pedidos…</p>}
      {query.data.items.length === 0 ? <div className="purchase-empty orders-empty">
        <h2>Aún no tienes pedidos.</h2>
        <p>Cuando completes una compra, podrás consultar aquí su estado y sus libros.</p>
        <ButtonLink variant="primary" to="/catalog">Explorar el catálogo</ButtonLink>
      </div> : <>
        <ol className="orders-list">
          {query.data.items.map((order) => <li key={order.orderId}>
            <Link className="orders-row" to={`/orders/${order.orderId}`} state={{ ordersPage: page }}>
              <span className="orders-row-main"><strong>Pedido n.º {order.orderId}</strong><span>{order.createdAt ? orderDateLabel(order.createdAt) : "Fecha no disponible"}</span></span>
              <span className={`orders-row-state${order.orderState === "CANCELLED" ? " is-unavailable" : ""}`}><span className="availability-mark" aria-hidden="true" />{orderStateLabel(order.orderState)}{order.paymentState ? ` · Pago ${paymentStateLabel(order.paymentState).toLowerCase()}` : ""}</span>
              <strong className="orders-row-total">{formatUsd(order.total)}</strong>
            </Link>
          </li>)}
        </ol>
        {total > pageSize && <nav className="orders-pagination" aria-label="Páginas de pedidos">
          <Button variant="secondary" type="button" disabled={page === 0 || query.isFetching} onClick={() => changePage(page - 1)}>Anterior</Button>
          <span>Página {page + 1} de {Math.max(1, Math.ceil(total / pageSize))}</span>
          <Button variant="secondary" type="button" disabled={(page + 1) * pageSize >= total || query.isFetching} onClick={() => changePage(page + 1)}>Siguiente</Button>
        </nav>}
      </>}
    </>}
  </section>;
}
