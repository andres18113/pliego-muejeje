import { useEffect, useState } from "react";
import { isOfferClockSettled, offerClockSettled } from "./offerRefresh";

/** How long the first render may wait for the offer clock; past it the page opens as it did before the wait existed. */
const OFFER_CLOCK_RENDER_WAIT_MS = 3_000;

export function useOfferClockSettled() {
  const [settled, setSettled] = useState(isOfferClockSettled);
  useEffect(() => {
    if (settled) return;
    let active = true;
    const open = () => { if (active) setSettled(true); };
    void offerClockSettled().then(open);
    const deadline = window.setTimeout(open, OFFER_CLOCK_RENDER_WAIT_MS);
    return () => { active = false; window.clearTimeout(deadline); };
  }, [settled]);
  return settled;
}
