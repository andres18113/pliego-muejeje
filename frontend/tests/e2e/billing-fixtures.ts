import type { Page } from "@playwright/test";
/** Synthetic fiscal data for existing purchase/concurrency scenarios, independent of delivery fixtures. */
export const billingFixturePayload = {billingIdentity:{type:"EC_CEDULA",number:"0123456782"},buyerName:"Compradora Prueba",billingAddress:{line1:"Calle Fiscal de prueba",line2:"",city:"Quito",province:"Pichincha",countryCode:"EC",postalCode:""}};
export async function fillCheckoutBilling(page: Page) {
  const input=page.getByLabel("Cédula",{exact:true});
  if(!await input.count() || !await input.isEnabled()) return;
  await page.getByLabel("Nombre para la factura",{exact:true}).fill("Compradora Prueba");
  await input.fill("0123456782");
  await page.getByLabel("Dirección de facturación",{exact:true}).fill("Calle Fiscal de prueba");
  await page.getByLabel("Ciudad de facturación",{exact:true}).fill("Quito");
  await page.getByLabel("Provincia de facturación",{exact:true}).fill("Pichincha");
}
