import { MaterialSymbol } from "@/shared/ui/MaterialSymbol";
import type { OrderShipment } from "@/shared/api/orders";
import { orderMomentLabel } from "./purchaseText";
import { shipmentSteps } from "./orderStory";
import classes from "./orderPage.module.css";

/** The lifecycle the API documents, marked from the server's shipment state and its recorded times. */
export function ShipmentTrack({ shipment }: { shipment: OrderShipment }) {
  const state = shipment.state === "SHIPPED" ? "IN_TRANSIT" : shipment.state;
  const current = shipmentSteps.findIndex((step) => step.state === state);
  if (current < 0) return null;
  return <ol className={classes.track} aria-label="Progreso del envío">
    {shipmentSteps.map((step, index) => {
      const at = shipment[step.at];
      const state = index < current ? "done" : index === current ? "current" : "next";
      return <li key={step.state} data-state={state} aria-current={state === "current" ? "step" : undefined}>
        <span className={classes.trackMark} aria-hidden="true">{state !== "next" && <MaterialSymbol name="check" size={14} />}</span>
        <span className={classes.trackLabel}>{step.label}</span>
        {at && state !== "next" && <time className={classes.trackTime} dateTime={at}>{orderMomentLabel(at)}</time>}
        {state === "next" && <span className="visually-hidden">pendiente</span>}
      </li>;
    })}
  </ol>;
}
