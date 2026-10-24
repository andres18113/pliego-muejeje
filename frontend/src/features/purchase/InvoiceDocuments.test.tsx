import { useState } from "react";
import { act, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import { json, renderPurchaseRoute, stubApi } from "@/test/purchase";
import { InvoiceDocuments } from "./InvoiceDocuments";
const meta={invoiceId:"8",orderId:"700",state:"ISSUED",provenance:"SIMULATED",documentNumber:"001-001-000000001",files:[{type:"PDF",state:"READY"},{type:"XML",state:"PENDING"}]};
afterEach(()=>vi.unstubAllGlobals());
it("presents simulated document states and downloads only an explicit authenticated available file", async()=>{
  const api=stubApi({"GET /api/v1/orders/700/invoice":()=>json(meta),"GET /api/v1/orders/700/invoice/files/PDF":()=>new Response("%PDF-synthetic",{headers:{"Content-Type":"application/pdf"}})});
  const create=vi.fn(()=>"blob:synthetic-private-file"),revoke=vi.fn();
  vi.stubGlobal("URL",class extends URL {static createObjectURL=create; static revokeObjectURL=revoke;});
  const click=vi.spyOn(HTMLAnchorElement.prototype,"click").mockImplementation(()=>{});
  renderPurchaseRoute([{path:"/orders/700",element:<InvoiceDocuments orderId="700"/>}],"/orders/700");
  try {
    expect(await screen.findByText(/SIN VALIDEZ TRIBUTARIA/)).toBeInTheDocument();
    expect(screen.getByRole("button",{name:"Descargar XML"})).toBeDisabled();
    expect(api.count("GET","/api/v1/orders/700/invoice/files/PDF")).toBe(0);
    await userEvent.click(screen.getByRole("button",{name:"Descargar PDF"}));
    await screen.findByText("Descarga preparada.");
    const download=api.calls.find(call=>call.path.endsWith("/files/PDF"));
    expect(download?.headers.get("Authorization")).toBe("Bearer customer-token");
    expect(create).toHaveBeenCalledOnce();
    expect(revoke).toHaveBeenCalledWith("blob:synthetic-private-file");
    expect(click).toHaveBeenCalledOnce();
    expect(api.calls.filter(call=>call.method==="POST")).toHaveLength(0);
    expect(screen.queryByRole("link",{name:/PDF|XML/})).not.toBeInTheDocument();
  } finally {click.mockRestore();}
});
it("keeps a failed generator recoverable by metadata refresh without any purchase or generation command",async()=>{
  const api=stubApi({"GET /api/v1/orders/700/invoice":()=>json({...meta,state:"DRAFT",documentNumber:null,files:[{type:"PDF",state:"FAILED"},{type:"XML",state:"PROCESSING"}]})});
  renderPurchaseRoute([{path:"/orders/700",element:<InvoiceDocuments orderId="700"/>}],"/orders/700");
  expect(await screen.findByText(/Borrador/)).toBeInTheDocument();
  expect(screen.getByText(/No necesitas repetir la compra/)).toBeInTheDocument();
  await userEvent.click(screen.getByRole("button",{name:"Actualizar documentos"}));
  await act(async()=>{await Promise.resolve();});
  expect(api.count("GET","/api/v1/orders/700/invoice")).toBe(2);
  expect(api.calls.some(call=>call.method==="POST" || call.path.includes("/files/"))).toBe(false);
});
it("renders invalidated drafts as VOID and explains that legacy documents do not imply queued generation",async()=>{
  stubApi({"GET /api/v1/orders/700/invoice":()=>json({...meta,state:"VOID",provenance:"LEGACY",documentNumber:null,files:[]})});
  renderPurchaseRoute([{path:"/orders/700",element:<InvoiceDocuments orderId="700"/>}],"/orders/700");
  expect(await screen.findByText(/Borrador invalidado/)).toBeInTheDocument();
  expect(screen.getByText("Documento histórico no disponible para descarga")).toBeInTheDocument();
  expect(screen.queryByText(/se preparan automáticamente/)).not.toBeInTheDocument();
});
it("handles 409 file not ready as preparation without offering a checkout or generation retry",async()=>{
  const api=stubApi({"GET /api/v1/orders/700/invoice":()=>json(meta),"GET /api/v1/orders/700/invoice/files/PDF":()=>json({code:"INVOICE_FILE_NOT_READY",title:"Documento en preparación",detail:"El archivo aún no está disponible.",status:409},409)});
  renderPurchaseRoute([{path:"/orders/700",element:<InvoiceDocuments orderId="700"/>}],"/orders/700");
  await userEvent.click(await screen.findByRole("button",{name:"Descargar PDF"}));
  expect(await screen.findByText(/El documento sigue en preparación/)).toBeInTheDocument();
  expect(api.calls.filter(call=>call.method==="POST")).toHaveLength(0);
});
it("labels legacy UNAVAILABLE files as unavailable rather than preparation",async()=>{
  stubApi({"GET /api/v1/orders/700/invoice":()=>json({...meta,provenance:"LEGACY",files:[{type:"PDF",state:"UNAVAILABLE"},{type:"XML",state:"UNAVAILABLE"}]})});
  renderPurchaseRoute([{path:"/orders/700",element:<InvoiceDocuments orderId="700"/>}],"/orders/700");
  expect(await screen.findByText("Documento histórico no disponible para descarga")).toBeInTheDocument();
  expect(screen.getByRole("button",{name:"Descargar PDF"})).toBeDisabled();
  expect(screen.queryByText(/En preparación/)).not.toBeInTheDocument();
});

it("discards an old order download after navigation and leaves the new order controls usable",async()=>{
  let finish!: (response:Response)=>void;
  const create=vi.fn(()=>"blob:should-not-be-created");
  vi.stubGlobal("URL",class extends URL {static createObjectURL=create;static revokeObjectURL=vi.fn();});
  stubApi({"GET /api/v1/orders/700/invoice":()=>json(meta),"GET /api/v1/orders/701/invoice":()=>json({...meta,orderId:"701"}),"GET /api/v1/orders/700/invoice/files/PDF":()=>new Promise<Response>(resolve=>{finish=resolve;})});
  function SwitchOrder(){const [id,setId]=useState("700");return <><button onClick={()=>setId("701")}>Otro pedido</button><InvoiceDocuments orderId={id}/></>;}
  renderPurchaseRoute([{path:"/orders/700",element:<SwitchOrder/>}],"/orders/700");
  await userEvent.click(await screen.findByRole("button",{name:"Descargar PDF"}));
  await waitFor(()=>expect(finish).toBeTypeOf("function"));
  await userEvent.click(screen.getByRole("button",{name:"Otro pedido"}));
  expect(await screen.findByRole("button",{name:"Descargar PDF"})).toBeEnabled();
  await act(async()=>{finish(new Response("%PDF-synthetic",{headers:{"Content-Type":"application/pdf"}}));});
  expect(create).not.toHaveBeenCalled();
  expect(screen.queryByText("Descarga preparada.")).not.toBeInTheDocument();
});
