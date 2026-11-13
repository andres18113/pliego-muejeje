import { expect, it } from "vitest";
import { digitalConflictDestination, digitalEditionState } from "./digitalPurchaseState";
const eligible = { editionId: "42", owned: false, ownedItemId: null, pendingOrder: false, pendingOrderId: null, inCart: false, purchasable: true };
it("uses safe collection destinations when eligibility has no IDs or failed", () => {
  expect(digitalConflictDestination("P6002").href).toBe("/biblioteca");
  expect(digitalConflictDestination("P6003").href).toBe("/orders");
  expect(digitalEditionState({ ...eligible, owned: true })?.href).toBe("/biblioteca");
  expect(digitalEditionState({ ...eligible, pendingOrder: true })?.href).toBe("/orders");
});
it("keeps server state precedence owned, pending, in cart", () => {
  expect(digitalEditionState({ ...eligible, owned: true, pendingOrder: true, inCart: true })?.label).toBe("Ver en Mi biblioteca");
  expect(digitalEditionState({ ...eligible, pendingOrder: true, inCart: true })?.label).toBe("Ver pedido");
  expect(digitalEditionState({ ...eligible, inCart: true })?.href).toBe("/cart");
  expect(digitalEditionState(eligible)).toBeNull();
  expect(digitalEditionState()).toBeNull();
});
