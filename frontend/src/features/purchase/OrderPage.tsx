import { LibraryAccessLink } from "./LibraryAccessLink";
import { MaterialSymbol } from "@/shared/ui/MaterialSymbol";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { useMutation, useQueries, useQueryClient } from "@tanstack/react-query";
import { useLocation, useParams } from "react-router-dom";
import { Button, ButtonLink } from "@/components/ui/button";
import { useSession } from "@/app/session";
import { BookCover } from "@/features/catalog/BookCover";
import { formatEdition, formatUsd } from "@/features/catalog/formatters";
import { AccountShell } from "@/features/account/AccountShell";
import { getPublicEdition } from "@/shared/api/catalog";
import { ApiRequestError } from "@/shared/api/errors";
import { CancellationOutcomeUnknown, cancelOrder, type OrderDetail, type OrderItemDigitalAccess, type OrderShipment } from "@/shared/api/orders";

type OrderItem = OrderDetail["items"][number];
import { ReadFailure } from "./CartPage";
import { hasSaving } from "./cartPricingViewModel";
import { toOrderPricingViewModel } from "./orderPricingViewModel";
import { CustomerOnly, PurchasePage } from "./PurchaseChrome";
import {
  deliveryWindowLabel, orderDateLabel, orderMomentLabel, orderReference,
  paymentMethodLabel, paymentStateLabel, shipmentStateLabel, ivaLabel,
} from "./purchaseText";
import { orderStory, purchaseWindowView, type OrderStory, type PurchaseWindowView } from "./orderStory";
import { useCustomerOrder, useRefetchAtCancellationDeadline } from "./ordersQuery";
import { ShipmentTrack } from "./ShipmentTrack";
import { OrderConfirmation } from "./OrderConfirmation";
import { useTransferDetails } from "@/shared/api/reference";
import { TransferFacts } from "./TransferFacts";
import { useSessionOperationScope, type SessionOperationScope } from "@/app/sessionOperation";
import { ConfirmDialog } from "@/shared/ui/ConfirmDialog";
import classes from "./orderPage.module.css";
import { InvoiceAction } from "./InvoiceAction";
import { PickupDetails } from "./PickupDetails";
import { cancellationCondition, cancellationEnded } from "./cancellationPolicy";

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
    <PurchasePage title="Detalle del pedido">
      <CustomerOnly intent={`/orders/${orderId}`} task="ver tu pedido">
        <OrderContent key={orderId} orderId={orderId} returnTo={returnTo} purchased={purchased} />
      </CustomerOnly>
    </PurchasePage>
  );
}

function OrderContent({ orderId, returnTo, purchased }: { orderId: string; returnTo: string; purchased: boolean }) {
  const scope = useSessionOperationScope(orderId);
  const { clear: clearSession } = useSession();
  const queryClient = useQueryClient();
  const [confirming, setConfirming] = useState(false);
  const [cancelMessage, setCancelMessage] = useState<{ text: string; detail?: string; error: boolean } | null>(null);
  const noticeRef = useRef<HTMLParagraphElement>(null);
  const validId = /^[1-9][0-9]{0,18}$/.test(orderId) && BigInt(orderId) <= 9223372036854775807n;
  const orderQuery = useCustomerOrder(orderId,validId);
  // When the server's cancellation deadline arrives, read the order again; the response alone decides what shows.
  const actions = orderQuery.data?.availableActions;
  useRefetchAtCancellationDeadline([actions?.canCancel ? actions.cancellationDeadline : null], orderQuery.refetch);
  // Seen cancelable on this visit and no longer offered (window closed, shipment left): say so instead of going silent.
  const canCancelNow = Boolean(actions?.canCancel ?? actions?.cancel);
  const [seenCancelable, setSeenCancelable] = useState(false);
  if (canCancelNow && !seenCancelable) setSeenCancelable(true);
  const cancelEnded = seenCancelable && !canCancelNow && Boolean(orderQuery.data) && orderQuery.data?.orderState !== "CANCELLED";
  const cancellation = useMutation({
    meta: { authRequired: true },
    mutationFn: ({scope:issued,target}:{scope:SessionOperationScope;target:string}) => { issued.assertCurrent(); return cancelOrder(target); },
    onSuccess: async (_result,{scope:issued}) => {
      if (!issued.isCurrent()) return;
      setConfirming(false);
      setCancelMessage({ text: "El pago fue reembolsado.", detail: "No necesitas realizar ninguna acción adicional.", error: false });
      await Promise.all([orderQuery.refetch(), queryClient.invalidateQueries({ queryKey: ["customer-orders"] }), queryClient.invalidateQueries({ queryKey: ["customer-library"] })]);
    },
    onError: async (error,{scope:issued}) => {
      if (!issued.isCurrent()) return;
      setConfirming(false);
      if (error instanceof ApiRequestError && error.status === 401) { clearSession("expired"); return; }
      const [refreshed] = await Promise.all([orderQuery.refetch(), queryClient.invalidateQueries({ queryKey: ["customer-orders"] }), queryClient.invalidateQueries({ queryKey: ["customer-library"] })]);
      if (!issued.isCurrent()) return;
      if (error instanceof CancellationOutcomeUnknown && refreshed.data?.orderState === "CANCELLED" && refreshed.data.payment?.state === "REFUNDED") {
        setCancelMessage({ text: "Confirmamos que el pedido se canceló y el pago quedó reembolsado.", detail: "No necesitas realizar ninguna acción adicional.", error: false });
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
    return <OrderConfirmation order={orderQuery.data} headingRef={headingRef} cancelEnded={cancelEnded} />;
  }

  const shell = (children: ReactNode) => <AccountShell
    title="Detalle del pedido"
    headingRef={headingRef}
    // Where the order sits, as one trail (Google Store: Home | Order history | Order details); "Pedidos" keeps the list's page.
    trail="Detalle del pedido" trailParents={[{ label: "Pedidos", to: returnTo }]} trailWidth="1000px"
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
    {orderQuery.isError && <p className={`stale-data-note ${classes.onAxis}`} role="status">No pudimos actualizar este pedido. Se muestra la última consulta disponible. <Button variant="text" type="button" onClick={() => void orderQuery.refetch()}>Actualizar</Button></p>}
    {cancelMessage && <p
        ref={noticeRef}
        tabIndex={-1}
        className={`purchase-notice ${classes.onAxis} ${cancelMessage.error ? "purchase-notice--error" : "purchase-notice--success"}`}
        role={cancelMessage.error ? "alert" : "status"}
      >{cancelMessage.detail ? <><strong>{cancelMessage.text}</strong><span>{cancelMessage.detail}</span></> : cancelMessage.text}</p>}
    <OrderView order={orderQuery.data} cancelEnded={cancelEnded} readCurrent={!orderQuery.isError && !orderQuery.isFetching} confirming={confirming} setConfirming={setConfirming} cancellationPending={cancellation.isPending} onCancel={() => { if (!cancellation.isPending) cancellation.mutate({scope,target:orderId}); }} />
  </>);
}

interface OrderViewProps {
  order: OrderDetail;
  /** Cancelable earlier on this visit and no longer offered by the server. */
  cancelEnded: boolean;
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
function OrderView({ order, cancelEnded, readCurrent, confirming, setConfirming, cancellationPending, onCancel }: OrderViewProps) {
  const coverQueries = useQueries({
    queries: order.items.map((item) => ({
      queryKey: ["order-item-cover", item.editionId],
      queryFn: ({ signal }: { signal: AbortSignal }) => getPublicEdition(item.editionId!, signal),
      enabled: Boolean(item.editionId),
      staleTime: 60 * 60 * 1000,
      retry: false,
    })),
  });
  const windowView = purchaseWindowView(order.availableActions?.lifecycleState, {
    digitalOnly: order.fulfillment == null && !order.items.some((item) => item.requiresPhysicalFulfillment),
    pickup: order.fulfillment?.method === "STORE_PICKUP",
  });
  const baseStory = orderStory({ orderState: order.orderState, purchaseState: order.purchaseState, paymentState: order.payment?.state,
    shipmentState: order.shipment?.state ?? null, fulfillmentMethod: order.fulfillment?.method, pickupState: order.fulfillment?.state });
  // A digital purchase reads as confirmed while its window is open and as thanks once the server finalizes it.
  const story: OrderStory = windowView === "digital-window" ? { ...baseStory, headline: "Compra confirmada" }
    : windowView === "digital-complete" ? { ...baseStory, tone: "arrived", headline: "¡Gracias por tu compra!" } : baseStory;
  const closed = story.kind === "cancelled" || story.kind === "payment-rejected";
  const shipment = order.shipment;
  // A mixed order: printed books stay in the shipping/pickup story; digital titles get their own access section.
  const physicalItems = order.items.filter((item) => item.requiresPhysicalFulfillment);
  const digitalItems = order.items.filter((item) => !item.requiresPhysicalFulfillment);
  const mixed = physicalItems.length > 0 && digitalItems.length > 0;
  const coverOf = (item: OrderItem) => coverQueries[order.items.indexOf(item)]?.data;
  const window = shipment && (story.kind === "preparing" || story.kind === "in-transit")
    ? deliveryWindowLabel(shipment.estimatedDeliveryFrom, shipment.estimatedDeliveryTo) : null;

  return (
    <article className={classes.order} aria-labelledby="order-story-heading">
      <dl className={classes.facts}>
        <div><dt>Pedido</dt><dd>{orderReference(order)}</dd></div>
        {order.createdAt && <div><dt>Realizado</dt><dd><time dateTime={order.createdAt}>{orderDateLabel(order.createdAt)}</time></dd></div>}
        <div><dt>Total</dt><dd>{formatUsd(order.total)}</dd></div>
      </dl>

      <div className={classes.layout}>
        <div className={classes.column}>
        <section className={classes.main} data-tone={story.tone} data-story={story.kind} aria-labelledby="order-story-heading">
          <div className={classes.status}>
            <h2 id="order-story-heading" className={classes.headline}>{story.headline}</h2>
            <StoryLead order={order} story={story} windowView={windowView} />
            {window && <p className={classes.estimate}>Llega {window}</p>}
          </div>
          {/* Right under the state: when cancelling is possible is part of what the order is now, so it never sits
              below a long list of books. Quiet (a text action), so the story keeps one emphasised action. */}
          <CancelAction order={order} cancelEnded={cancelEnded} readCurrent={readCurrent} confirming={confirming} setConfirming={setConfirming} cancellationPending={cancellationPending} onCancel={onCancel} />
          {shipment && !closed && <ShipmentTrack shipment={shipment} />}
          <StoryAction order={order} story={story} />
          {shipment && (story.kind === "in-transit" || story.kind === "delivered") && <ShipmentHistory shipment={shipment} />}
          <Destination order={order} story={story} />
          <Books order={order} items={mixed ? physicalItems : order.items} coverOf={coverOf} label={mixed ? "Libros impresos del pedido" : "Libros del pedido"} />
        </section>
        {mixed && <DigitalAccess order={order} items={digitalItems} coverOf={coverOf} />}
        </div>
        <aside className={classes.aside} aria-label="Pago y factura">
          <PaymentPanel order={order} />
        </aside>
      </div>
    </article>
  );
}

function StoryLead({ order, story, windowView }: { order: OrderDetail; story: OrderStory; windowView: PurchaseWindowView }) {
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
      text = order.fulfillment?.method !== "STORE_PICKUP" ? "Tu compra está confirmada."
        : order.fulfillment.state === "READY" ? "Tu pedido está listo. Te esperamos en el punto de retiro."
        : order.fulfillment.state === "PENDING" ? "Estamos preparando tu pedido para el retiro."
        : "Tu compra está confirmada. Te esperamos en el punto de retiro.";
  }
  // Inside the window the story states the purchase; the cancellation strip alone says it can still be cancelled.
  if (windowView === "digital-window") text = "Tu compra está confirmada.";
  if (windowView === "digital-complete") return <>
    <p className={classes.lead}>Tu compra está confirmada.</p>
    <p className={classes.lead}>Puedes revisar tus artículos comprados en Mi biblioteca.</p>
  </>;
  return <>
    <p className={classes.lead}>{text}</p>
    {story.kind === "cancelled" && order.payment?.state === "REFUNDED" && <p className={classes.lead}>Tu pago fue reembolsado.</p>}
  </>;
}

/** A paid mixed order cancels as a whole: one refund, printed books released and every digital title revoked. */
function isMixedOrder(order: OrderDetail) {
  return order.items.some((item) => item.requiresPhysicalFulfillment) && order.items.some((item) => !item.requiresPhysicalFulfillment);
}

/** What the cancellation releases besides the payment, in the order's own terms. */
function cancelRelease(order: OrderDetail) {
  const digitalOnly = order.fulfillment == null && !order.items.some((item) => item.requiresPhysicalFulfillment);
  if (digitalOnly) return "La compra dejará de estar en Mi biblioteca.";
  if (isMixedOrder(order) && order.payment?.state !== "PENDING") return "Los libros impresos reservados quedarán libres y los títulos digitales saldrán de Mi biblioteca.";
  return "Los libros reservados para este pedido quedarán libres.";
}

/**
 * Cancellation is offered only when the server says so; the command revalidates under the order lock. The line states
 * when, in the server's own rule (`cancellationPolicy.ts`); the refund and what is released are asked in the shared
 * destructive confirmation; keeping the order returns focus to "Cancelar pedido", and the outcome notice takes focus
 * once the command answers. When the server stops offering it during the visit, one quiet line says why.
 */
function CancelAction({ order, cancelEnded, readCurrent, confirming, setConfirming, cancellationPending, onCancel }: OrderViewProps) {
  const cancelRef = useRef<HTMLButtonElement>(null);
  if (!(order.availableActions?.canCancel ?? order.availableActions?.cancel)) {
    return cancelEnded ? <p className={classes.cancelEnded} role="status" data-order="cancel-ended">
      <MaterialSymbol name="schedule" size={18} aria-hidden="true" /><span>{cancellationEnded(order)}</span>
    </p> : null;
  }
  const keep = () => { setConfirming(false); requestAnimationFrame(() => cancelRef.current?.focus({ preventScroll: true })); };
  return <div className={classes.cancel} data-order="cancel">
    {!readCurrent ? <p>Actualiza el pedido para comprobar si aún se puede cancelar.</p> : <>
      <p><MaterialSymbol name="schedule" size={18} aria-hidden="true" /><span>{cancellationCondition(order)}</span></p>
      <button ref={cancelRef} type="button" className={classes.cancelLink} onClick={() => setConfirming(true)}>Cancelar pedido</button>
    </>}
    <ConfirmDialog opened={confirming} destructive title={`¿Cancelar el pedido ${orderReference(order)}?`}
      confirmLabel="Confirmar cancelación" busyLabel="Cancelando pedido…" keepLabel="Conservar pedido" busy={cancellationPending}
      onConfirm={onCancel} onKeep={keep}>
      <p>{order.payment?.state === "PENDING" ? "No se realizará ningún cobro por este pedido." : `Se reembolsarán ${formatUsd(order.total)} del pago de este pedido.`}</p>
      <p>{cancelRelease(order)}</p>
    </ConfirmDialog>
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
  // One scannable column: a dot on a rail, the moment, and right beside it what happened (the latest first, marked).
  return <div className={classes.history}>
    <h3 id="order-history-heading" className="visually-hidden">Seguimiento</h3>
    <ol className={classes.timeline} aria-labelledby="order-history-heading">
      {shown.map((event, index) => <li key={event.id} data-latest={index === 0 || undefined}>
        <span className={classes.dot} aria-hidden="true" />
        <time dateTime={event.at}>{orderMomentLabel(event.at)}</time>
        <span className={classes.event}><strong>{event.title}</strong>{event.detail && <span>{event.detail}</span>}</span>
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

type CoverOf = (item: OrderItem) => { coverUrl?: string | null; coverLicense?: string | null; coverAttribution?: string | null } | undefined;

/** Titles, prices and quantities exactly as purchased; only the cover is looked up by edition. */
function Books({ order, items, coverOf, label }: { order: OrderDetail; items: OrderItem[]; coverOf: CoverOf; label: string }) {
  return <div className={classes.books}>
    <h3 id="order-items-heading" className="visually-hidden">{label}</h3>
    <ul aria-labelledby="order-items-heading">
      {/* A paid digital title opens straight from its line; printed books and unpaid or revoked titles have no action. */}
      {items.map((item, index) => <BookLine key={item.orderItemId} order={order} item={item} cover={coverOf(item)} eager={index === 0}>
        <LibraryAccessLink order={order} item={item} />
      </BookLine>)}
    </ul>
  </div>;
}

function BookLine({ order, item, cover: edition, eager, children }: { order: OrderDetail; item: OrderItem; cover: ReturnType<CoverOf>; eager: boolean; children?: ReactNode }) {
  // The line's saving from the order's immutable snapshot; nothing is recalculated.
  const line = toOrderPricingViewModel(order).lines.find((candidate) => candidate.orderItemId === item.orderItemId);
  const saving = line?.pricingSnapshotAvailable && line.lineSavings && hasSaving(line.lineSavings.rawValue) ? line.lineSavings : null;
  return <li className={classes.book}>
    <span className={classes.bookCover}><BookCover url={edition?.coverUrl ?? null} license={edition?.coverLicense ?? null} attribution={edition?.coverAttribution ?? null} title={item.title} size="compact" loading={eager ? "eager" : "lazy"} /></span>
    <div className={classes.bookCopy}>
      <h4>{item.title}</h4>
      <p>{[item.authors || "Autor no disponible", item.format ? formatEdition(item.format) : null].filter(Boolean).join(", ")}</p>
      <p className={classes.bookPrice}><strong>{formatUsd(item.unitPrice)}</strong>
        {saving && line?.originalPrice && <s className={classes.bookWas}><span className="visually-hidden">Precio anterior: </span>{line.originalPrice.formattedValue}</s>}
        <span>Cantidad: {item.quantity}</span></p>
      {saving && <p className={classes.bookSaving} data-order-saving><MaterialSymbol name="sell" size={18} aria-hidden="true" /><span>Ahorraste {saving.formattedValue} en este artículo</span></p>}
      {children}
    </div>
  </li>;
}

/** Each digital line's own access, from the server's per-line projection (V077); never inferred from the shipment. */
const digitalAccessCopy: Record<OrderItemDigitalAccess["state"], { icon: "check_circle" | "schedule" | "block"; text: string }> = {
  AVAILABLE: { icon: "check_circle", text: "En Mi biblioteca" },
  PENDING_PAYMENT: { icon: "schedule", text: "Se añadirá a Mi biblioteca cuando se apruebe el pago." },
  REVOKED: { icon: "block", text: "Retirado de Mi biblioteca al cancelar el pedido." },
  UNAVAILABLE: { icon: "block", text: "Sin acceso: el pedido no se completó." },
};

/**
 * A mixed order's digital titles, apart from the shipment: they are not sent, they join Mi biblioteca once the
 * payment is approved and leave it if the order is cancelled.
 */
function DigitalAccess({ order, items, coverOf }: { order: OrderDetail; items: OrderItem[]; coverOf: CoverOf }) {
  return <section className={classes.digital} aria-labelledby="order-digital-heading">
    <div className={classes.digitalHead}>
      <h2 id="order-digital-heading">Acceso digital</h2>
      <p className={classes.quiet}>{items.length === 1 ? "Este título no se envía: queda en tu cuenta." : "Estos títulos no se envían: quedan en tu cuenta."}</p>
    </div>
    <div className={classes.books}>
      <ul aria-labelledby="order-digital-heading">
        {items.map((item, index) => {
          const access = item.digitalAccess;
          const copy = access ? digitalAccessCopy[access.state] : null;
          return <BookLine key={item.orderItemId} order={order} item={item} cover={coverOf(item)} eager={index === 0}>
            {copy && <p className={classes.access} data-state={access!.state}><MaterialSymbol name={copy.icon} size={18} aria-hidden="true" /><span>{copy.text}</span></p>}
            <LibraryAccessLink order={order} item={item} />
          </BookLine>;
        })}
      </ul>
    </div>
  </section>;
}

function PaymentPanel({ order }: { order: OrderDetail }) {
  const payment = order.payment;
  // Historical totals from the order's snapshot; without one, the amounts read as before and no saving shows.
  const pricing = toOrderPricingViewModel(order);
  const saving = pricing.summary.pricingSnapshotAvailable && pricing.summary.savingsTotal && hasSaving(pricing.summary.savingsTotal.rawValue) ? pricing.summary.savingsTotal : null;
  return <section className={classes.panel} aria-labelledby="order-payment-heading">
    <h2 id="order-payment-heading">Pago</h2>
    {payment ? <p className={classes.paymentLine}>
      <MaterialSymbol name="credit_card" aria-hidden="true" size={20} />
      <span><strong>{paymentMethodLabel(payment.method)}</strong><span className={classes.paymentState} data-state={payment.state}>{paymentStateLabel(payment.state)}</span></span>
    </p> : <p className={classes.quiet}>Los datos del pago no están disponibles.</p>}
    <dl className={classes.totals}>
      {saving && pricing.summary.originalSubtotal ? <>
        <div><dt>Subtotal</dt><dd>{pricing.summary.originalSubtotal.formattedValue}</dd></div>
        <div data-tone="savings"><dt>Ahorro total</dt><dd>-{saving.formattedValue}</dd></div>
      </> : order.subtotal && <div><dt>Subtotal</dt><dd>{formatUsd(order.subtotal)}</dd></div>}
      {order.taxAmount && <div><dt>{ivaLabel(order.taxRate)}</dt><dd>{formatUsd(order.taxAmount)}</dd></div>}
      {order.shippingAmount && <div><dt>Gastos de envío</dt><dd>{formatUsd(order.shippingAmount)}</dd></div>}
      <div className={classes.grandTotal}><dt>{saving ? "Total pagado" : "Total"}</dt><dd>{formatUsd(order.total)}</dd></div>
      {payment?.state === "REFUNDED" && <div className={classes.refund}><dt>Reembolsado</dt><dd>{formatUsd(payment.amount)}</dd></div>}
    </dl>
    {order.creditNotes.map((note) => <p key={note.creditNoteId} className={classes.creditNote}>Nota de crédito N.° {note.documentNumber} · {formatUsd(note.total)}</p>)}
    <InvoiceAction orderId={order.orderId} issued={Boolean(order.invoice)} className={classes.invoice} />
  </section>;
}
