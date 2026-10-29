import { fireEvent, within } from "@testing-library/react";
import type { CheckoutBilling } from "@/shared/api/billing";
import { choosePlace, savedAddress } from "@/test/purchase";

/**
 * Synthetic invoice inputs for tests whose subject is purchase integrity rather than billing. It goes through the
 * checkout as a customer would: the invoice details open to set the name, and only fields that are shown are filled
 * (the cédula when the profile has none; an address only when no saved one can be reused).
 */
export async function fillBillingFixture() {
  const section = document.getElementById("checkout-billing");
  if (!section) return;
  const billing = within(section);
  if (!billing.queryByLabelText("Nombre para la factura")) {
    const change = billing.queryByRole("button", { name: "Cambiar datos de factura" });
    if (change) fireEvent.click(change);
  }
  const fields: [string, string][] = [["Nombre para la factura", "Compradora Prueba"], ["Cédula o RUC", "0123456782"], ["Dirección", "Calle Fiscal de prueba"]];
  for (const [label, value] of fields) {
    const input = billing.queryByLabelText(label, { exact: true });
    if (input && !(input as HTMLInputElement).readOnly) fireEvent.change(input, { target: { value } });
  }
  // The invoice's own address takes its province and city from the catalog pickers.
  if (billing.queryByRole("combobox", { name: "Provincia" })) await chooseBillingPlace();
}

/** Province, then city, in the invoice's "Otra dirección" (stubApi serves the catalog slice). */
export const chooseBillingPlace = (province?: string, city?: string) => choosePlace(document.getElementById("checkout-billing")!, province, city);

export const billingFixturePayload: CheckoutBilling = {billingRecipient:"ACCOUNT",billingIdentity:{type:"EC_CEDULA",number:"0123456782"},buyerName:"Compradora Prueba",billingAddress:{line1:"Calle Fiscal de prueba",line2:"",provinceId:"17",cityId:"893",countryCode:"EC",postalCode:""}};

/** Home delivery reuses the delivery address for the invoice: the payload carries the saved address. */
export const billingFromSavedAddress: CheckoutBilling = {
  ...billingFixturePayload,
  billingAddress: { line1: savedAddress.line1, line2: savedAddress.line2 ?? "", provinceId: savedAddress.provinceId!, cityId: savedAddress.cityId!, countryCode: "EC", postalCode: savedAddress.postalCode ?? "" },
};
