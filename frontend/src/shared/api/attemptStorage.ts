/** Recovery metadata contains only an actor-scoped UUID, never addresses or payment data. */
export type AttemptKind = "checkout" | "address";
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const storageKey = (kind: AttemptKind, actor: string) => `pliego:pending:${kind}:${actor}`;

export class AttemptStorageError extends Error {
  constructor() { super("No pudimos guardar la información para consultar el resultado. Habilita el almacenamiento del navegador antes de continuar."); }
}

class PendingAttemptError extends Error {
  constructor() { super("Hay un intento pendiente. Consulta su resultado antes de continuar."); }
}

export function readPendingAttempt(kind: AttemptKind, actor: string): string | null {
  try {
    const prefix = `${storageKey(kind, actor)}:`;
    // Each key has its own receipt. A shared pointer may be changed by another tab,
    // but must never erase recovery information for the original command.
    for (let index = 0; index < localStorage.length; index++) {
      const entry = localStorage.key(index);
      if (!entry?.startsWith(prefix)) continue;
      const key = localStorage.getItem(entry);
      if (!key || !uuid.test(key) || entry !== prefix + key) throw new AttemptStorageError();
      return key;
    }
    const key = localStorage.getItem(storageKey(kind, actor));
    if (key !== null && !uuid.test(key)) throw new AttemptStorageError();
    return key;
  } catch { throw new AttemptStorageError(); }
}

export async function beginPendingAttempt(kind: AttemptKind, actor: string): Promise<string> {
  try {
    // Web Locks serializes tab claims. Fail closed if this browser/context cannot
    // coordinate them; a localStorage read/write sequence is not an atomic claim.
    if (!navigator.locks) throw new AttemptStorageError();
    return await navigator.locks.request(`pliego:claim:${kind}:${actor}`, () => {
      if (readPendingAttempt(kind, actor)) throw new PendingAttemptError();
      const key = crypto.randomUUID();
      localStorage.setItem(`${storageKey(kind, actor)}:${key}`, key);
      localStorage.setItem(storageKey(kind, actor), key);
      if (readPendingAttempt(kind, actor) !== key) throw new AttemptStorageError();
      return key;
    });
  } catch (error) {
    if (error instanceof PendingAttemptError) throw error;
    throw new AttemptStorageError();
  }
}

export function clearPendingAttempt(kind: AttemptKind, actor: string, key: string) {
  try {
    localStorage.removeItem(`${storageKey(kind, actor)}:${key}`);
    if (localStorage.getItem(storageKey(kind, actor)) === key) localStorage.removeItem(storageKey(kind, actor));
  } catch { throw new AttemptStorageError(); }
}
