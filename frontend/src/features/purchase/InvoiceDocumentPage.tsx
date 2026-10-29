import { useEffect, useRef, useState, type ReactNode } from "react";
import { useMediaQuery } from "@mantine/hooks";
import { useQuery } from "@tanstack/react-query";
import { useParams } from "react-router-dom";
import { useSession } from "@/app/session";
import { Button, ButtonLink } from "@/components/ui/button";
import { AccountShell } from "@/features/account/AccountShell";
import { getInvoiceAccess, getInvoiceFile, getInvoiceMetadata, type InvoiceDocumentAccess, type InvoiceMetadata } from "@/shared/api/billing";
import { ApiRequestError, toApiRequestError } from "@/shared/api/errors";
import { MaterialSymbol } from "@/shared/ui/MaterialSymbol";
import { ParentLink } from "@/shared/ui/ParentLink";
import { ReadFailure } from "./CartPage";
import { CustomerOnly, PurchasePage } from "./PurchaseChrome";
import classes from "./invoiceDocument.module.css";

const PREPARING_POLL_MS = 5_000;
const PREPARING_WAIT_MS = 120_000;

/** The document as this page shows it: bytes streamed through the API, or a short-lived private-storage link. */
type InvoiceDocument = { kind: "blob"; blob: Blob } | { kind: "signed"; url: string };

function pdfState(metadata: InvoiceMetadata | null | undefined) {
  return metadata?.files.find((file) => file.type === "PDF")?.state;
}

/** Authorizes first (the access endpoint), then reads what it names; a signed link is never fetched here. */
async function readDocument(orderId: string, signal?: AbortSignal, disposition: "inline" | "attachment" = "inline"): Promise<{ access: InvoiceDocumentAccess; document: InvoiceDocument }> {
  const access = await getInvoiceAccess(orderId, signal, disposition);
  if (access.delivery === "SIGNED_URL") {
    // Only an absolute HTTPS link is ever framed or opened; anything else is a broken answer.
    if (!/^https:\/\//.test(access.url)) throw toApiRequestError(502, {}, "No pudimos abrir el documento", "La respuesta del servidor está incompleta.");
    return { access, document: { kind: "signed", url: access.url } };
  }
  return { access, document: { kind: "blob", blob: await getInvoiceFile(orderId, "PDF", signal, "inline") } };
}

/**
 * The invoice's stable address (`/orders/:orderId/invoice`), the one the invoice email links to. Signing in returns
 * here; the server decides whether the account may see the document before any file or temporary link is handed
 * over. The PDF itself carries the academic-simulation notice, so the page adds none.
 */
export function InvoiceDocumentPage() {
  const { orderId = "" } = useParams();
  return (
    <PurchasePage title="Factura">
      <CustomerOnly intent={`/orders/${orderId}/invoice`} task="ver tu factura">
        <InvoiceDocumentContent key={orderId} orderId={orderId} />
      </CustomerOnly>
    </PurchasePage>
  );
}

function InvoiceDocumentContent({ orderId }: { orderId: string }) {
  const { clear } = useSession();
  // Phones rarely show a PDF inside a page; the frame is not rendered there, so its file is never loaded twice.
  const phone = useMediaQuery("(max-width: 640px)", false, { getInitialValueInEffect: false });
  const validId = /^[1-9][0-9]{0,18}$/.test(orderId) && BigInt(orderId) <= 9223372036854775807n;
  const metadataQuery = useQuery({
    queryKey: ["customer-invoice", orderId],
    queryFn: ({ signal }) => getInvoiceMetadata(orderId, signal),
    enabled: validId,
    meta: { authRequired: true },
    retry: false,
    refetchInterval: (current) => {
      const data = current.state.data;
      const waiting = data?.provenance === "SIMULATED" && data.state === "ISSUED" && pdfState(data) !== "READY";
      return waiting && current.state.dataUpdateCount < PREPARING_WAIT_MS / PREPARING_POLL_MS ? PREPARING_POLL_MS : false;
    },
  });
  const metadata = metadataQuery.data;
  // When the first answer arrived: the quiet wait is bounded from there.
  const firstAnswerAt = useRef<number | null>(null);
  if (metadataQuery.dataUpdatedAt && firstAnswerAt.current === null) firstAnswerAt.current = metadataQuery.dataUpdatedAt;
  const ready = metadata?.state === "ISSUED" && pdfState(metadata) === "READY";
  const documentQuery = useQuery({
    queryKey: ["customer-invoice-document", orderId],
    queryFn: ({ signal }) => readDocument(orderId, signal),
    enabled: ready,
    meta: { authRequired: true },
    retry: false,
    gcTime: 0,
    staleTime: Infinity,
    refetchOnWindowFocus: false,
  });
  const blob = documentQuery.data?.document.kind === "blob" ? documentQuery.data.document.blob : null;
  const [blobUrl, setBlobUrl] = useState<{ blob: Blob; url: string } | null>(null);
  useEffect(() => {
    if (!blob) return;
    const url = URL.createObjectURL(blob);
    setBlobUrl({ blob, url });
    return () => URL.revokeObjectURL(url);
  }, [blob]);
  const [notice, setNotice] = useState<string | null>(null);
  const busy = useRef(false);
  const headingRef = useRef<HTMLHeadingElement>(null);

  const error = metadataQuery.error ?? documentQuery.error;
  useEffect(() => { if (error instanceof ApiRequestError && error.status === 401) clear("expired"); }, [error, clear]);
  // A file that went back to preparation between the two reads: read the documents' state again.
  const notReady = documentQuery.error instanceof ApiRequestError && documentQuery.error.code === "INVOICE_FILE_NOT_READY";
  const refetchMetadata = metadataQuery.refetch;
  useEffect(() => { if (notReady) void refetchMetadata(); }, [notReady, refetchMetadata]);

  const documentNumber = metadata?.documentNumber ?? null;
  const shell = (children: ReactNode) => <AccountShell
    title="Factura"
    headingRef={headingRef}
    before={<ParentLink to={validId ? `/orders/${orderId}` : "/orders"}>{validId ? "Volver al pedido" : "Volver a mis pedidos"}</ParentLink>}
  >{children}</AccountShell>;

  const missing = !validId || (metadataQuery.isSuccess && (!metadata || metadata.state !== "ISSUED"))
    || (documentQuery.error instanceof ApiRequestError && documentQuery.error.code === "INVOICE_NOT_FOUND");
  if (missing) {
    return shell(
      <section className={`purchase-gate ${classes.gate}`} aria-labelledby="invoice-missing-heading">
        <h2 id="invoice-missing-heading">No encontramos esta factura.</h2>
        <p>Puede que el pedido todavía no tenga factura o que no pertenezca a tu cuenta.</p>
        <div className="purchase-actions"><ButtonLink variant="secondary" to="/orders">Ver mis pedidos</ButtonLink></div>
      </section>,
    );
  }
  if (metadataQuery.isPending) return shell(<p className="purchase-loading" role="status">Consultando tu factura…</p>);
  if (!metadata) {
    return shell(<ReadFailure title="No pudimos consultar tu factura." error={metadataQuery.error} onRetry={() => void metadataQuery.refetch()} retrying={metadataQuery.isFetching} />);
  }

  const facts = <dl className={classes.facts}>
    {documentNumber && <div className={classes.numberFact}><dt>Factura N.°</dt><dd>{documentNumber}</dd></div>}
    <div><dt>Pedido N.°</dt><dd>{orderId}</dd></div>
  </dl>;

  const unavailable = (metadata.provenance === "LEGACY" && !ready)
    || (documentQuery.error instanceof ApiRequestError && documentQuery.error.code === "INVOICE_FILE_UNAVAILABLE");
  if (unavailable) {
    return shell(<div className={classes.page}>{facts}
      <section className={classes.state} aria-labelledby="invoice-unavailable-heading">
        <h2 id="invoice-unavailable-heading">El archivo de esta factura no está disponible.</h2>
        <p>Es una factura histórica que se conserva sin documento descargable.</p>
      </section>
    </div>);
  }

  if (!ready || notReady) {
    const waited = metadataQuery.dataUpdatedAt - (firstAnswerAt.current ?? metadataQuery.dataUpdatedAt) >= PREPARING_WAIT_MS;
    return shell(<div className={classes.page}>{facts}
      <section className={classes.state} aria-labelledby="invoice-preparing-heading" aria-live="polite">
        <h2 id="invoice-preparing-heading">Estamos preparando tu factura.</h2>
        <p>{waited ? "Está tardando más de lo habitual. Vuelve a consultarla en unos minutos." : "Aparecerá aquí en cuanto esté lista; no necesitas recargar la página."}</p>
        {waited && <Button variant="secondary" type="button" onClick={() => { void metadataQuery.refetch(); }} aria-disabled={metadataQuery.isFetching || undefined}>
          {metadataQuery.isFetching ? "Consultando…" : "Volver a consultar"}
        </Button>}
      </section>
    </div>);
  }

  if (documentQuery.isError) {
    return shell(<div className={classes.page}>{facts}
      <ReadFailure title="No pudimos abrir tu factura." error={documentQuery.error} onRetry={() => void documentQuery.refetch()} retrying={documentQuery.isFetching} />
    </div>);
  }

  const shown = documentQuery.data?.document;
  const src = shown?.kind === "signed" ? shown.url : blobUrl && blobUrl.blob === blob ? blobUrl.url : null;
  const fileName = `factura-${documentNumber ?? orderId}.pdf`;
  const title = documentNumber ? `Factura N.° ${documentNumber}` : `Factura del pedido ${orderId}`;

  /**
   * A signed link expires after a few minutes, so every press asks the server for a fresh one. Saving asks for a
   * link whose signed response is an attachment, so the browser downloads it instead of showing it.
   */
  async function freshSource(disposition: "inline" | "attachment"): Promise<string | null> {
    if (shown?.kind !== "signed") return src;
    const result = await readDocument(orderId, undefined, disposition);
    return result.document.kind === "signed" ? result.document.url : null;
  }

  async function act(kind: "open" | "download") {
    if (busy.current || !src) return;
    busy.current = true; setNotice(null);
    // Opened inside the press so no popup blocker stops it.
    const tab = kind === "open" ? window.open("", "_blank") : null;
    if (tab) tab.opener = null;
    try {
      const target = await freshSource(kind === "download" ? "attachment" : "inline");
      if (!target) throw new Error("missing source");
      if (tab && !tab.closed) { tab.location.href = target; return; }
      const link = document.createElement("a");
      link.href = target;
      if (shown?.kind === "blob") link.download = fileName;
      // An attachment answer saves the file and leaves this page in place; viewing without a tab opens one.
      else if (kind === "open") { link.target = "_blank"; link.rel = "noopener"; }
      document.body.append(link); link.click(); link.remove();
    } catch (failure) {
      tab?.close();
      if (failure instanceof ApiRequestError && failure.status === 401) { clear("expired"); return; }
      setNotice("No pudimos preparar el documento. Vuelve a intentarlo en unos momentos.");
    } finally {
      busy.current = false;
    }
  }

  return shell(<div className={classes.page}>
    <div className={classes.bar}>
      {facts}
      <div className={classes.actions}>
        <Button variant="secondary" type="button" className={classes.button} onClick={() => void act("open")} aria-disabled={!src || undefined}>
          <MaterialSymbol name="open_in_new" aria-hidden="true" size={20} /><span>Abrir en otra pestaña</span>
        </Button>
        <Button variant="primary" type="button" className={classes.button} onClick={() => void act("download")} aria-disabled={!src || undefined}>
          <MaterialSymbol name="download" aria-hidden="true" size={20} /><span>Descargar PDF</span>
        </Button>
      </div>
    </div>
    {notice && <p className={classes.notice} role="alert">{notice}</p>}
    <section className={classes.stage} aria-label={title}>
      {!phone && <div className={classes.frame}>
        {src
          ? <iframe className={classes.viewer} src={src} title={title} />
          : <p className="purchase-loading" role="status">Abriendo tu factura…</p>}
      </div>}
      {/* Phones rarely show a PDF inside a page: the same document as one object that opens it. */}
      <div className={classes.compact}>
        <MaterialSymbol name="receipt_long" aria-hidden="true" size={40} />
        <p className={classes.compactTitle}>{title}</p>
        <p className={classes.compactMeta}>Documento PDF</p>
        <Button variant="primary" type="button" className={classes.button} onClick={() => void act("open")} aria-disabled={!src || undefined}>
          <MaterialSymbol name="open_in_new" aria-hidden="true" size={20} /><span>Abrir factura</span>
        </Button>
      </div>
    </section>
  </div>);
}
