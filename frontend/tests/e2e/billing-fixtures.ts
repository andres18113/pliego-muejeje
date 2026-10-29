import type { Page } from "@playwright/test";
import { choosePlace } from "./geo-fixtures";
/** Synthetic fiscal data for existing purchase/concurrency scenarios, independent of delivery fixtures. */
export const billingFixturePayload = {billingRecipient:"ACCOUNT",billingIdentity:{type:"EC_CEDULA",number:"0123456782"},buyerName:"Compradora Prueba",billingAddress:{line1:"Calle Fiscal de prueba",line2:"",provinceId:"17",cityId:"893",countryCode:"EC",postalCode:""}};

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
  const street = billing.getByLabel("Dirección", { exact: true });
  if (await street.count()) await street.fill("Calle Fiscal de prueba");
  // The invoice's own address takes province and city from the catalog pickers (ADR 0044).
  if (await billing.getByRole("combobox", { name: "Provincia", exact: true }).count()) await choosePlace(page, billing);
  const use = billing.getByRole("button", { name: "Usar estos datos" });
  if (await use.count() && await use.isEnabled()) await use.click();
}
