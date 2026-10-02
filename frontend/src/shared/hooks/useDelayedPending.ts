import { useEffect, useState } from "react";

/** Show transient loading feedback only when work outlasts a short, imperceptible delay. */
export function useDelayedPending(pending: boolean, delayMs = 150) {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (!pending) {
      setVisible(false);
      return;
    }

    const timeout = window.setTimeout(() => setVisible(true), delayMs);
    return () => window.clearTimeout(timeout);
  }, [delayMs, pending]);

  return pending && visible;
}
