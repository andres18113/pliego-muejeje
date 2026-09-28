import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useLocation, useParams } from "react-router-dom";
import { Button, ButtonLink } from "@/components/ui/button";
import { useSession } from "@/app/session";
import { formatEdition, formatUsd } from "@/features/catalog/formatters";
import { ApiRequestError } from "@/shared/api/errors";
import { CancellationOutcomeUnknown, cancelOrder, getOrder, type OrderDetail } from "@/shared/api/orders";
import { ReadFailure } from "./CartPage";
import { CustomerOnly, PurchasePage } from "./PurchaseChrome";
import { orderDateLabel, orderMomentLabel, orderStateLabel, paymentMethodLabel, paymentStateLabel, unitsLabel } from "./purchaseText";
import { useTransferDetails } from "@/shared/api/reference";
import { TransferFacts } from "./TransferFacts";

export function OrderPage() {
  const { orderId = "" } = useParams();
  const location = useLocation();
  const candidate = (location.state as { ordersPage?: unknown } | null)?.ordersPage;
  const returnTo = typeof candidate === "number" && Number.isInteger(candidate) && candidate > 0 && candidate <= 99999
    ? `/orders?page=${candidate}` : "/orders";
  return (
    <PurchasePage title={`Pedido ${orderId}`}>
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
      setCancelMessage({ text: "Tu pedido fue cancelado. El pago fue reembolsado y los libros vuelven a estar disponibles.", error: false });
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
    {cancelMessage && <p ref={noticeRef} tabIndex={-1} className={`purchase-notice ${cancelMessage.error ? "purchase-notice--error" : "purchase-notice--success"}`} role="status">{cancelMessage.text}</p>}
    <OrderView order={orderQuery.data} returnTo={returnTo} readCurrent={!orderQuery.isError && !orderQuery.isFetching} confirming={confirming} setConfirming={setConfirming} cancellationPending={cancellation.isPending} onCancel={() => cancellation.mutate()} />
  </>;
}

function OrderView({ order, returnTo, readCurrent, confirming, setConfirming, cancellationPending, onCancel }: { order: OrderDetail; returnTo: string; readCurrent: boolean; confirming: boolean; setConfirming: (value: boolean) => void; cancellationPending: boolean; onCancel: () => void }) {
  const transferDetails = useTransferDetails(order.payment?.method === "TRANSFER" && order.orderState !== "CANCELLED");
  const paymentState = order.payment?.state;
  const approved = order.orderState === "CONFIRMED" && paymentState === "APPROVED";
  const rejected = order.orderState === "CANCELLED" && paymentState === "REJECTED";
  const units = order.items.reduce((total, item) => total + item.quantity, 0);
  const cancellable = order.orderState === "CONFIRMED" || order.orderState === "PREPARING";
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
        <ButtonLink variant="text" to={returnTo} className="purchase-back">Volver a mis pedidos</ButtonLink>
        <h1 id="order-heading" ref={headingRef} tabIndex={-1}>
          {approved ? `Pedido n.º ${order.orderId} confirmado` : rejected ? "No pudimos completar el pago" : `Pedido n.º ${order.orderId}`}
        </h1>
        <p className={`edition-availability order-status ${order.orderState === "CANCELLED" ? "is-unavailable" : "is-available"}`}>
          <span className="availability-mark" aria-hidden="true" />
          {orderStateLabel(order.orderState)}
          {order.payment ? ` · pago ${paymentStateLabel(order.payment.state).toLowerCase()}` : ""}
        </p>
        <p>
          {approved
            ? "Registramos tu pedido. Guarda el número para consultarlo. Esta compra de demostración no realizó ningún cobro real."
            : rejected
            ? "El pedido quedó cancelado. No se completó la compra y los libros siguen en tu carrito."
            : "Este es el estado actual de tu pedido."}
        </p>
        <div className="purchase-actions">
          {rejected ? (
            <>
              <ButtonLink variant="primary" to="/cart">Revisar el carrito</ButtonLink>
              <ButtonLink variant="text" to="/catalog">Seguir explorando</ButtonLink>
            </>
          ) : (
            <><ButtonLink variant="primary" to={returnTo}>Ver mis pedidos</ButtonLink><ButtonLink variant="text" to="/catalog">Seguir explorando el catálogo</ButtonLink></>
          )}
        </div>
      </header>

      <dl className="order-facts">
        <div><dt>Número de pedido</dt><dd>{order.orderId}</dd></div>
        {order.createdAt && <div><dt>Fecha</dt><dd>{orderDateLabel(order.createdAt)}</dd></div>}
        <div><dt>Total</dt><dd className="order-total">{formatUsd(order.total)}</dd></div>
        {order.payment && (
          <>
            <div><dt>Método</dt><dd>{paymentMethodLabel(order.payment.method)}</dd></div>
            {order.payment.reference && (
              <div className="order-facts-wide"><dt>Referencia de pago</dt><dd className="order-reference">{order.payment.reference}</dd></div>
            )}
          </>
        )}
      </dl>

      {order.payment?.method === "TRANSFER" && order.orderState !== "CANCELLED" && <section className="order-transfer" aria-labelledby="order-transfer-heading"><h2 id="order-transfer-heading">Datos para transferencia</h2>{transferDetails.data ? <><p>Usa el importe exacto y la referencia de este pedido. En esta demostración no debes enviar dinero.</p><TransferFacts details={transferDetails.data} amount={order.total} reference={order.payment.reference} /></> : transferDetails.isPending ? <p role="status">Consultando datos bancarios…</p> : <ReadFailure title="No pudimos consultar los datos bancarios." onRetry={() => void transferDetails.refetch()} retrying={transferDetails.isFetching} />}</section>}

      <div className="order-columns">
        <section aria-labelledby="order-items-heading">
          <h2 id="order-items-heading">Libros del pedido</h2>
          <ul className="summary-lines">
            {order.items.map((item) => (
              <li key={item.orderItemId}>
                <span className="summary-line-title">{item.title}</span>
                <span className="summary-line-meta">
                  {[item.authors, item.format ? formatEdition(item.format) : null].filter(Boolean).join(" · ")}
                </span>
                <span className="summary-line-meta">{unitsLabel(item.quantity)} × {formatUsd(item.unitPrice)}</span>
                <span className="summary-line-subtotal">{formatUsd(item.subtotal)}</span>
              </li>
            ))}
          </ul>
          <dl className="order-sum">
            <div><dt>Unidades</dt><dd>{units}</dd></div>
            <div className="purchase-total"><dt>Total</dt><dd>{formatUsd(order.total)}</dd></div>
          </dl>
        </section>

        {order.address && (
          <section aria-labelledby="order-address-heading">
            <h2 id="order-address-heading">Entrega</h2>
            <address className="order-address">
              <span>{order.address.recipient}</span>
              <span>{order.address.line1}</span>
              {order.address.line2 && <span>{order.address.line2}</span>}
              <span>{[order.address.city, order.address.province, new Intl.DisplayNames(["es"], { type: "region" }).of(order.address.countryCode)].filter(Boolean).join(", ")}</span>
              {order.address.reference && <span>{order.address.reference}</span>}
              <span>{order.address.phone}</span>
            </address>
            <p className="purchase-summary-note">Datos guardados con el pedido; no cambian si editas tus direcciones.</p>
          </section>
        )}
      </div>
      <section className="order-history" aria-labelledby="order-history-heading">
        <h2 id="order-history-heading">Historial del pedido</h2>
        {order.stateHistory.length ? <ol>{order.stateHistory.map((entry) => <li key={entry.historyId}><strong>{orderStateLabel(entry.newState)}</strong><time dateTime={entry.at}>{orderMomentLabel(entry.at)}</time></li>)}</ol> : <p>El historial de estados aún no está disponible.</p>}
      </section>
      <section className="order-cancellation" aria-labelledby="order-cancel-heading">
        <h2 id="order-cancel-heading">Cancelación</h2>
        {cancellable && !readCurrent ? <p>Actualiza el pedido para comprobar si aún se puede cancelar.</p> : cancellable ? <>
          <p>Puedes cancelar este pedido mientras esté {order.orderState === "CONFIRMED" ? "confirmado" : "en preparación"}. Los libros volverán a estar disponibles y el pago quedará reembolsado.</p>
          {!confirming ? <Button ref={cancelRef} variant="secondary" type="button" onClick={() => setConfirming(true)}>Cancelar pedido</Button> : <div className="order-cancel-confirm" role="group" aria-label="Confirmar cancelación">
            <p>¿Confirmas que deseas cancelar el pedido n.º {order.orderId}?</p>
            <div className="purchase-actions"><Button ref={confirmRef} variant="primary" type="button" disabled={cancellationPending} onClick={onCancel}>{cancellationPending ? "Cancelando pedido…" : "Confirmar cancelación"}</Button><Button variant="text" type="button" disabled={cancellationPending} onClick={() => { setConfirming(false); requestAnimationFrame(() => cancelRef.current?.focus({ preventScroll: true })); }}>Conservar pedido</Button></div>
          </div>}
        </> : <p>{order.orderState === "CANCELLED" ? "Este pedido ya está cancelado." : "Este pedido ya no se puede cancelar desde tu cuenta."}</p>}
      </section>
    </article>
  );
}
