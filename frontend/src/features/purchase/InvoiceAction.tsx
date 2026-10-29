import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useSession } from "@/app/session";
import { useSessionOperationScope } from "@/app/sessionOperation";
import { Button } from "@/components/ui/button";
import { getInvoiceFile, getInvoiceMetadata, type InvoiceMetadata } from "@/shared/api/billing";
import { ApiRequestError, readRecoveryDetail } from "@/shared/api/errors";
import { MaterialSymbol } from "@/shared/ui/MaterialSymbol";
import classes from "./invoiceAction.module.css";

const PREPARING_POLL_MS = 5_000;
/** About two minutes of quiet checks; after that the action simply tries when pressed. */
const PREPARING_WAIT_MS = 120_000;

function pdfState(metadata: InvoiceMetadata | null | undefined) {
  return metadata?.files.find((file) => file.type === "PDF")?.state;
}
function isPreparing(metadata: InvoiceMetadata | null | undefined) {
  return metadata?.provenance === "SIMULATED" && metadata.state === "ISSUED" && pdfState(metadata) !== "READY";
}

/**
 * The order's one invoice action. It opens the issued invoice (the PDF carries the academic-simulation notice) and
 * never shows how its files are produced: while the PDF is still being prepared it waits quietly and becomes
 * "Ver factura" on its own. Orders without an issued invoice show nothing; a historical invoice without a file is
 * named, without an action that could not work.
 */
export function InvoiceAction({ orderId, issued, className }: { orderId: string; issued: boolean; className?: string }) {
  const { clear } = useSession();
  const scope = useSessionOperationScope(`invoice:${orderId}`);
  const query = useQuery({
    queryKey: ["customer-invoice", orderId],
    queryFn: ({ signal }) => getInvoiceMetadata(orderId, signal),
    enabled: issued,
    meta: { authRequired: true },
    retry: false,
    refetchInterval: (current) => isPreparing(current.state.data) && current.state.dataUpdateCount < PREPARING_WAIT_MS / PREPARING_POLL_MS ? PREPARING_POLL_MS : false,
  });
  // When the first answer arrived: the quiet wait is bounded from there.
  const firstAnswerAt = useRef<number | null>(null);
  if (query.dataUpdatedAt && firstAnswerAt.current === null) firstAnswerAt.current = query.dataUpdatedAt;
  const [opening, setOpening] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const lock = useRef(false);
  useEffect(() => { if (query.error instanceof ApiRequestError && query.error.status === 401) clear("expired"); }, [query.error, clear]);

  if (!issued || (query.isSuccess && (!query.data || query.data.state !== "ISSUED"))) return null;
  const metadata = query.data;
  if (metadata?.provenance === "LEGACY" && pdfState(metadata) !== "READY") {
    return <p className={`${classes.legacy}${className ? ` ${className}` : ""}`}>Factura N.° {metadata.documentNumber}</p>;
  }
  const preparing = isPreparing(metadata) && query.dataUpdatedAt - (firstAnswerAt.current ?? query.dataUpdatedAt) < PREPARING_WAIT_MS;

  async function open() {
    if (lock.current || preparing || !scope.isCurrent()) return;
    lock.current = true; setOpening(true); setNotice(null);
    // Opened inside the press so no popup blocker stops it; the PDF arrives through the authenticated client.
    const tab = window.open("", "_blank");
    if (tab) { tab.opener = null; tab.document.title = "Factura · PLIEGO"; }
    try {
      scope.assertCurrent();
      const blob = await getInvoiceFile(orderId, "PDF", undefined, "inline");
      if (!scope.isCurrent()) { tab?.close(); return; }
      const url = URL.createObjectURL(blob);
      if (tab && !tab.closed) tab.location.href = url;
      else {
        // No new tab (blocked, or a browser that cannot show PDFs there): save it instead.
        const link = document.createElement("a");
        link.href = url; link.download = `factura-${orderId}.pdf`;
        document.body.append(link); link.click(); link.remove();
      }
      window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch (error) {
      tab?.close();
      if (!scope.isCurrent()) return;
      if (error instanceof ApiRequestError && error.status === 401) { clear("expired"); return; }
      setNotice(error instanceof ApiRequestError && error.code === "INVOICE_FILE_NOT_READY"
        ? "Tu factura aún se está preparando. Vuelve a intentarlo en unos minutos."
        : readRecoveryDetail(error));
      void query.refetch();
    } finally {
      lock.current = false;
      if (scope.isCurrent()) setOpening(false);
    }
  }

  return <div className={`${classes.action}${className ? ` ${className}` : ""}`}>
    <Button variant="secondary" type="button" className={classes.button} onClick={() => void open()}
      aria-disabled={preparing || opening || undefined} aria-busy={opening || undefined}>
      <MaterialSymbol name="receipt_long" size={20} aria-hidden="true" />
      <span>{preparing ? "Preparando factura…" : opening ? "Abriendo factura…" : "Ver factura"}</span>
    </Button>
    {notice && <p className={classes.notice} role="status">{notice}</p>}
  </div>;
}
