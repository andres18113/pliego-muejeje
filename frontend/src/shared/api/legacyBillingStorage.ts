/** Migration cleanup only: fiscal snapshots belong to the server, never browser storage. */
export function clearLegacyBillingIntents() {
  try {
    const obsolete: string[] = [];
    for (let index = 0; index < localStorage.length; index++) {
      const key = localStorage.key(index);
      if (key?.startsWith("pliego:checkout-billing:")) obsolete.push(key);
    }
    for (const key of obsolete) localStorage.removeItem(key);
  } catch {
    // Cleanup must not trigger a purchase, erase its recovery key or prevent reconciliation.
  }
}
