import { expect, test, type Page } from "@playwright/test";
import { storefrontNavigationFixture } from "../../src/test/storefrontFixture";
import { fillCheckoutBilling } from "./billing-fixtures";

async function installBillingApi(page: Page, loseCheckout = false) {
  const state = { posts: [] as {body:Record<string,unknown>;key:string|null}[], downloads:0 };
  await page.route("**/api/v1/**", async route => {
    const request=route.request(), url=new URL(request.url()), path=url.pathname.replace("/api/v1", "");
    const method=request.method();
    const ok=(body:unknown,status=200)=>route.fulfill({json:body,status});
    if(path==="/auth/refresh") return ok({accessToken:"synthetic-billing-token",tokenType:"Bearer",expiresInSeconds:1800,user:{userId:"2",email:"billing@example.test",role:"CUSTOMER"}});
    if(path==="/storefront/navigation") return ok(storefrontNavigationFixture);
    if(path==="/me") return ok({customerId:"2",email:"billing@example.test",firstNames:"Compradora",lastNames:"Prueba",phone:null,state:"ACTIVE",version:"0",emailVerified:true});
    if(path==="/me/billing-identity") return route.fulfill({status:204});
    if(path==="/me/favorites") return ok({items:[],page:0,pageSize:10,totalCount:"0"});
    if(path==="/me/favorites/status") return ok([]);
    if(path==="/reference/transfer-details") return ok({bank:"Banco de prueba",beneficiary:"PLIEGO Prueba",accountType:"Ahorros",accountNumber:"000000",identification:"0000000000"});
    if(path==="/cart") return ok({cartId:"40",state:"ACTIVE",requiresPhysicalFulfillment:false,physicalItemCount:0,digitalItemCount:1,items:[{cartItemId:"50",editionId:"42",title:"Libro digital de prueba",authors:"Autora Prueba",sku:"TEST-42",coverUrl:null,quantity:1,currentPrice:"18.50",currentSubtotal:"18.50",available:true,requiresPhysicalFulfillment:false,quantityEditable:false,format:"EBOOK",unavailabilityReason:null}],totalCurrent:"18.50",subtotal:"18.50",taxRate:"0.00",taxAmount:"0.00",shippingAmount:"0.00",total:"18.50",quoteFingerprint:"a".repeat(64)});
    if(path==="/checkout"&&method==="POST") {
      state.posts.push({body:request.postDataJSON(),key:request.headers()["idempotency-key"] ?? null});
      if(loseCheckout) return route.abort("failed");
      return ok({orderId:"700",orderState:"CONFIRMED",paymentState:"APPROVED",total:"18.50",fulfillment:null},201);
    }
    if(path==="/orders/700") return ok({orderId:"700",orderState:"CONFIRMED",purchaseState:"CONFIRMED",subtotal:"18.50",taxRate:"0.00",taxAmount:"0.00",shippingAmount:"0.00",total:"18.50",createdAt:"2026-10-17T15:00:00Z",items:[{orderItemId:"1",title:"Libro digital de prueba",authors:"Autora Prueba",publisher:null,format:"EBOOK",unitPrice:"18.50",quantity:1,subtotal:"18.50",requiresPhysicalFulfillment:false}],address:null,payment:{method:"TRANSFER",state:"APPROVED",amount:"18.50",reference:"SIM-TEST"},stateHistory:[],fulfillment:null,shipment:null,invoice:null,creditNotes:[],availableActions:{cancel:false,changeShippingAddress:false}});
    if(path==="/orders/700/invoice") return ok({invoiceId:"8",orderId:"700",state:"ISSUED",provenance:"SIMULATED",documentNumber:"999-999-000000001",files:[{type:"PDF",state:"READY"},{type:"XML",state:"PENDING"}]});
    if(path==="/orders/700/invoice/files/PDF") {state.downloads++;expect(request.headers()["authorization"]).toBe("Bearer synthetic-billing-token");return route.fulfill({status:200,contentType:"application/pdf",body:"%PDF-1.4 synthetic academic fixture"});}
    if(path==="/orders") return ok({items:[],page:0,pageSize:10,totalCount:"0"});
    return ok({code:"NOT_FOUND",status:404,title:"No disponible",detail:"Recurso de prueba no disponible."},404);
  });
  return state;
}
async function fillFiscalData(page:Page) { await fillCheckoutBilling(page); }
test("digital nominative checkout validates identity and downloads authenticated academic PDF",async({page})=>{
  const state=await installBillingApi(page);
  await page.goto("/checkout");
  await page.getByRole("button",{name:"Transferencia bancaria"}).click();
  await page.getByRole("button",{name:"Hacer pedido"}).click();
  await expect(page.locator("#billing-cedula-status")).toHaveText("Escribe tu cédula o RUC.");
  expect(state.posts).toHaveLength(0);
  await fillFiscalData(page);
  await page.getByRole("button",{name:"Hacer pedido"}).click();
  await expect(page).toHaveURL(/\/orders\/700$/);
  await expect(page.getByText("SIMULACIÓN ACADÉMICA — SIN VALIDEZ TRIBUTARIA")).toBeVisible();
  expect(state.posts).toHaveLength(1);
  expect(state.posts[0]).toMatchObject({body:{fulfillmentMethod:"DIGITAL_ONLY",billingIdentity:{type:"EC_CEDULA",number:"0123456782"},buyerName:"Compradora Prueba",billingAddress:{line1:"Calle Fiscal de prueba",city:"Quito",province:"Pichincha",countryCode:"EC"}}});
  expect(state.posts[0].key).toMatch(/^[0-9a-f-]{36}$/);
  await expect(page.getByRole("button",{name:"Descargar XML"})).toBeDisabled();
  const downloading=page.waitForEvent("download");
  await page.getByRole("button",{name:"Descargar PDF"}).click();
  const download=await downloading;
  expect(download.suggestedFilename()).toBe("factura-700.pdf");
  expect(state.downloads).toBe(1);
  await page.reload();
  await expect(page.getByRole("button",{name:"Descargar PDF"})).toBeVisible();
  expect(state.posts).toHaveLength(1);
});
test("mobile uncertain result survives reload without a second checkout",async({page})=>{
  await page.setViewportSize({width:390,height:844});
  const state=await installBillingApi(page,true);
  await page.goto("/checkout");
  await page.getByRole("button",{name:"Transferencia bancaria"}).click();
  await fillFiscalData(page);
  await page.getByRole("button",{name:"Hacer pedido"}).click();
  await expect(page.getByRole("button",{name:"Consultar resultado"})).toBeVisible();
  expect(state.posts).toHaveLength(1);
  expect(await page.evaluate(()=>Object.keys(localStorage).filter(key=>key.startsWith("pliego:checkout-billing:")).length)).toBe(0);
  for (const value of await page.evaluate(()=>[JSON.stringify(localStorage),JSON.stringify(sessionStorage)])) {
    expect(value).not.toContain("0123456782");expect(value).not.toContain("Compradora Prueba");expect(value).not.toContain("Calle Fiscal de prueba");
  }
  await page.reload();
  await expect(page.getByRole("button",{name:"Consultar resultado"})).toBeVisible();
  expect(state.posts).toHaveLength(1);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);
});
