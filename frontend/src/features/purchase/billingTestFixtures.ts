import { fireEvent, within } from "@testing-library/react";
import type { CheckoutBilling } from "@/shared/api/billing";
import { savedAddress } from "@/test/purchase";

/**
 * Synthetic invoice inputs for tests whose subject is purchase integrity rather than billing. It goes through the
 * checkout as a customer would: the invoice details open to set the name, and only fields that are shown are filled
 * (the cédula when the profile has none; an address only when no saved one can be reused).
 */
export function fillBillingFixture() {
  const section = document.getElementById("checkout-billing");
  if (!section) return;
  const billing = within(section);
  if (!billing.queryByLabelText("Nombre para la factura")) {
    const change = billing.queryByRole("button", { name: "Cambiar datos de factura" });
    if (change) fireEvent.click(change);
  }
  const fields: [string, string][] = [["Nombre para la factura", "Compradora Prueba"], ["Cédula o RUC", "0123456782"], ["Dirección", "Calle Fiscal de prueba"], ["Ciudad", "Quito"], ["Provincia", "Pichincha"]];
  for (const [label, value] of fields) {
    const input = billing.queryByLabelText(label, { exact: true });
    if (input && !(input as HTMLInputElement).readOnly) fireEvent.change(input, { target: { value } });
  }
}

export const billingFixturePayload: CheckoutBilling = {billingIdentity:{type:"EC_CEDULA",number:"0123456782"},buyerName:"Compradora Prueba",billingAddress:{line1:"Calle Fiscal de prueba",line2:"",city:"Quito",province:"Pichincha",countryCode:"EC",postalCode:""}};

/** Home delivery reuses the delivery address for the invoice: the payload carries the saved address. */
export const billingFromSavedAddress: CheckoutBilling = {
  ...billingFixturePayload,
  billingAddress: { line1: savedAddress.line1, line2: savedAddress.line2 ?? "", city: savedAddress.city, province: savedAddress.province, countryCode: "EC", postalCode: savedAddress.postalCode ?? "" },
};
