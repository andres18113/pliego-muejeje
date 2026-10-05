import { useEffect, useRef, useState, type ReactNode } from "react";
import type { UseQueryResult } from "@tanstack/react-query";
import type { PickupLocation } from "@/shared/api/pickup";
import { FieldMessage } from "@/shared/ui/Field";
import { ReadFailure } from "./CartPage";
import classes from "./purchaseFlow.module.css";
import pickup from "./pickup.module.css";

export function openingHoursLabel(location: PickupLocation) {
  return `${location.openingHours.opensAt.slice(0, 5)}–${location.openingHours.closesAt.slice(0, 5)}`;
}
export function PickupLocationPicker({ query, value, onChange, disabled, error, children }: {
  query: UseQueryResult<PickupLocation[], Error>; value: string; onChange: (id: string) => void;
  disabled: boolean; error?: string; children?: ReactNode;
}) {
  const [choosing, setChoosing] = useState(false);
  const retryFocus = useRef(false);
  useEffect(() => {
    if (!retryFocus.current || query.isFetching || query.isError) return;
    retryFocus.current = false;
    (document.querySelector<HTMLElement>('input[name="pickupLocationId"]') ?? document.getElementById("checkout-destination"))?.focus();
  }, [query.isFetching, query.isError]);
  const selected = query.data?.find(location => location.id === value);
  return <>
    <div className={classes.panelHead}>
      <h2 id="checkout-pickup-heading">Retirar en</h2>
      {selected && <button type="button" id="checkout-change-pickup" className={classes.linkAction} disabled={disabled}
        aria-expanded={choosing} onClick={() => setChoosing(!choosing)}>{choosing ? "Cerrar" : "Cambiar punto"}</button>}
    </div>
    {query.isPending ? <p className={classes.status} role="status">Consultando puntos de retiro…</p>
      : query.isError ? <ReadFailure title="No pudimos consultar los puntos de retiro." onRetry={() => { retryFocus.current = true; void query.refetch(); }} retrying={query.isFetching} />
      : query.data?.length === 0 ? <p className={classes.hint} role="status">No hay puntos de retiro disponibles. Puedes elegir Entrega o volver a consultar más tarde.</p>
      : <>
        {(!selected || choosing) && <fieldset className={classes.choices} disabled={disabled || query.isFetching} aria-describedby={error ? "pickup-location-error" : undefined} aria-invalid={Boolean(error) || undefined}>
          <legend className="visually-hidden">Elige un punto de retiro</legend>
          {query.data?.map(location => <label key={location.id} className={classes.choice}>
            <input type="radio" name="pickupLocationId" value={location.id} checked={value === location.id} onChange={() => {
              onChange(location.id); setChoosing(false);
              requestAnimationFrame(() => document.getElementById("checkout-change-pickup")?.focus());
            }} />
            <span className={classes.choiceCopy}><strong>{location.name}</strong><span>{location.address}</span>
              <span>{location.city}, {location.province}</span><span>Horario: {openingHoursLabel(location)}</span>
              <span>Preparación estimada: {location.preparationMinutes} minutos.</span>
            </span>
          </label>)}
        </fieldset>}
        {selected && !choosing && <>
          <address className={classes.deliverTo}><strong>{selected.name}</strong><span>{selected.address}</span><span>{selected.city}, {selected.province}</span>
            <span>Horario: {openingHoursLabel(selected)}</span></address>
          <div className={pickup.instructions}>
            <p>Presenta el correo de confirmación al retirar.</p>
            <p className={pickup.estimate}><strong>Preparación estimada: ~{selected.preparationMinutes} min.</strong></p>
          </div>
          {children}
        </>}
      </>}
    {error && <FieldMessage id="pickup-location-error" tone="error">{error}</FieldMessage>}
  </>;
}
