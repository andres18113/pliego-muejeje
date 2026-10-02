export type CatalogIntent = { kind: "favorite" | "cart"; editionId: string };

export function deferredAuthState(returnState: unknown, intent: CatalogIntent) {
  return { pliegoAction: intent, pliegoReturnState: returnState ?? null };
}

export function readCatalogIntent(state: unknown): CatalogIntent | null {
  if (!isRecord(state)) return null;
  const value = state.pliegoAction;
  if (!isRecord(value) || (value.kind !== "favorite" && value.kind !== "cart")
      || typeof value.editionId !== "string" || !/^[1-9][0-9]*$/.test(value.editionId)) return null;
  return { kind: value.kind, editionId: value.editionId };
}

export function stateAfterSignIn(state: unknown): unknown {
  if (!isRecord(state)) return undefined;
  if ("pliegoAuthState" in state) return stateAfterSignIn(state.pliegoAuthState);

  const intent = readCatalogIntent(state);
  if (!intent) return undefined;
  const returnState = isRecord(state.pliegoReturnState) ? state.pliegoReturnState : {};
  return { ...returnState, pliegoAction: intent };
}

export function stateAfterRegistration(returnState: unknown, registeredEmail: string) {
  return { registeredEmail, pliegoAuthState: returnState ?? null };
}

export function stripCatalogIntent(state: unknown) {
  if (!isRecord(state)) return null;
  const { pliegoAction: _intent, ...remaining } = state;
  return Object.keys(remaining).length ? remaining : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
