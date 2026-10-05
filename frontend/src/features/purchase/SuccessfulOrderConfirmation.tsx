import type { Ref } from "react";
import { useQueries } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { ButtonLink } from "@/components/ui/button";
import { BookCover } from "@/features/catalog/BookCover";
import { formatUsd } from "@/features/catalog/formatters";
import { getPublicEdition } from "@/shared/api/catalog";
import type { OrderDetail } from "@/shared/api/orders";
import { MaterialSymbol } from "@/shared/ui/MaterialSymbol";
import { fulfillmentMethodLabel } from "./fulfillment";
import { LocationMap } from "./LocationMap";
import { openingHoursLabel } from "./PickupLocationPicker";
import { PurchaseFlow } from "./PurchaseFlow";
import { deliveryWindowLabel, ivaLabel, paymentMethodLabel } from "./purchaseText";
import classes from "./confirmation.module.css";

// PUCE reference from V040 and the academic demo brief. Never a customer's delivery coordinate.
const academicMapReference = { latitude: -.21, longitude: -78.4914 };

/** Snapshot-owned destination, readiness, payment and prices; catalog reads supply only cover assets. */
export function SuccessfulOrderConfirmation({ order, headingRef }: { order: OrderDetail; headingRef: Ref<HTMLHeadingElement> }) {
  // The response reports no fulfillment for a digital-only purchase.
  const hasPhysicalFulfillment = order.fulfillment != null;
  const digitalItems = order.items.filter(item => item.format === "EBOOK" || item.format === "AUDIOBOOK");
  const pickup = order.fulfillment?.method === "STORE_PICKUP" ? order.fulfillment.pickup : null;
  const method = fulfillmentMethodLabel(order.fulfillment?.method);
  const deliveryWindow = order.shipment ? deliveryWindowLabel(order.shipment.estimatedDeliveryFrom, order.shipment.estimatedDeliveryTo) : null;
  const location = pickup?.location;
  const recipient = location?.name ?? order.address?.recipient;
  const street = location?.address ?? (order.address ? [order.address.line1, order.address.line2].filter(Boolean).join(", ") : null);
  const city = location ? [location.city, location.province].filter(Boolean).join(", ")
    : order.address ? [order.address.city, order.address.province].filter(Boolean).join(", ") : null;
  const postalCode = location?.postalCode ?? order.address?.postalCode;
  const mapCoordinates = location ?? academicMapReference;
  const readyLabel = pickup ? new Intl.DateTimeFormat("es-EC", {
    timeZone: pickup.location.timezone, day: "numeric", month: "long", year: "numeric",
    hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23",
  }).format(new Date(pickup.readyAt)) : null;
  const coverQueries = useQueries({ queries: order.items.map(item => ({
    queryKey: ["order-item-cover", item.editionId],
    queryFn: ({ signal }: { signal: AbortSignal }) => getPublicEdition(item.editionId!, signal),
    enabled: Boolean(item.editionId), staleTime: 60 * 60 * 1000, retry: false,
  })) });
  const callout = <div className={classes.calloutCopy}>
    <h2>Enviar a</h2>
    {recipient ? <address><strong>{recipient}</strong><span>{street}</span><span>{city}{postalCode ? ` ${postalCode}` : ""}</span></address>
      : <p>Destino no registrado.</p>}
  </div>;
  const fulfillmentHeading = pickup ? "Retiro" : order.fulfillment?.method === "HOME_DELIVERY" ? "Entrega" : "Artículos comprados";

  return <PurchaseFlow stage="confirmation">
    <div className={classes.confirmation} data-confirmation="success">
      <header className={classes.intro}>
        <h1 id="confirmation-heading" tabIndex={-1} ref={headingRef}>Es momento de celebrar</h1>
        <p className={classes.thanks}>Gracias por tu pedido N.º {order.orderId}</p>
        <p>Si necesitas hacer cambios, revisa tu pedido lo antes posible.</p>
      </header>

      <div className={classes.layout}>
        {hasPhysicalFulfillment && <section className={classes.destination} aria-label="Destino confirmado">
          <LocationMap latitude={mapCoordinates.latitude} longitude={mapCoordinates.longitude}
            label={location?.name ?? "referencia de PUCE"} callout={callout}
            linkLabel={location ? undefined : "Ver mapa de referencia"} />
          {!location && <p className={classes.mapReference}>Referencia PUCE para esta demo; no ubica la dirección de entrega.</p>}
        </section>}

        <aside className={classes.immediate} aria-labelledby="confirmation-immediate-heading">
          <h2 id="confirmation-immediate-heading">Tu pedido</h2>
          <p className={classes.orderNumber}>Pedido N.º {order.orderId}</p>
          <dl className={classes.quickFacts}>
            {method && <div><dt>{method}</dt><dd>{recipient}</dd></div>}
            {pickup ? <>
              <div><dt>Retiro estimado</dt><dd><time dateTime={pickup.readyAt}>{readyLabel}</time></dd></div>
              <div><dt>Código de retiro</dt><dd className={classes.pickupCode}>{pickup.pickupCode}</dd></div>
            </> : deliveryWindow && <div><dt>Entrega estimada</dt><dd>{deliveryWindow}</dd></div>}
          </dl>
          {pickup && order.fulfillment?.state !== "COLLECTED" && <p className={classes.emailInstruction}>Presenta la confirmación enviada a tu correo al retirar el pedido.</p>}
          <ButtonLink variant="primary" to={`/orders/${order.orderId}`} replace state={null}>Ver pedido completo</ButtonLink>
        </aside>

        <section className={classes.details} aria-labelledby="confirmation-order-heading confirmation-order-number" data-confirmation="details">
          <header className={classes.detailHead}>
            <h2 id="confirmation-order-heading">Tu pedido</h2>
            <p id="confirmation-order-number">N.º {order.orderId}</p>
          </header>
          <div className={classes.detailColumns}>
            <div className={classes.orderFacts}>
              {(recipient || method) && <section><h3>{method ?? "Destino"}</h3><p>{recipient}</p></section>}
              {order.payment && <section>
                <h3>Método de pago</h3>
                <p className={classes.paymentMethod}><MaterialSymbol name={order.payment.method === "TRANSFER" ? "account_balance" : "credit_card"} size={20} />{paymentMethodLabel(order.payment.method)}</p>
              </section>}
            </div>
            <dl className={classes.totals}>
              {order.subtotal != null && <div><dt>Subtotal</dt><dd>{formatUsd(order.subtotal)}</dd></div>}
              {order.taxAmount != null && <div><dt>{ivaLabel(order.taxRate)}</dt><dd>{formatUsd(order.taxAmount)}</dd></div>}
              {order.shippingAmount != null && <div><dt>Gastos de envío</dt><dd>{formatUsd(order.shippingAmount)}</dd></div>}
              <div className={classes.total} data-purchase="total"><dt>Total</dt><dd>{formatUsd(order.total)}</dd></div>
            </dl>
          </div>
          <Link className={classes.orderAction} to={`/orders/${order.orderId}`} replace state={null}>Ver pedido completo</Link>
        </section>

        {hasPhysicalFulfillment && <section className={classes.fulfillment} aria-labelledby="confirmation-fulfillment-heading" data-confirmation="fulfillment">
          <header className={classes.fulfillmentHead}>
            <h2 id="confirmation-fulfillment-heading">{fulfillmentHeading}</h2>
            {location ? <p>Horario de atención: {openingHoursLabel(location)}</p> : deliveryWindow && <p>{deliveryWindow}</p>}
          </header>
          <ul>{order.items.filter(item => item.format !== "EBOOK" && item.format !== "AUDIOBOOK").map((item) => {
            const cover = coverQueries[order.items.indexOf(item)]?.data;
            return <li key={item.orderItemId}>
              <div className={classes.bookCover}><BookCover url={cover?.coverUrl ?? null} license={cover?.coverLicense ?? null} attribution={cover?.coverAttribution ?? null} title={item.title} size="compact" decorative /></div>
              <strong className={classes.bookTitle}>{item.title}</strong>
              <div className={classes.priceQuantity}><span>{formatUsd(item.unitPrice)}<span className="visually-hidden"> por unidad</span></span><span>Cantidad: {item.quantity}</span></div>
            </li>;
          })}</ul>
        </section>}
        {digitalItems.length > 0 && <section aria-labelledby="confirmation-digital-heading"><h2 id="confirmation-digital-heading">Compras digitales</h2><ul>{digitalItems.map(item => <li key={item.orderItemId}>{item.title} · Cantidad: {item.quantity}</li>)}</ul><p>La titularidad se registra en tu cuenta después del pago aprobado.</p><ButtonLink variant="primary" to="/biblioteca">Ver Mi biblioteca</ButtonLink></section>}
      </div>
      <Link className={classes.continue} to="/catalog">Seguir explorando el catálogo</Link>
    </div>
  </PurchaseFlow>;
}
