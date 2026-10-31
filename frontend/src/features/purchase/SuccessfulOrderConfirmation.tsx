import type { Ref } from "react";
import { useQueries } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { ButtonLink } from "@/components/ui/button";
import { BookCover } from "@/features/catalog/BookCover";
import { formatUsd } from "@/features/catalog/formatters";
import { getPublicEdition } from "@/shared/api/catalog";
import type { OrderDetail } from "@/shared/api/orders";
import { LibraryAccessLink } from "./LibraryAccessLink";
import { MaterialSymbol } from "@/shared/ui/MaterialSymbol";
import { fulfillmentMethodLabel } from "./fulfillment";
import { LocationMap } from "./LocationMap";
import { openingHoursLabel } from "./PickupLocationPicker";
import { PurchaseFlow } from "./PurchaseFlow";
import { deliveryWindowLabel, ivaLabel, paymentMethodLabel } from "./purchaseText";
import { purchaseWindowView } from "./orderStory";
import { hasSaving } from "./cartPricingViewModel";
import { InvoiceAction } from "./InvoiceAction";
import { toOrderPricingViewModel, type OrderLinePricingViewModel } from "./orderPricingViewModel";
import classes from "./confirmation.module.css";

// PUCE reference from V040 and the academic demo brief. Never a customer's delivery coordinate.
const academicMapReference = { latitude: -.21, longitude: -78.4914 };

/** Snapshot-owned destination, readiness, payment and prices; catalog reads supply only cover assets. */
export function SuccessfulOrderConfirmation({ order, headingRef }: { order: OrderDetail; headingRef: Ref<HTMLHeadingElement> }) {
  // The response reports no fulfillment for a digital-only purchase.
  const hasPhysicalFulfillment = order.fulfillment != null;
  const digitalItems = order.items.filter(item => !item.requiresPhysicalFulfillment);
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
  // The order's immutable pricing snapshot, worded for display: nothing is recalculated. Without a snapshot
  // (older orders), the historical amounts read as before and no saving is shown.
  const pricing = toOrderPricingViewModel(order);
  const summarySaving = pricing.summary.pricingSnapshotAvailable && pricing.summary.savingsTotal && hasSaving(pricing.summary.savingsTotal.rawValue) ? pricing.summary.savingsTotal : null;
  const lineSaving = (orderItemId: string) => {
    const line = pricing.lines.find((candidate) => candidate.orderItemId === orderItemId);
    return line?.pricingSnapshotAvailable && line.lineSavings && hasSaving(line.lineSavings.rawValue) ? line as OrderLinePricingViewModel & { lineSavings: NonNullable<OrderLinePricingViewModel["lineSavings"]> } : null;
  };
  const fulfillmentHeading = pickup ? "Retiro" : "Entrega";
  // The six-minute window (ADR 0029) is stated only while the server still offers cancellation.
  const canCancel = Boolean(order.availableActions?.canCancel ?? order.availableActions?.cancel);
  const windowView = purchaseWindowView(order.availableActions?.lifecycleState, { digitalOnly: !hasPhysicalFulfillment, pickup: Boolean(pickup) });
  const inWindow = windowView === "digital-window" || windowView === "pickup-window";
  const cover = (item: OrderDetail["items"][number]) => coverQueries[order.items.indexOf(item)]?.data;
  const bookCover = (item: OrderDetail["items"][number]) => <div className={classes.bookCover}>
    <BookCover url={cover(item)?.coverUrl ?? null} license={cover(item)?.coverLicense ?? null} attribution={cover(item)?.coverAttribution ?? null} title={item.title} size="compact" decorative />
  </div>;

  return <PurchaseFlow stage="confirmation">
    <div className={classes.confirmation} data-confirmation="success">
      {/* 1. The outcome: it went through, under this number. */}
      <header className={classes.intro}>
        <span className={classes.done} aria-hidden="true"><MaterialSymbol name="check_circle" size={32} /></span>
        <h1 id="confirmation-heading" tabIndex={-1} ref={headingRef}>Es momento de celebrar</h1>
        <p className={classes.thanks}>Gracias por tu pedido N.º {order.orderId}</p>
        {inWindow && canCancel && <p>Puedes cancelarlo durante los primeros 6 minutos desde el detalle del pedido.</p>}
      </header>

      <div className={classes.layout}>
        {/* 2. What happens next, by what was bought: where the printed books go, where the digital ones already are. */}
        <div className={classes.next}>
          {hasPhysicalFulfillment && <section className={classes.destination} aria-label="Destino confirmado">
            <LocationMap latitude={mapCoordinates.latitude} longitude={mapCoordinates.longitude}
              label={location?.name ?? "referencia de PUCE"} callout={callout}
              linkLabel={location ? undefined : "Ver mapa de referencia"} />
            {!location && <p className={classes.mapReference}>Referencia PUCE en la entrada principal.</p>}
          </section>}

          {hasPhysicalFulfillment && <section className={classes.card} aria-labelledby="confirmation-fulfillment-heading" data-confirmation="fulfillment">
            <header className={classes.cardHead}>
              <h2 id="confirmation-fulfillment-heading">{fulfillmentHeading}</h2>
              {method && <p>{method}</p>}
            </header>
            {(pickup || deliveryWindow) && <dl className={classes.facts}>
              {pickup ? <>
                <div className={classes.code}><dt>Código de retiro</dt><dd>{pickup.pickupCode}</dd></div>
                <div><dt>Retiro estimado</dt><dd><time dateTime={pickup.readyAt}>{readyLabel}</time></dd></div>
                {location && <div><dt>Horario de atención</dt><dd>{openingHoursLabel(location)}</dd></div>}
              </> : <div><dt>Entrega estimada</dt><dd>{deliveryWindow}</dd></div>}
            </dl>}
            {pickup && order.fulfillment?.state !== "COLLECTED" && <p className={classes.note}>Presenta la confirmación enviada a tu correo al retirar el pedido.</p>}
            <ul className={classes.lines} aria-label={pickup ? "Libros para retirar" : "Libros para entregar"}>{order.items.filter(item => item.requiresPhysicalFulfillment).map((item) => {
              const saving = lineSaving(item.orderItemId);
              return <li key={item.orderItemId}>
                {bookCover(item)}
                <div className={classes.lineCopy}>
                  <strong className={classes.bookTitle}>{item.title}</strong>
                  <span className={classes.lineMeta}>
                    <span className={classes.unitPrice}>{formatUsd(item.unitPrice)}<span className="visually-hidden"> por unidad</span>
                      {saving?.originalPrice && <s className={classes.was}><span className="visually-hidden">Precio anterior: </span>{saving.originalPrice.formattedValue}</s>}</span>
                    <span>Cantidad: {item.quantity}</span>
                  </span>
                  {saving && <span className={classes.saving}><MaterialSymbol name="sell" size={16} aria-hidden="true" />Ahorraste {saving.lineSavings.formattedValue}</span>}
                </div>
              </li>;
            })}</ul>
          </section>}

          {digitalItems.length > 0 && <section className={classes.card} aria-labelledby="confirmation-digital-heading">
            <header className={classes.cardHead}>
              <h2 id="confirmation-digital-heading">Compras digitales</h2>
              {hasPhysicalFulfillment && <p>No se envían con los libros impresos: quedan en tu cuenta.</p>}
            </header>
            <ul className={classes.lines}>{digitalItems.map(item => {
              const saving = lineSaving(item.orderItemId);
              // Each title's own access from the server (V077): digital titles are not shipped, they join Mi biblioteca.
              const access = item.digitalAccess?.state;
              return <li key={item.orderItemId}>
                {bookCover(item)}
                <div className={classes.lineCopy}>
                  <strong className={classes.bookTitle}>{item.title}</strong>
                  {access && <span className={classes.access} data-state={access}><MaterialSymbol name={access === "AVAILABLE" ? "check_circle" : access === "PENDING_PAYMENT" ? "schedule" : "block"} size={18} aria-hidden="true" />{access === "AVAILABLE" ? "Ya está en Mi biblioteca" : access === "PENDING_PAYMENT" ? "Se añadirá a Mi biblioteca cuando se apruebe el pago" : "Sin acceso en Mi biblioteca"}</span>}
                  {saving && <span className={classes.saving}><MaterialSymbol name="sell" size={16} aria-hidden="true" />Ahorraste {saving.lineSavings.formattedValue}</span>}
                  {/* Opens the owned title itself, only once it is really in Mi biblioteca (paid, not revoked). */}
                  <LibraryAccessLink order={order} item={item} />
                </div>
              </li>;
            })}</ul>
          </section>}
        </div>

        {/* 3. The receipt, once: number, payment, totals, the full order and its invoice. */}
        <aside className={classes.receipt} aria-labelledby="confirmation-order-heading" data-confirmation="details">
          <header className={classes.receiptHead}>
            <h2 id="confirmation-order-heading">Tu pedido</h2>
            <p>N.º {order.orderId}</p>
          </header>
          {order.payment && <p className={classes.paymentMethod}><MaterialSymbol name={order.payment.method === "TRANSFER" ? "account_balance" : "credit_card"} size={20} aria-hidden="true" /><span><span className="visually-hidden">Método de pago: </span>{paymentMethodLabel(order.payment.method)}</span></p>}
          <dl className={classes.totals}>
            {summarySaving && pricing.summary.originalSubtotal ? <>
              <div><dt>Subtotal</dt><dd>{pricing.summary.originalSubtotal.formattedValue}</dd></div>
              <div data-tone="savings"><dt>Ahorro total</dt><dd>-{summarySaving.formattedValue}</dd></div>
            </> : order.subtotal != null && <div><dt>Subtotal</dt><dd>{formatUsd(order.subtotal)}</dd></div>}
            {order.taxAmount != null && <div><dt>{ivaLabel(order.taxRate)}</dt><dd>{formatUsd(order.taxAmount)}</dd></div>}
            {order.shippingAmount != null && <div><dt>Gastos de envío</dt><dd>{formatUsd(order.shippingAmount)}</dd></div>}
            <div className={classes.total} data-purchase="total"><dt>{summarySaving ? "Total pagado" : "Total"}</dt><dd>{formatUsd(order.total)}</dd></div>
          </dl>
          <div className={classes.receiptActions}>
            <ButtonLink variant="primary" to={`/orders/${order.orderId}`} replace state={null}>Ver pedido completo</ButtonLink>
            <InvoiceAction orderId={order.orderId} issued={Boolean(order.invoice)} />
          </div>
        </aside>
      </div>
      <Link className={classes.continue} to="/catalog">Seguir explorando el catálogo</Link>
    </div>
  </PurchaseFlow>;
}
