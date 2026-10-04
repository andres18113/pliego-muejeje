import { MaterialSymbol } from "@/shared/ui/MaterialSymbol";
import { useEffect, useRef, useState } from "react";
import { useMutation, useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import { useLocation, useParams } from "react-router-dom";
import { Button, ButtonLink } from "@/components/ui/button";
import { useSession } from "@/app/session";
import { BookCover } from "@/features/catalog/BookCover";
import { formatEdition, formatUsd } from "@/features/catalog/formatters";
import { getPublicEdition } from "@/shared/api/catalog";
import { ApiRequestError } from "@/shared/api/errors";
import { CancellationOutcomeUnknown, cancelOrder, getOrder, type OrderDetail } from "@/shared/api/orders";
import { ReadFailure } from "./CartPage";
import { CustomerOnly, PurchasePage } from "./PurchaseChrome";
import { orderMomentLabel, orderShortDateLabel, orderStateLabel, paymentMethodLabel, paymentStateLabel, unitsLabel } from "./purchaseText";
import { useTransferDetails } from "@/shared/api/reference";
import { TransferFacts } from "./TransferFacts";
import { TransactionButtonLabel } from "@/shared/ui/TransactionButtonLabel";

export function OrderPage() {
  const { orderId = "" } = useParams();
  const location = useLocation();
  const candidate = (location.state as { ordersPage?: unknown } | null)?.ordersPage;
  const returnTo = typeof candidate === "number" && Number.isInteger(candidate) && candidate > 0 && candidate <= 99999
    ? `/orders?page=${candidate}` : "/orders";
  return (
    <PurchasePage title={`Pedido ${orderId}`} compact>
      <CustomerOnly intent={`/orders/${orderId}`} task="ver tu pedido">
        <OrderContent orderId={orderId} returnTo={returnTo} />
      </CustomerOnly>
    </PurchasePage>
  );
}

function OrderContent({ orderId, returnTo }: { orderId: string; returnTo: string }) {
  const { clear: clearSession } = useSession();
  const queryClient = useQueryClient();
  const [confirming, setConfirming] = useState(false);
  const [cancelMessage, setCancelMessage] = useState<{ text: string; error: boolean } | null>(null);
  const noticeRef = useRef<HTMLParagraphElement>(null);
  const validId = /^[1-9][0-9]{0,18}$/.test(orderId) && BigInt(orderId) <= 9223372036854775807n;
  const orderQuery = useQuery({
    queryKey: ["customer-order", orderId],
    queryFn: ({ signal }) => getOrder(orderId, signal),
    enabled: validId,
    meta: { authRequired: true },
    retry: (count, error) => !(error instanceof ApiRequestError && error.status < 500) && count < 1,
  });
  const cancellation = useMutation({
    mutationFn: () => cancelOrder(orderId),
    onSuccess: async () => {
      setConfirming(false);
      setCancelMessage({ text: "Tu pedido fue cancelado. El pago fue reembolsado y se devolvieron las existencias del pedido.", error: false });
      await Promise.all([orderQuery.refetch(), queryClient.invalidateQueries({ queryKey: ["customer-orders"] })]);
    },
    onError: async (error) => {
      setConfirming(false);
      if (error instanceof ApiRequestError && error.status === 401) { clearSession("expired"); return; }
      const [refreshed] = await Promise.all([orderQuery.refetch(), queryClient.invalidateQueries({ queryKey: ["customer-orders"] })]);
      if (error instanceof CancellationOutcomeUnknown && refreshed.data?.orderState === "CANCELLED" && refreshed.data.payment?.state === "REFUNDED") {
        setCancelMessage({ text: "Confirmamos que el pedido se canceló y el pago quedó reembolsado.", error: false });
      } else if (refreshed.isError) {
        setCancelMessage({ text: "No pudimos confirmar la cancelación ni actualizar el pedido. Actualiza la página antes de tomar otra decisión.", error: true });
      } else {
        setCancelMessage({ text: error instanceof CancellationOutcomeUnknown
          ? "La cancelación no aparece en el estado actual. Revísalo antes de decidir si quieres intentarlo otra vez."
          : "El pedido cambió de estado. Revisa sus datos y las acciones disponibles.", error: true });
      }
    },
  });

  useEffect(() => {
    if (orderQuery.error instanceof ApiRequestError && orderQuery.error.status === 401) clearSession("expired");
  }, [clearSession, orderQuery.error]);
  useEffect(() => { if (cancelMessage) noticeRef.current?.focus({ preventScroll: true }); }, [cancelMessage]);

  if (!validId || (orderQuery.error instanceof ApiRequestError && orderQuery.error.status === 404)) {
    return (
      <section className="purchase-gate" aria-labelledby="order-missing-heading">
        <h1 id="order-missing-heading">No encontramos este pedido.</h1>
        <p>Puede que el enlace no sea correcto o que el pedido no pertenezca a tu cuenta.</p>
        <div className="purchase-actions">
          <ButtonLink variant="secondary" to={returnTo}>Ver mis pedidos</ButtonLink>
        </div>
      </section>
    );
  }

  if (orderQuery.isPending) {
    return (
      <>
        <h1 className="visually-hidden">Pedido {orderId}</h1>
        <p className="purchase-loading" role="status">Consultando tu pedido…</p>
      </>
    );
  }

  if (!orderQuery.data) {
    return (
      <>
        <h1 className="visually-hidden">Pedido {orderId}</h1>
        <ReadFailure
          title="No pudimos consultar tu pedido."
          onRetry={() => void orderQuery.refetch()}
          retrying={orderQuery.isFetching}
        />
      </>
    );
  }

  return <>
    {orderQuery.isFetching && <p className="purchase-loading" role="status">Actualizando el pedido…</p>}
    {orderQuery.isError && <p className="stale-data-note" role="status">No pudimos actualizar este pedido. Se muestra la última consulta disponible. <Button variant="text" type="button" onClick={() => void orderQuery.refetch()}>Actualizar</Button></p>}
    {cancelMessage && <p
        ref={noticeRef}
        tabIndex={-1}
        className={`purchase-notice ${cancelMessage.error ? "purchase-notice--error" : "purchase-notice--success"}`}
        role={cancelMessage.error ? "alert" : "status"}
      >{cancelMessage.text}</p>}
    <OrderView order={orderQuery.data} returnTo={returnTo} readCurrent={!orderQuery.isError && !orderQuery.isFetching} confirming={confirming} setConfirming={setConfirming} cancellationPending={cancellation.isPending} onCancel={() => { if (!cancellation.isPending) cancellation.mutate(); }} />
  </>;
}

function OrderView({ order, returnTo, readCurrent, confirming, setConfirming, cancellationPending, onCancel }: { order: OrderDetail; returnTo: string; readCurrent: boolean; confirming: boolean; setConfirming: (value: boolean) => void; cancellationPending: boolean; onCancel: () => void }) {
  const coverQueries = useQueries({
    queries: order.items.map((item) => ({
      queryKey: ["order-item-cover", item.editionId],
      queryFn: ({ signal }: { signal: AbortSignal }) => getPublicEdition(item.editionId!, signal),
      enabled: Boolean(item.editionId),
      staleTime: 60 * 60 * 1000,
      retry: false,
    })),
  });
  const transferDetails = useTransferDetails(order.payment?.method === "TRANSFER" && order.orderState !== "CANCELLED");
  const paymentState = order.payment?.state;
  const approved = order.orderState === "CONFIRMED" && paymentState === "APPROVED";
  const rejected = order.orderState === "CANCELLED" && paymentState === "REJECTED";
  const units = order.items.reduce((total, item) => total + item.quantity, 0);
  const cancellable = order.orderState === "CONFIRMED" || order.orderState === "PREPARING";
  const deliveryPlace = order.address
    ? [order.address.city, order.address.province].filter(Boolean).join(", ")
    : "Datos de entrega no disponibles";
  const headingRef = useRef<HTMLHeadingElement>(null);
  const confirmRef = useRef<HTMLButtonElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    // The loading heading unmounts when data arrives; keep keyboard and screen-reader users on the result.
    const active = document.activeElement;
    if (!active || active === document.body || !active.isConnected) headingRef.current?.focus({ preventScroll: true });
  }, []);
  useEffect(() => { if (confirming) confirmRef.current?.focus({ preventScroll: true }); }, [confirming]);

  return (
    <article className="order-view" aria-labelledby="order-heading">
      <header className={`order-outcome${rejected ? " order-outcome--rejected" : ""}`}>
        <ButtonLink variant="text" to={returnTo} className="purchase-back order-return-link">
          <span>Volver a mis pedidos</span>
          {order.createdAt && <><span className="order-return-separator" aria-hidden="true">·</span><time className="order-return-date" dateTime={order.createdAt}>{orderShortDateLabel(order.createdAt)}</time></>}
        </ButtonLink>
        <div className="order-result-title">
          {approved && <span className="order-confirmed-icon"><MaterialSymbol name="check" aria-hidden="true" size={20} /></span>}
          <div>
            <p className="order-result-kicker">{approved ? "Compra confirmada" : rejected ? "Pago rechazado" : "Estado del pedido"}</p>
            <h1 id="order-heading" ref={headingRef} tabIndex={-1}>
              {approved ? `Pedido N.° ${order.orderId} confirmado` : rejected ? "No pudimos completar el pago" : `Pedido N.° ${order.orderId}`}
            </h1>
          </div>
        </div>
        <p className={`edition-availability order-status ${order.orderState === "CANCELLED" ? "is-unavailable" : "is-available"}`}>
          <span className="availability-mark" aria-hidden="true" />
          {orderStateLabel(order.orderState)}
          {order.payment ? ` · pago ${paymentStateLabel(order.payment.state).toLowerCase()}` : ""}
        </p>
        {!approved && <p className="order-outcome-note">{rejected ? "Los libros siguen en tu carrito." : "Este es el estado actual de tu pedido."}</p>}
      </header>

      <div className="order-overview">
        <section className="order-products" aria-labelledby="order-items-heading">
          <header className="order-products-heading">
            <h2 id="order-items-heading">Libros del pedido</h2>
            <span>{unitsLabel(units)}</span>
          </header>
          <ul className="order-book-list">
            {order.items.map((item, index) => {
              const edition = coverQueries[index]?.data;
              return <li className="order-book-line" key={item.orderItemId}>
                <BookCover
                  url={edition?.coverUrl ?? null}
                  license={edition?.coverLicense ?? null}
                  attribution={edition?.coverAttribution ?? null}
                  title={item.title}
                  size="compact"
                  loading={index === 0 ? "eager" : "lazy"}
                />
                <div className="order-book-copy">
                  <h3>{item.title}</h3>
                  <p>{item.authors || "Autor no disponible"}</p>
                  {item.format && <p>{formatEdition(item.format)}</p>}
                </div>
                <div className="order-book-price">
                  {formatUsd(item.subtotal)}
                  <span>{item.quantity} × {formatUsd(item.unitPrice)}</span>
                </div>
              </li>;
            })}
          </ul>
        </section>

        <aside className="order-overview-card" aria-labelledby="order-summary-heading">
          <h2 id="order-summary-heading">Resumen del pedido</h2>
          <dl>
            <div><dt>Número de pedido</dt><dd>N.° {order.orderId}</dd></div>
            <div><dt>Estado</dt><dd>{orderStateLabel(order.orderState)}{order.payment ? ` · pago ${paymentStateLabel(order.payment.state).toLowerCase()}` : ""}</dd></div>
            <div className="order-delivery-short">
              <dt>Entrega</dt>
              <dd>{order.address?.recipient ?? "Dirección no disponible"}</dd>
              {order.address && <dd className="order-delivery-street">{order.address.line1}</dd>}
              <dd>{deliveryPlace}</dd>
            </div>
            <div className="order-overview-total"><dt>Total</dt><dd>{formatUsd(order.total)}</dd></div>
          </dl>
          <div className="purchase-actions">
            {rejected
              ? <ButtonLink variant="primary" to="/cart">Revisar el carrito</ButtonLink>
              : <ButtonLink variant="primary" to={returnTo}>Ver mis pedidos</ButtonLink>}
          </div>
        </aside>
      </div>

      <section className="order-progressive" aria-label="Más información del pedido">
        {order.address && <details className="order-disclosure">
          <summary>
            <span className="order-disclosure-icon"><MaterialSymbol name="location_on" aria-hidden="true" size={18} /></span>
            <span className="order-disclosure-copy"><strong>Entrega</strong><small>{order.address.recipient} · {deliveryPlace}</small></span>
            <MaterialSymbol name="expand_more" aria-hidden="true" className="order-disclosure-chevron" size={17} />
          </summary>
          <div className="order-disclosure-content">
            <address className="order-address">
              <strong>{order.address.recipient}</strong>
              <span>{order.address.line1}</span>
              {order.address.line2 && <span>{order.address.line2}</span>}
              <span>{[order.address.city, order.address.province, new Intl.DisplayNames(["es"], { type: "region" }).of(order.address.countryCode)].filter(Boolean).join(", ")}</span>
              {order.address.postalCode && <span>{order.address.postalCode}</span>}
              {order.address.reference && <span>Referencia: {order.address.reference}</span>}
              <span>Teléfono: {order.address.phone}</span>
            </address>
            <p className="purchase-summary-note">Datos guardados con el pedido; no cambian si editas tus direcciones.</p>
          </div>
        </details>}

        {order.payment && <details className="order-disclosure">
          <summary>
            <span className="order-disclosure-icon"><MaterialSymbol name="credit_card" aria-hidden="true" size={18} /></span>
            <span className="order-disclosure-copy"><strong>Pago</strong><small>{paymentMethodLabel(order.payment.method)} · {paymentStateLabel(order.payment.state)}</small></span>
            <MaterialSymbol name="expand_more" aria-hidden="true" className="order-disclosure-chevron" size={17} />
          </summary>
          <div className="order-disclosure-content">
            <div className="order-payment-summary">
              <span><small>Método</small><strong>{paymentMethodLabel(order.payment.method)}</strong></span>
              <span><small>Estado</small><strong>{paymentStateLabel(order.payment.state)}</strong></span>
            </div>
            {order.payment.method === "TRANSFER" && order.orderState !== "CANCELLED"
              ? transferDetails.data
                ? <TransferFacts details={transferDetails.data} amount={order.total} reference={order.payment.reference} />
                : transferDetails.isPending
                  ? <p role="status">Consultando datos bancarios…</p>
                  : <ReadFailure title="No pudimos consultar los datos bancarios." onRetry={() => void transferDetails.refetch()} retrying={transferDetails.isFetching} />
              : order.payment.reference && <div className="order-payment-reference"><span>Referencia de pago</span><strong>{order.payment.reference}</strong></div>}
          </div>
        </details>}

        <details className="order-disclosure">
          <summary>
            <span className="order-disclosure-icon"><MaterialSymbol name="schedule" aria-hidden="true" size={18} /></span>
            <span className="order-disclosure-copy"><strong>Historial</strong><small>{order.stateHistory.length === 1 ? "1 actualización" : `${order.stateHistory.length} actualizaciones`}</small></span>
            <MaterialSymbol name="expand_more" aria-hidden="true" className="order-disclosure-chevron" size={17} />
          </summary>
          <div className="order-disclosure-content">
            {order.stateHistory.length
              ? <ol className="order-history-list">{order.stateHistory.map((entry) => <li key={entry.historyId}><strong>{orderStateLabel(entry.newState)}</strong><time dateTime={entry.at}>{orderMomentLabel(entry.at)}</time></li>)}</ol>
              : <p>El historial de estados aún no está disponible.</p>}
          </div>
        </details>

        {!rejected && order.orderState !== "CANCELLED" && <details className="order-disclosure" open={confirming}>
          <summary>
            <span className="order-disclosure-icon"><MaterialSymbol name="block" aria-hidden="true" size={18} /></span>
            <span className="order-disclosure-copy"><strong>Cancelación</strong><small>{cancellable && readCurrent ? "Disponible" : "No disponible"}</small></span>
            <MaterialSymbol name="expand_more" aria-hidden="true" className="order-disclosure-chevron" size={17} />
          </summary>
          <div className="order-disclosure-content">
            {cancellable && !readCurrent ? <p>Actualiza el pedido para comprobar si aún se puede cancelar.</p> : cancellable ? <>
              <p>Puedes cancelarlo mientras esté {order.orderState === "CONFIRMED" ? "confirmado" : "en preparación"}. Se reembolsará el pago y se liberarán los libros.</p>
              {!confirming ? <Button ref={cancelRef} variant="secondary" type="button" onClick={() => setConfirming(true)}>Cancelar pedido</Button> : <div className="order-cancel-confirm" role="group" aria-label="Confirmar cancelación">
                <p>¿Cancelar el pedido N.° {order.orderId}?</p>
                <div className="purchase-actions"><Button ref={confirmRef} variant="primary" type="button" aria-label={cancellationPending ? "Cancelando pedido" : "Confirmar cancelación"} aria-disabled={cancellationPending || undefined} aria-busy={cancellationPending || undefined} onClick={onCancel}><TransactionButtonLabel state={cancellationPending ? "pending" : "idle"} idle="Confirmar cancelación" pending="Cancelando pedido…" success="Cancelado" reserve="Cancelando pedido…" /></Button><Button variant="text" type="button" aria-disabled={cancellationPending || undefined} onClick={() => { if (cancellationPending) return; setConfirming(false); requestAnimationFrame(() => cancelRef.current?.focus({ preventScroll: true })); }}>Conservar pedido</Button></div>
              </div>}
            </> : <p>Este pedido ya no se puede cancelar desde tu cuenta.</p>}
          </div>
        </details>}
      </section>
    </article>
  );
}
