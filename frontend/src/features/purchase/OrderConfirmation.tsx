import type { ReactNode, Ref } from "react";
import { Link } from "react-router-dom";
import { ButtonLink } from "@/components/ui/button";
import { formatUsd } from "@/features/catalog/formatters";
import type { OrderDetail } from "@/shared/api/orders";
import { useTransferDetails } from "@/shared/api/reference";
import { ReadFailure } from "./CartPage";
import { fulfillmentMethodLabel } from "./fulfillment";
import { orderStory, type OrderStory } from "./orderStory";
import { PurchaseFlow, PurchaseLayout, PurchaseSummary } from "./PurchaseFlow";
import { deliveryWindowLabel, ivaLabel, paymentMethodLabel, paymentStateLabel, unitsLabel } from "./purchaseText";
import { PickupDetails } from "./PickupDetails";
import { ShipmentTrack } from "./ShipmentTrack";
import { TransferFacts } from "./TransferFacts";
import scene from "./orderDetail.module.css";
import classes from "./purchaseFlow.module.css";
import { SuccessfulOrderConfirmation } from "./SuccessfulOrderConfirmation";

/**
 * The flow's last stage, shown when checkout hands over its order. Successful purchases get a quiet receipt;
 * pending or closed purchases retain their server-reported story and recovery actions.
 */
export function OrderConfirmation({ order, headingRef }: { order: OrderDetail; headingRef: Ref<HTMLHeadingElement> }) {
  const story = orderStory({ orderState: order.orderState, purchaseState: order.purchaseState, paymentState: order.payment?.state, shipmentState: order.shipment?.state ?? null });
  if (story.kind !== "cancelled" && story.kind !== "payment-rejected" && story.kind !== "awaiting-payment") {
    return <SuccessfulOrderConfirmation order={order} headingRef={headingRef} />;
  }
  return <OtherOrderConfirmation order={order} headingRef={headingRef} />;
}

/** Pending and closed purchases retain their server-reported story and recovery actions. */
function OtherOrderConfirmation({ order, headingRef }: { order: OrderDetail; headingRef: Ref<HTMLHeadingElement> }) {
  const story = orderStory({ orderState: order.orderState, purchaseState: order.purchaseState, paymentState: order.payment?.state, shipmentState: order.shipment?.state ?? null });
  const closed = story.kind === "cancelled" || story.kind === "payment-rejected";
  const awaitingTransfer = story.kind === "awaiting-payment" && order.payment?.method === "TRANSFER";
  const transferDetails = useTransferDetails(awaitingTransfer);
  const units = order.items.reduce((total, item) => total + item.quantity, 0);
  const method = fulfillmentMethodLabel(order.fulfillment?.method);
  const pickup = order.fulfillment?.method === "STORE_PICKUP" ? order.fulfillment.pickup : null;
  const window = order.shipment ? deliveryWindowLabel(order.shipment.estimatedDeliveryFrom, order.shipment.estimatedDeliveryTo) : null;

  return (
    <PurchaseFlow stage="confirmation">
      <PurchaseLayout summary={
        <PurchaseSummary
          headingId="confirmation-summary-heading"
          title={`Pedido N.° ${order.orderId}`}
          lines={order.items.map((item) => ({
            key: item.orderItemId,
            title: item.title,
            meta: `${unitsLabel(item.quantity)} × ${formatUsd(item.unitPrice)}`,
            amount: formatUsd(item.subtotal),
          }))}
          totals={[
            { label: "Unidades", value: units },
            ...(order.payment ? [{ label: "Pago", value: `${paymentMethodLabel(order.payment.method)} · ${paymentStateLabel(order.payment.state)}` }] : []),
            ...(order.payment?.reference ? [{ label: "Referencia", value: order.payment.reference }] : []),
            ...(order.subtotal ? [{ label: "Subtotal", value: formatUsd(order.subtotal) }] : []),
            ...(order.taxAmount ? [{ label: ivaLabel(order.taxRate), value: formatUsd(order.taxAmount) }] : []),
            ...(order.shippingAmount ? [{ label: "Gastos de envío", value: formatUsd(order.shippingAmount) }] : []),
            { label: "Total", value: formatUsd(order.total), total: true },
          ]}
        >
          <ButtonLink variant="primary" to={`/orders/${order.orderId}`} replace state={null}>Ver el pedido completo</ButtonLink>
          <p className={classes.fine}>Compra simulada: no se hizo ningún cobro real.</p>
          <Link className={classes.quietLink} to="/catalog">Seguir explorando el catálogo</Link>
        </PurchaseSummary>
      }>
        <section className={`${scene.scene} ${classes.scene}`} data-tone={story.tone} data-story={story.kind} aria-labelledby="confirmation-heading">
          <div className={scene.storyCopy}>
            <p className={classes.sceneOrder}>Pedido N.° {order.orderId}</p>
            <h1 id="confirmation-heading" className={scene.headline} ref={headingRef} tabIndex={-1}>{confirmationHeadline(story)}</h1>
            <p className={scene.lead}>{confirmationLead(order, story, window)}</p>
          </div>
          {!pickup && order.shipment && !closed && <ShipmentTrack shipment={order.shipment} />}
          {awaitingTransfer && <div className={scene.inset}>{transferDetails.data
            ? <TransferFacts details={transferDetails.data} amount={order.total} reference={order.payment?.reference} />
            : transferDetails.isPending
              ? <p role="status">Consultando datos bancarios…</p>
              : <ReadFailure title="No pudimos consultar los datos bancarios." onRetry={() => void transferDetails.refetch()} retrying={transferDetails.isFetching} />}</div>}
          {story.kind === "payment-rejected" && <div className={scene.actionRow}><ButtonLink variant="primary" to="/cart">Revisar el carrito</ButtonLink></div>}
        </section>

        {!closed && (order.address || method) && (
          <section className={classes.section} aria-labelledby="confirmation-delivery-heading">
            <div className={classes.sectionHead}>
              <h2 id="confirmation-delivery-heading">{method ?? "Entrega"}</h2>
            </div>
            <div className={classes.delivery}>
              {pickup && <PickupDetails pickup={pickup} state={order.fulfillment?.state} collectedAt={order.fulfillment?.collectedAt} />}
              {order.address && <address>
                <strong>{order.address.recipient}</strong>
                <span>{order.address.line1}{order.address.line2 ? `, ${order.address.line2}` : ""}</span>
                <span>{[order.address.city, order.address.province].filter(Boolean).join(", ")}</span>
                <span>{order.address.phone}</span>
              </address>}
              {window && <dl><div><dt>Llegada estimada</dt><dd>{window.replace(/^./, (first) => first.toLocaleUpperCase("es-EC"))}</dd></div></dl>}
            </div>
          </section>
        )}
      </PurchaseLayout>
    </PurchaseFlow>
  );
}

function confirmationHeadline(story: OrderStory) {
  switch (story.kind) {
    case "payment-rejected": return "El pago no se completó";
    case "cancelled": return "Pedido cancelado";
    case "awaiting-payment": return "Tu pedido espera el pago";
    default: return "Gracias, tu pedido está confirmado";
  }
}

function confirmationLead(order: OrderDetail, story: OrderStory, window: string | null): ReactNode {
  switch (story.kind) {
    case "payment-rejected": return "El pago no fue aprobado y no se cobró este pedido. Los libros siguen en tu carrito.";
    case "cancelled": return "Este pedido se canceló y no continuará.";
    case "awaiting-payment": return order.payment?.method === "TRANSFER"
      ? "Registramos tu pedido. Se confirmará cuando se apruebe la transferencia."
      : "Registramos tu pedido. Esperamos la confirmación del pago.";
    default:
      if (order.fulfillment?.method === "STORE_PICKUP") return order.fulfillment.state === "COLLECTED"
        ? "El pago fue aprobado y tu pedido ya fue retirado."
        : "El pago fue aprobado. Preparamos tus libros para el retiro en el punto elegido.";
      if (!order.shipment) return "El pago fue aprobado.";
      return <>El pago fue aprobado. {order.shipment.state === "PENDING" ? "Ahora preparamos tus libros para el envío." : "Sigue aquí el avance del envío."}{window && <> Llega {window}.</>}</>;
  }
}
