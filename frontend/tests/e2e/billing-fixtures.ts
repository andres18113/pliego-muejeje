import type { Page } from "@playwright/test";
/** Synthetic fiscal data for existing purchase/concurrency scenarios, independent of delivery fixtures. */
export const billingFixturePayload = {billingIdentity:{type:"EC_CEDULA",number:"0123456782"},buyerName:"Compradora Prueba",billingAddress:{line1:"Calle Fiscal de prueba",line2:"",city:"Quito",province:"Pichincha",countryCode:"EC",postalCode:""}};

/**
 * Completes the invoice as a customer would in the redesigned checkout: the details open to set the name, the
 * cédula is typed only when the profile has none, and an address only when no saved one can be reused.
 */
export async function fillCheckoutBilling(page: Page) {
  const billing = page.locator("#checkout-billing");
  if (!await billing.count()) return;
  const change = billing.getByRole("button", { name: "Cambiar datos de factura" });
  // While an attempt is pending the checkout is locked: leave the invoice exactly as it is.
  if (await change.count()) {
    if (!await change.isEnabled()) return;
    await change.click();
  }
  const name = billing.getByLabel("Nombre para la factura", { exact: true });
  if (await name.count()) await name.fill("Compradora Prueba");
  const cedula = billing.getByLabel("Cédula o RUC", { exact: true });
  if (await cedula.count() && await cedula.isEditable()) await cedula.fill("0123456782");
  for (const [label, value] of [["Dirección", "Calle Fiscal de prueba"], ["Ciudad", "Quito"], ["Provincia", "Pichincha"]] as const) {
    const field = billing.getByLabel(label, { exact: true });
    if (await field.count()) await field.fill(value);
  }
  const use = billing.getByRole("button", { name: "Usar estos datos" });
  if (await use.count() && await use.isEnabled()) await use.click();
}
