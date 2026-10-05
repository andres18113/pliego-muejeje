import type { CheckoutFulfillmentMethod } from "./fulfillment";
import classes from "./pickup.module.css";

const methods = [{ value: "HOME_DELIVERY", label: "Entrega" }, { value: "STORE_PICKUP", label: "Retiro" }] as const;
export function FulfillmentTabs({ value, onChange, disabled, pickupAvailable = true }: { value: CheckoutFulfillmentMethod; onChange: (value: CheckoutFulfillmentMethod) => void; disabled: boolean; pickupAvailable?: boolean }) {
  const availableMethods = methods.filter(method => method.value !== "STORE_PICKUP" || pickupAvailable);
  return <div role="tablist" aria-label="Cómo recibir tu pedido" className={classes.tabs}>
    {methods.map((method) => <button key={method.value} type="button" role="tab"
      id={`fulfillment-tab-${method.value}`} aria-selected={value === method.value}
      aria-controls="checkout-destination" tabIndex={value === method.value ? 0 : -1} disabled={disabled || (method.value === "STORE_PICKUP" && !pickupAvailable)}
      onClick={() => onChange(method.value)}
      onKeyDown={event => {
        let next: number;
        const index = availableMethods.findIndex(candidate => candidate.value === method.value);
        if (event.key === "ArrowRight") next = (index + 1) % availableMethods.length;
        else if (event.key === "ArrowLeft") next = (index + availableMethods.length - 1) % availableMethods.length;
        else if (event.key === "Home") next = 0;
        else if (event.key === "End") next = availableMethods.length - 1;
        else return;
        event.preventDefault(); onChange(availableMethods[next].value);
        document.getElementById(`fulfillment-tab-${availableMethods[next].value}`)?.focus();
      }}
    >{method.label}</button>)}
  </div>;
}
