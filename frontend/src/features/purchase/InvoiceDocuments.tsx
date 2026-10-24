import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useSession } from "@/app/session";
import { useSessionOperationScope } from "@/app/sessionOperation";
import { getInvoiceFile, getInvoiceMetadata, type InvoiceFileType } from "@/shared/api/billing";
import { ApiRequestError, readRecoveryDetail } from "@/shared/api/errors";
import { Button } from "@/components/ui/button";
import classes from "./invoiceDocuments.module.css";
const states={DRAFT:"Borrador",ISSUED:"Emitida",VOID:"Borrador invalidado"};
const fileStates={PENDING:"En preparación",PROCESSING:"En preparación",READY:"Disponible",FAILED:"Preparación pendiente de recuperación",UNAVAILABLE:"No disponible"};

export function InvoiceDocuments({orderId}:{orderId:string}) {
  return <InvoiceDocumentsContent key={orderId} orderId={orderId} />;
}
function InvoiceDocumentsContent({orderId}:{orderId:string}) {
  const scope=useSessionOperationScope(`invoice:${orderId}`);
  const {clear}=useSession();
  const query=useQuery({queryKey:["customer-invoice",orderId],queryFn:({signal})=>getInvoiceMetadata(orderId,signal),meta:{authRequired:true},retry:false});
  const [downloading,setDownloading]=useState<InvoiceFileType|null>(null);
  const [notice,setNotice]=useState<string|null>(null);
  const lock=useRef(false);
  useEffect(()=>{if(query.error instanceof ApiRequestError && query.error.status===401) clear("expired");},[query.error,clear]);
  async function download(type:InvoiceFileType) {
    if(lock.current || !scope.isCurrent()) return;
    lock.current=true; setDownloading(type);setNotice(null);
    try {
      scope.assertCurrent();
      const blob=await getInvoiceFile(orderId,type);
      if(!scope.isCurrent()) return;
      const url=URL.createObjectURL(blob);
      try {
        const link=document.createElement("a");
        link.href=url;link.download=`factura-${orderId}.${type.toLowerCase()}`;
        document.body.append(link);link.click();link.remove();
      } finally {URL.revokeObjectURL(url);}
      setNotice("Descarga preparada.");
    } catch(error) {
      if(!scope.isCurrent()) return;
      if(error instanceof ApiRequestError && error.status===401){clear("expired");return;}
      setNotice(error instanceof ApiRequestError && error.code === "INVOICE_FILE_NOT_READY" ? "El documento sigue en preparación. No necesitas repetir la compra." : error instanceof ApiRequestError && error.code === "INVOICE_FILE_UNAVAILABLE" ? "Documento histórico no disponible para descarga" : readRecoveryDetail(error));
      void query.refetch();
    } finally {lock.current=false;if(scope.isCurrent())setDownloading(null);}
  }
  if(query.isSuccess && !query.data) return null;
  return <section className={classes.panel} aria-labelledby={`invoice-heading-${orderId}`}>
    <h2 id={`invoice-heading-${orderId}`}>Documentos de facturación</h2>
    {query.isPending ? <p role="status">Consultando documentos…</p> : query.isError ? <p role="status">No pudimos actualizar los documentos. Tu pedido se conserva.</p> : null}
    {query.data && <div className={classes.document}>
      <h3>Factura{query.data.documentNumber ? ` N.° ${query.data.documentNumber}` : " en preparación"}</h3>
      <p>Estado: {states[query.data.state]}</p>
      {query.data.provenance==="SIMULATED" && <p>SIMULACIÓN ACADÉMICA — SIN VALIDEZ TRIBUTARIA</p>}
      {query.data.provenance === "LEGACY" && (query.data.files.length === 0 || query.data.files.every(file => file.state === "UNAVAILABLE")) && <p>Documento histórico no disponible para descarga</p>}
      {query.data.provenance === "SIMULATED" && query.data.state !== "VOID" && query.data.files.some(file=>file.state!=="READY") && <p>No necesitas repetir la compra. Los archivos se preparan automáticamente.</p>}
      {(["PDF","XML"] as const).map(type=>{
        const file=query.data!.files.find(candidate=>candidate.type===type);
        return <div key={type}><p>{type}: {file ? fileStates[file.state] : query.data!.provenance === "LEGACY" || query.data!.state === "VOID" ? "No disponible" : "En preparación"}</p><Button type="button" variant="text" disabled={file?.state!=="READY" || Boolean(downloading) || query.isError} onClick={()=>void download(type)}>{downloading===type ? `Descargando ${type}…` : `Descargar ${type}`}</Button></div>;
      })}
    </div>}
    <Button type="button" variant="text" disabled={query.isFetching} onClick={()=>void query.refetch()}>Actualizar documentos</Button>
    {notice && <p role="status">{notice}</p>}
  </section>;
}
