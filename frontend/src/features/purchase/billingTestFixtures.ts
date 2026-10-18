import { fireEvent, screen } from "@testing-library/react";
/** Synthetic fiscal inputs for tests whose subject is purchase integrity rather than billing validation. */
export function fillBillingFixture() {
  if (!screen.queryByLabelText("Cédula")) return;
  for (const [label,value] of [["Nombre para la factura","Compradora Prueba"],["Cédula","0123456782"],["Dirección de facturación","Calle Fiscal de prueba"],["Ciudad de facturación","Quito"],["Provincia de facturación","Pichincha"]]) {
    fireEvent.change(screen.getByLabelText(label),{target:{value}});
  }
}

export const billingFixturePayload = {billingIdentity:{type:"EC_CEDULA",number:"0123456782"},buyerName:"Compradora Prueba",billingAddress:{line1:"Calle Fiscal de prueba",line2:"",city:"Quito",province:"Pichincha",countryCode:"EC",postalCode:""}};
