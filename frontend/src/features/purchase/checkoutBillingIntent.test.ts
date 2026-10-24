import { beforeEach, expect, it } from "vitest";
import { clearLegacyBillingIntents } from "./checkoutBillingIntent";
beforeEach(() => localStorage.clear());
it("removes obsolete fiscal copies for every actor while preserving recovery keys and unrelated data", () => {
  localStorage.setItem("pliego:checkout-billing:2:attempt-one", "obsolete synthetic fiscal snapshot");
  localStorage.setItem("pliego:checkout-billing:3:attempt-two", "obsolete synthetic fiscal snapshot");
  localStorage.setItem("pliego:pending:checkout:2:attempt-one", "attempt-one");
  localStorage.setItem("reader-theme", "dark");
  clearLegacyBillingIntents();
  expect(Object.keys(localStorage).sort()).toEqual(["pliego:pending:checkout:2:attempt-one","reader-theme"]);
  expect(localStorage.getItem("pliego:pending:checkout:2:attempt-one")).toBe("attempt-one");
});
