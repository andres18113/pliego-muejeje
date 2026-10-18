import { act, fireEvent, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import { cartBody, json, renderPurchaseRoute, stubApi } from "@/test/purchase";
import { CheckoutPage } from "./CheckoutPage";
const routes = [{path:"/checkout",element:<CheckoutPage/>},{path:"/orders/:orderId",element:<h1>Pedido confirmado</h1>}];
const profile = {customerId:"2",email:"reader@example.test",firstNames:"Lectora",lastNames:"Prueba",phone:null,state:"ACTIVE",version:"0"};
function install(post: (request: Request) => Promise<Response> | Response) {
  return stubApi({"GET /api/v1/cart":()=>json(cartBody([{format:"EBOOK",requiresPhysicalFulfillment:false}])),"GET /api/v1/me":()=>json(profile),"GET /api/v1/me/billing-identity":()=>new Response(null,{status:204}),"POST /api/v1/checkout":post});
}
async function billing() {
  await screen.findByLabelText("Cédula");
  fireEvent.change(screen.getByLabelText("Nombre para la factura"),{target:{value:"Compradora Prueba"}});
  fireEvent.change(screen.getByLabelText("Cédula"),{target:{value:"0123456782"}});
  fireEvent.change(screen.getByLabelText("Dirección de facturación"),{target:{value:"Calle Fiscal de prueba"}});
  fireEvent.change(screen.getByLabelText("Ciudad de facturación"),{target:{value:"Quito"}});
  fireEvent.change(screen.getByLabelText("Provincia de facturación"),{target:{value:"Pichincha"}});
}
afterEach(()=>vi.unstubAllGlobals());
it("requires nominative fiscal details even for digital purchases and sends an independent snapshot once", async () => {
  const api=install(()=>json({orderId:"700",orderState:"CONFIRMED",paymentState:"APPROVED",total:"18.50"},201));
  renderPurchaseRoute(routes,"/checkout");
  await userEvent.click(await screen.findByRole("button",{name:/Transferencia/}));
  await userEvent.click(screen.getByRole("button",{name:"Hacer pedido"}));
  expect(api.count("POST","/api/v1/checkout")).toBe(0);
  expect(await screen.findByText(/Ingresa una cédula ecuatoriana válida/)).toBeInTheDocument();
  await billing();
  await userEvent.click(screen.getByRole("button",{name:"Hacer pedido"}));
  await screen.findByRole("heading",{name:"Pedido confirmado"});
  const posts=api.calls.filter(call=>call.method==="POST"&&call.path==="/api/v1/checkout");
  expect(posts).toHaveLength(1);
  expect(posts[0].body).toMatchObject({fulfillmentMethod:"DIGITAL_ONLY",billingIdentity:{type:"EC_CEDULA",number:"0123456782"},buyerName:"Compradora Prueba",billingAddress:{line1:"Calle Fiscal de prueba",city:"Quito",province:"Pichincha",countryCode:"EC"}});
  expect(posts[0].body).not.toHaveProperty("addressId");
  expect(Object.keys(localStorage).filter(key=>key.startsWith("pliego:checkout-billing:"))).toHaveLength(0);
});
it("stores no fiscal data while the recovery key survives remount without replay", async () => {
  const api=install(()=>Promise.reject(new TypeError("Network unavailable")));
  const view=renderPurchaseRoute(routes,"/checkout");
  await userEvent.click(await screen.findByRole("button",{name:/Transferencia/}));
  await billing();
  await userEvent.click(screen.getByRole("button",{name:"Hacer pedido"}));
  await waitFor(()=>expect(api.count("POST","/api/v1/checkout")).toBe(1));
  await screen.findByText(/El resultado sigue pendiente/);
  expect(Object.keys(localStorage).filter(key=>key.startsWith("pliego:checkout-billing:"))).toHaveLength(0);
  for (const storage of [localStorage, sessionStorage]) {
    const persisted=JSON.stringify(storage);
    expect(persisted).not.toContain("0123456782");
    expect(persisted).not.toContain("Compradora Prueba");
    expect(persisted).not.toContain("Calle Fiscal de prueba");
  }
  expect(Object.keys(localStorage).some(key=>key.startsWith("pliego:pending:checkout:"))).toBe(true);
  view.unmount();
  renderPurchaseRoute(routes,"/checkout");
  await act(async()=>{await new Promise(resolve=>setTimeout(resolve,50));});
  expect(api.count("POST","/api/v1/checkout")).toBe(1);
  expect(api.calls.filter(call=>call.path.includes("/resolve"))).toHaveLength(0);
});
it("routes authoritative fiscal validation back to the field and closes the rejected intent", async()=>{
  const api=install(()=>json({status:400,code:"VALIDATION_ERROR",title:"Datos inválidos",detail:"Revisa los datos fiscales.",violations:[{field:"billingIdentity.number",message:"Revisa la cédula enviada."}]},400));
  renderPurchaseRoute(routes,"/checkout");
  await userEvent.click(await screen.findByRole("button",{name:/Transferencia/}));
  await billing();
  await userEvent.click(screen.getByRole("button",{name:"Hacer pedido"}));
  expect(await screen.findByText("Revisa la cédula enviada.")).toBeInTheDocument();
  await waitFor(() => expect(screen.getByLabelText("Cédula")).toHaveFocus());
  expect(api.count("POST","/api/v1/checkout")).toBe(1);
  expect(Object.keys(localStorage).filter(key=>key.startsWith("pliego:checkout-billing:"))).toHaveLength(0);
});
