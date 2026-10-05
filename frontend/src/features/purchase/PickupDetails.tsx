import type { OrderPickup } from "@/shared/api/pickup";
import { openingHoursLabel } from "./PickupLocationPicker";
import { LocationMap } from "./LocationMap";
import classes from "./pickup.module.css";

/** Format the server instant in the immutable location timezone; never derive readiness from the client clock. */
export function PickupDetails({ pickup, state, collectedAt, showTimezone = true }: { pickup: OrderPickup; state?: string | null; collectedAt?: string | null; showTimezone?: boolean }) {
  const { location } = pickup;
  const formatMoment = (instant: string) => new Intl.DateTimeFormat("es-EC", {
    timeZone: location.timezone, day: "numeric", month: "long", year: "numeric",
    hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23",
  }).format(new Date(instant));
  return <div className={classes.details}>
    <address><strong>{location.name}</strong><span>{location.address}</span><span>{location.city}, {location.province}</span></address>
    <dl>
      <div><dt>Retiro estimado</dt><dd><time dateTime={pickup.readyAt}>{formatMoment(pickup.readyAt)}</time></dd></div>
      {showTimezone && <div><dt>Zona horaria del punto</dt><dd>{location.timezone}</dd></div>}
      <div><dt>Código de retiro</dt><dd className={classes.code}>{pickup.pickupCode}</dd></div>
      <div><dt>Horario de atención</dt><dd>{openingHoursLabel(location)}</dd></div>
      {state === "COLLECTED" && collectedAt && <div><dt>Retirado el</dt><dd><time dateTime={collectedAt}>{formatMoment(collectedAt)}</time></dd></div>}
    </dl>
    {state !== "COLLECTED" && state !== "CANCELLED" && <p>Presenta la confirmación enviada a tu correo al retirar el pedido.</p>}
    <LocationMap latitude={location.latitude} longitude={location.longitude} label={location.name} />
  </div>;
}
