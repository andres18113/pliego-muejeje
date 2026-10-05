import { MaterialSymbol } from "@/shared/ui/MaterialSymbol";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { useMutation, useQueries, useQueryClient } from "@tanstack/react-query";
import { Link, useLocation, useParams } from "react-router-dom";
import { Button, ButtonLink } from "@/components/ui/button";
import { useSession } from "@/app/session";
import { BookCover } from "@/features/catalog/BookCover";
import { formatEdition, formatUsd } from "@/features/catalog/formatters";
import { AccountShell } from "@/features/account/AccountShell";
import { getPublicEdition } from "@/shared/api/catalog";
import { ApiRequestError } from "@/shared/api/errors";
import { CancellationOutcomeUnknown, cancelOrder, type OrderCreditNote, type OrderDetail, type OrderInvoice, type OrderShipment } from "@/shared/api/orders";
import { ReadFailure } from "./CartPage";
import { CustomerOnly, PurchasePage } from "./PurchaseChrome";
import {
  deliveryWindowLabel, electronicIssuanceLabel, identityTypeLabel, orderDateLabel, orderMomentLabel,
  paymentMethodLabel, paymentStateLabel, shipmentStateLabel, ivaLabel,
} from "./purchaseText";
import { orderStory, type OrderStory } from "./orderStory";
import { useCustomerOrder } from "./ordersQuery";
import { ShipmentTrack } from "./ShipmentTrack";
import { OrderConfirmation } from "./OrderConfirmation";
import { useTransferDetails } from "@/shared/api/reference";
import { TransferFacts } from "./TransferFacts";
import { TransactionButtonLabel } from "@/shared/ui/TransactionButtonLabel";
import classes from "./orderPage.module.css";
import { PickupDetails } from "./PickupDetails";

export function OrderPage() {
  const { orderId = "" } = useParams();
  const location = useLocation();
  const state = location.state as { ordersPage?: unknown; purchased?: unknown } | null;
  const candidate = state?.ordersPage;
  // Checkout hands the new order over as the flow's last stage; any other visit is the order detail.
  const purchased = state?.purchased === true;
  const returnTo = typeof candidate === "number" && Number.isInteger(candidate) && candidate > 0 && candidate <= 99999
    ? `/orders?page=${candidate}` : "/orders";
  return (
    <PurchasePage title={`Pedido ${orderId}`}>
      <CustomerOnly intent={`/orders/${orderId}`} task="ver tu pedido">
        <OrderContent orderId={orderId} returnTo={returnTo} purchased={purchased} />
      </CustomerOnly>
    </PurchasePage>
  );
}

function OrderContent({ orderId, returnTo, purchased }: { orderId: string; returnTo: string; purchased: boolean }) {
  const { clear: clearSession } = useSession();
  const queryClient = useQueryClient();
  const [confirming, setConfirming] = useState(false);
  const [cancelMessage, setCancelMessage] = useState<{ text: string; error: boolean } | null>(null);
  const noticeRef = useRef<HTMLParagraphElement>(null);
  const validId = /^[1-9][0-9]{0,18}$/.test(orderId) && BigInt(orderId) <= 9223372036854775807n;
  const orderQuery = useCustomerOrder(orderId,validId);
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
  const headingRef = useRef<HTMLHeadingElement>(null);
  const loaded = Boolean(orderQuery.data);
  useEffect(() => {
    // The loading state unmounts when data arrives; keep keyboard and screen-reader users on the order.
    if (!loaded) return;
    const active = document.activeElement;
    if (!active || active === document.body || !active.isConnected) headingRef.current?.focus({ preventScroll: true });
  }, [loaded, purchased]);

  if (purchased && validId && orderQuery.data) {
    return <OrderConfirmation order={orderQuery.data} headingRef={headingRef} />;
  }

  const shell = (children: ReactNode) => <AccountShell
    title="Detalle del pedido"
    headingRef={headingRef}
    before={<Link to={returnTo} className={classes.back}><MaterialSymbol name="arrow_back" aria-hidden="true" size={18} /><span>Volver a mis pedidos</span></Link>}
  >{children}</AccountShell>;

  if (!validId || (orderQuery.error instanceof ApiRequestError && orderQuery.error.status === 404)) {
    return shell(
      <section className={`purchase-gate ${classes.missing}`} aria-labelledby="order-missing-heading">
        <h2 id="order-missing-heading">No encontramos este pedido.</h2>
        <p>Puede que el enlace no sea correcto o que el pedido no pertenezca a tu cuenta.</p>
        <div className="purchase-actions">
          <ButtonLink variant="secondary" to={returnTo}>Ver mis pedidos</ButtonLink>
        </div>
      </section>,
    );
  }

  if (orderQuery.isPending) return shell(<p className="purchase-loading" role="status">Consultando tu pedido…</p>);

  if (!orderQuery.data) {
    return shell(<ReadFailure title="No pudimos consultar tu pedido." onRetry={() => void orderQuery.refetch()} retrying={orderQuery.isFetching} />);
  }

  return shell(<>
    {orderQuery.isFetching && <p className="purchase-loading" role="status">Actualizando el pedido…</p>}
    {orderQuery.isError && <p className="stale-data-note" role="status">No pudimos actualizar este pedido. Se muestra la última consulta disponible. <Button variant="text" type="button" onClick={() => void orderQuery.refetch()}>Actualizar</Button></p>}
    {cancelMessage && <p
        ref={noticeRef}
        tabIndex={-1}
        className={`purchase-notice ${cancelMessage.error ? "purchase-notice--error" : "purchase-notice--success"}`}
        role={cancelMessage.error ? "alert" : "status"}
      >{cancelMessage.text}</p>}
    <OrderView order={orderQuery.data} readCurrent={!orderQuery.isError && !orderQuery.isFetching} confirming={confirming} setConfirming={setConfirming} cancellationPending={cancellation.isPending} onCancel={() => { if (!cancellation.isPending) cancellation.mutate(); }} />
  </>);
}

interface OrderViewProps {
  order: OrderDetail;
  readCurrent: boolean;
  confirming: boolean;
  setConfirming: (value: boolean) => void;
  cancellationPending: boolean;
  onCancel: () => void;
}

/**
 * One composition for every state: the order's identity in one row, then the fulfillment panel (state,
 * what happens next, progress, destination and the purchased books) beside a compact payment card.
 * The server-reported state changes what the panel says and shows, never the layout.
 */
function OrderView({ order, readCurrent, confirming, setConfirming, cancellationPending, onCancel }: OrderViewProps) {
  const coverQueries = useQueries({
    queries: order.items.map((item) => ({
      queryKey: ["order-item-cover", item.editionId],
      queryFn: ({ signal }: { signal: AbortSignal }) => getPublicEdition(item.editionId!, signal),
      enabled: Boolean(item.editionId),
      staleTime: 60 * 60 * 1000,
      retry: false,
    })),
  });
  const story = orderStory({ orderState: order.orderState, purchaseState: order.purchaseState, paymentState: order.payment?.state,
    shipmentState: order.shipment?.state ?? null, fulfillmentMethod: order.fulfillment?.method, pickupState: order.fulfillment?.state });
  const closed = story.kind === "cancelled" || story.kind === "payment-rejected";
  const shipment = order.shipment;
  const window = shipment && (story.kind === "preparing" || story.kind === "in-transit")
    ? deliveryWindowLabel(shipment.estimatedDeliveryFrom, shipment.estimatedDeliveryTo) : null;

  return (
    <article className={classes.order} aria-labelledby="order-story-heading">
      <dl className={classes.facts}>
        <div><dt>Pedido N.°</dt><dd>{order.orderId}</dd></div>
        {order.createdAt && <div><dt>Realizado</dt><dd><time dateTime={order.createdAt}>{orderDateLabel(order.createdAt)}</time></dd></div>}
        <div><dt>Total</dt><dd>{formatUsd(order.total)}</dd></div>
      </dl>

      <div className={classes.layout}>
        <section className={classes.main} data-tone={story.tone} data-story={story.kind} aria-labelledby="order-story-heading">
          <div className={classes.status}>
            <h2 id="order-story-heading" className={classes.headline}>{story.headline}</h2>
            <StoryLead order={order} story={story} />
            {window && <p className={classes.estimate}>Llega {window}</p>}
          </div>
          <CancelAction order={order} readCurrent={readCurrent} confirming={confirming} setConfirming={setConfirming} cancellationPending={cancellationPending} onCancel={onCancel} />
          {shipment && !closed && <ShipmentTrack shipment={shipment} />}
          <StoryAction order={order} story={story} />
          {shipment && (story.kind === "in-transit" || story.kind === "delivered") && <ShipmentHistory shipment={shipment} />}
          <Destination order={order} story={story} />
          <Books order={order} covers={coverQueries.map((query) => query.data)} />
        </section>
        <aside className={classes.aside} aria-label="Pago y documentos">
          <PaymentPanel order={order} />
          {(order.invoice || order.creditNotes.length > 0) && <DocumentsPanel invoice={order.invoice} creditNotes={order.creditNotes} />}
        </aside>
      </div>
    </article>
  );
}

function StoryLead({ order, story }: { order: OrderDetail; story: OrderStory }) {
  const { session } = useSession();
  const shipment = order.shipment;
  let text: ReactNode;
  switch (story.kind) {
    case "preparing":
      text = shipment?.state === "PREPARING" ? "Estamos preparando tus libros." : "Tu compra está confirmada y aún no sale hacia tu dirección.";
      break;
    case "in-transit":
      text = <>{shipment?.state === "OUT_FOR_DELIVERY" ? "Tu pedido salió a reparto" : "Tu pedido va en camino"}{shipment?.carrier ? <> con {shipment.carrier}</> : null}.</>;
      break;
    case "delivered":
      text = order.fulfillment?.method === "STORE_PICKUP" ? "Tu pedido fue retirado en el punto elegido." : shipment?.deliveredAt
        ? <>Lo entregamos el {orderMomentLabel(shipment.deliveredAt)}{order.address ? <> en {order.address.city}.</> : orderMomentLabel(shipment.deliveredAt).endsWith(".") ? null : "."}</>
        : "Tu pedido fue entregado.";
      break;
    case "cancelled": {
      // "A petición tuya" only when the order's own history says this customer made the change.
      const actor = [...order.stateHistory].reverse().find((entry) => entry.newState === "CANCELLED")?.actorUserId;
      text = actor && actor === session?.user.userId ? "Tu pedido fue cancelado a petición tuya." : "Tu pedido fue cancelado.";
      break;
    }
    case "payment-rejected":
      text = "El pago no fue aprobado y no se cobró este pedido. Los libros siguen en tu carrito.";
      break;
    case "awaiting-payment":
      text = order.payment?.method === "TRANSFER" ? "Completa la transferencia para confirmar tu compra." : "Esperamos la confirmación del pago.";
      break;
    default:
      text = order.fulfillment?.method === "STORE_PICKUP" ? "Tu compra está confirmada. Te esperamos en el punto de retiro." : "Tu compra está confirmada.";
  }
  return <>
    <p className={classes.lead}>{text}</p>
    {story.kind === "cancelled" && order.payment?.state === "REFUNDED" && <p className={classes.lead}>Tu pago fue reembolsado.</p>}
  </>;
}

/** Cancellation is offered only when the server says so; the command revalidates under the order lock. */
function CancelAction({ order, readCurrent, confirming, setConfirming, cancellationPending, onCancel }: OrderViewProps) {
  const confirmRef = useRef<HTMLButtonElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  useEffect(() => { if (confirming) confirmRef.current?.focus({ preventScroll: true }); }, [confirming]);
  if (!order.availableActions.cancel) return null;
  return <div className={classes.cancel}>
    {!readCurrent ? <p>Actualiza el pedido para comprobar si aún se puede cancelar.</p> : !confirming ? <>
      <p>Aún puedes cancelarlo: se reembolsará el pago y se liberarán los libros.</p>
      <Button ref={cancelRef} variant="secondary" type="button" onClick={() => setConfirming(true)}>Cancelar pedido</Button>
    </> : <div className={classes.cancelConfirm} role="group" aria-label="Confirmar cancelación">
      <p>¿Cancelar el pedido N.° {order.orderId}? Se reembolsarán {formatUsd(order.total)}.</p>
      <div className="purchase-actions">
        <Button ref={confirmRef} variant="primary" type="button" aria-label={cancellationPending ? "Cancelando pedido" : "Confirmar cancelación"} aria-disabled={cancellationPending || undefined} aria-busy={cancellationPending || undefined} onClick={onCancel}><TransactionButtonLabel state={cancellationPending ? "pending" : "idle"} idle="Confirmar cancelación" pending="Cancelando pedido…" success="Cancelado" reserve="Cancelando pedido…" /></Button>
        <Button variant="text" type="button" aria-disabled={cancellationPending || undefined} onClick={() => { if (cancellationPending) return; setConfirming(false); requestAnimationFrame(() => cancelRef.current?.focus({ preventScroll: true })); }}>Conservar pedido</Button>
      </div>
    </div>}
  </div>;
}

function StoryAction({ order, story }: { order: OrderDetail; story: OrderStory }) {
  const transferDetails = useTransferDetails(order.payment?.method === "TRANSFER" && story.kind === "awaiting-payment");
  const actions: ReactNode[] = [];
  if ((story.kind === "in-transit" || story.kind === "delivered") && order.shipment?.trackingCode) actions.push(<TrackingFacts key="tracking" shipment={order.shipment} />);
  if (story.kind === "payment-rejected") actions.push(<div key="cart" className={classes.actionRow}><ButtonLink variant="primary" to="/cart">Revisar el carrito</ButtonLink></div>);
  if (story.kind === "awaiting-payment" && order.payment?.method === "TRANSFER") {
    actions.push(<div key="transfer" className={classes.inset}>{transferDetails.data
      ? <TransferFacts details={transferDetails.data} amount={order.total} reference={order.payment.reference} />
      : transferDetails.isPending
        ? <p role="status">Consultando datos bancarios…</p>
        : <ReadFailure title="No pudimos consultar los datos bancarios." onRetry={() => void transferDetails.refetch()} retrying={transferDetails.isFetching} />}</div>);
  }
  return actions.length ? <>{actions}</> : null;
}

function TrackingFacts({ shipment }: { shipment: OrderShipment }) {
  const [copied, setCopied] = useState<"ok" | "error" | null>(null);
  async function copy() {
    try { await navigator.clipboard.writeText(shipment.trackingCode ?? ""); setCopied("ok"); } catch { setCopied("error"); }
  }
  return <div className={classes.tracking}>
    <p className={classes.trackingCode}>
      <span>Guía {shipment.carrier ? `de ${shipment.carrier}` : "de envío"}</span>{" "}
      <strong>{shipment.trackingCode}</strong>
    </p>
    <button type="button" className={classes.copy} onClick={() => void copy()}><MaterialSymbol name={copied === "ok" ? "check" : "content_copy"} aria-hidden="true" size={18} />{copied === "ok" ? "Guía copiada" : "Copiar guía"}</button>
    {shipment.trackingUrl && <a className={classes.follow} href={shipment.trackingUrl} target="_blank" rel="noopener noreferrer"><span>Seguir el envío</span><span className="visually-hidden"> (se abre en otra pestaña)</span><MaterialSymbol name="arrow_forward" aria-hidden="true" size={18} /></a>}
    <p className="visually-hidden" role="status">{copied === "ok" ? "Guía copiada." : copied === "error" ? "No pudimos copiar la guía. Selecciónala y cópiala manualmente." : ""}</p>
  </div>;
}

/** Only what the server recorded for this shipment; nothing is inferred. The latest three lead, the rest open on request. */
function ShipmentHistory({ shipment }: { shipment: OrderShipment }) {
  const [all, setAll] = useState(false);
  const events = shipment.history.map((event) => ({
    id: event.eventId,
    at: event.at,
    title: event.type === "TRACKING" ? "Datos de seguimiento actualizados" : event.newState ? shipmentStateLabel(event.newState) : "Actualización del envío",
    detail: event.type === "TRACKING" ? [event.carrier, event.trackingCode].filter(Boolean).join(", ") || null : null,
  })).sort((a, b) => b.at.localeCompare(a.at));
  if (events.length < 2) return null;
  const shown = all ? events : events.slice(0, 3);
  return <div className={classes.history}>
    <h3 id="order-history-heading" className="visually-hidden">Seguimiento</h3>
    <ol className={classes.timeline} aria-labelledby="order-history-heading">
      {shown.map((event) => <li key={event.id}>
        <time dateTime={event.at}>{orderMomentLabel(event.at)}</time>
        <span><strong>{event.title}</strong>{event.detail && <span>{event.detail}</span>}</span>
      </li>)}
    </ol>
    {events.length > 3 && <button type="button" className={classes.more} aria-expanded={all} onClick={() => setAll(!all)}>{all ? "Ver menos" : "Ver todo"}</button>}
  </div>;
}

function Destination({ order, story }: { order: OrderDetail; story: OrderStory }) {
  if (order.fulfillment?.method === "STORE_PICKUP" && order.fulfillment.pickup) {
    return <div className={classes.destination} data-kind="pickup">
      <h3>Retiro en tienda</h3>
      <PickupDetails pickup={order.fulfillment.pickup} state={order.fulfillment.state} collectedAt={order.fulfillment.collectedAt} showTimezone={false} />
    </div>;
  }
  const address = order.address;
  if (!address) return !order.fulfillment && !order.shipment ? null : <p className={classes.quiet}>Los datos de entrega no están disponibles.</p>;
  const title = story.kind === "delivered" ? "Entregado en" : story.kind === "cancelled" || story.kind === "payment-rejected" ? "Dirección del pedido" : "Se entregará en";
  return <div className={classes.destination}>
    <h3>{title}</h3>
    <address className={classes.address}>
      <span>{address.recipient}</span>
      <span>{address.line1}{address.line2 && <>, {address.line2}</>}</span>
      <span>{[address.city, address.province, new Intl.DisplayNames(["es"], { type: "region" }).of(address.countryCode)].filter(Boolean).join(", ")}{address.postalCode && <> {address.postalCode}</>}</span>
      {address.reference && <span>Referencia: {address.reference}</span>}
      <span>{address.phone}</span>
    </address>
  </div>;
}

/** Titles, prices and quantities exactly as purchased; only the cover is looked up by edition. */
function Books({ order, covers }: { order: OrderDetail; covers: ({ coverUrl?: string | null; coverLicense?: string | null; coverAttribution?: string | null } | undefined)[] }) {
  return <div className={classes.books}>
    <h3 id="order-items-heading" className="visually-hidden">Libros del pedido</h3>
    <ul aria-labelledby="order-items-heading">
      {order.items.map((item, index) => {
        const edition = covers[index];
        return <li className={classes.book} key={item.orderItemId}>
          <span className={classes.bookCover}><BookCover url={edition?.coverUrl ?? null} license={edition?.coverLicense ?? null} attribution={edition?.coverAttribution ?? null} title={item.title} size="compact" loading={index === 0 ? "eager" : "lazy"} /></span>
          <div className={classes.bookCopy}>
            <h4>{item.title}</h4>
            <p>{[item.authors || "Autor no disponible", item.format ? formatEdition(item.format) : null].filter(Boolean).join(", ")}</p>
            <p className={classes.bookPrice}><strong>{formatUsd(item.unitPrice)}</strong><span>Cantidad: {item.quantity}</span></p>
          </div>
        </li>;
      })}
    </ul>
  </div>;
}

function PaymentPanel({ order }: { order: OrderDetail }) {
  const payment = order.payment;
  return <section className={classes.panel} aria-labelledby="order-payment-heading">
    <h2 id="order-payment-heading">Pago</h2>
    {payment ? <p className={classes.paymentLine}>
      <MaterialSymbol name="credit_card" aria-hidden="true" size={20} />
      <span><strong>{paymentMethodLabel(payment.method)}</strong><span className={classes.paymentState} data-state={payment.state}>{paymentStateLabel(payment.state)}</span></span>
    </p> : <p className={classes.quiet}>Los datos del pago no están disponibles.</p>}
    <dl className={classes.totals}>
      {order.subtotal && <div><dt>Subtotal</dt><dd>{formatUsd(order.subtotal)}</dd></div>}
      {order.taxAmount && <div><dt>{ivaLabel(order.taxRate)}</dt><dd>{formatUsd(order.taxAmount)}</dd></div>}
      {order.shippingAmount && <div><dt>Gastos de envío</dt><dd>{formatUsd(order.shippingAmount)}</dd></div>}
      <div className={classes.grandTotal}><dt>Total</dt><dd>{formatUsd(order.total)}</dd></div>
      {payment?.state === "REFUNDED" && <div className={classes.refund}><dt>Reembolsado</dt><dd>{formatUsd(payment.amount)}</dd></div>}
    </dl>
  </section>;
}

/** Documents exist only as the server reports them; nothing here implies electronic authorization or downloads that are not available. */
function DocumentsPanel({ invoice, creditNotes }: { invoice: OrderInvoice | null; creditNotes: OrderCreditNote[] }) {
  return <section className={classes.panel} aria-labelledby="order-documents-heading">
    <h2 id="order-documents-heading">{creditNotes.length ? "Factura y notas de crédito" : "Factura"}</h2>
    {invoice && <InvoiceFacts invoice={invoice} />}
    {creditNotes.map((note) => <div key={note.creditNoteId} className={classes.document} data-kind="credit">
      <h3>Nota de crédito N.° {note.documentNumber}</h3>
      <dl>
        <div><dt>Emitida</dt><dd><time dateTime={note.issuedAt}>{orderDateLabel(note.issuedAt)}</time></dd></div>
        <div><dt>Motivo</dt><dd>{note.reason}</dd></div>
        <div><dt>Total</dt><dd>{formatUsd(note.total)}</dd></div>
      </dl>
    </div>)}
  </section>;
}

function InvoiceFacts({ invoice }: { invoice: OrderInvoice }) {
  const notAssessed = invoice.items.length > 0 && invoice.items.every((item) => item.taxTreatment === "NOT_ASSESSED");
  const billing = invoice.billingAddress;
  const authorized = invoice.electronicIssuance?.state === "AUTHORIZED";
  return <div className={classes.document} data-kind="invoice">
    <h3>Factura comercial N.° {invoice.documentNumber}</h3>
    <dl>
      <div><dt>Emitida</dt><dd><time dateTime={invoice.issuedAt}>{orderDateLabel(invoice.issuedAt)}</time></dd></div>
      <div><dt>A nombre de</dt><dd>{invoice.buyerName}<span>{identityTypeLabel(invoice.identityType)} {invoice.identityNumber}</span></dd></div>
      {billing && <div><dt>Facturación</dt><dd>{billing.line1}{billing.line2 && <>, {billing.line2}</>}<span>{[billing.city, billing.province].join(", ")}</span></dd></div>}
      <div><dt>Impuestos</dt><dd>{notAssessed ? "No calculados" : formatUsd(invoice.taxTotal)}</dd></div>
      <div><dt>Total</dt><dd>{formatUsd(invoice.total)}</dd></div>
      <div><dt>Autorización electrónica</dt><dd>{invoice.electronicIssuance ? electronicIssuanceLabel(invoice.electronicIssuance.state) : "Aún no disponible"}</dd></div>
    </dl>
    <p className={classes.snapshotNote}>{authorized ? "" : "Documento comercial de PLIEGO; todavía no es un comprobante electrónico autorizado. "}{invoice.pdfAvailable || invoice.xmlAvailable ? "Su descarga aún no está habilitada en tu cuenta." : "PDF y XML aún no disponibles."}</p>
  </div>;
}
