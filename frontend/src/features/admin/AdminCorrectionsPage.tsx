import { useEffect, useId, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { ApiRequestError } from "@/shared/api/errors";
import { ConfirmDialog } from "@/shared/ui/ConfirmDialog";
import { MaterialSymbol } from "@/shared/ui/MaterialSymbol";
import filterChips from "@/shared/ui/filterChips.module.css";
import { AdminPage } from "./AdminArea";
import {
  adminDateLabel, correctionReasonLabel, correctionStatusFilters, correctionStatusLabel, correctionUrgency, identityTypeLabel, type CorrectionStatus, isDomainError,
} from "./adminModels";
import { useAdminCorrections, useDecideCorrection, type AdminCorrection } from "./adminQueries";
import classes from "./admin.module.css";

const PAGE_SIZE = 10;

/**
 * Correcciones de identificación: the changes of cédula or RUC a customer cannot make alone (ADR 0043). Each request
 * reads as who asks, what changes (current → requested), why, and what it means for invoices already issued; the
 * decision is taken in a dialog. The database applies it: a pending-only transition, a conflict check against the
 * current identity, an audit event, and issued invoices that never change.
 */
export function AdminCorrectionsPage() {
  const [status, setStatus] = useState<CorrectionStatus>("PENDING");
  const [page, setPage] = useState(0);
  const [notice, setNotice] = useState<{ text: string; tone: "success" | "error" } | null>(null);
  const noticeRef = useRef<HTMLParagraphElement>(null);
  const requests = useAdminCorrections({ status, page, pageSize: PAGE_SIZE });
  const total = requests.data ? Number(requests.data.totalCount) : null;
  const pages = total ? Math.max(1, Math.ceil(total / PAGE_SIZE)) : 1;
  useEffect(() => { if (notice) noticeRef.current?.focus({ preventScroll: true }); }, [notice]);
  // A decided last request on a later page leaves it empty: step back to a page that exists.
  useEffect(() => { if (requests.data && requests.data.items.length === 0 && page > 0) setPage(page - 1); }, [requests.data, page]);

  return <AdminPage title="Correcciones de identificación" intro="Revisa los cambios de cédula o RUC que los clientes no pueden hacer por su cuenta.">
    {notice && <p ref={noticeRef} tabIndex={-1} className={classes.status} data-tone={notice.tone} role={notice.tone === "error" ? "alert" : "status"}>{notice.text}</p>}
    <div className={classes.toolbar}>
      <div className={filterChips.chips} role="group" aria-label="Estado de la solicitud">
        {correctionStatusFilters.map((filter) => <button key={filter.value} type="button" className={filterChips.chip}
          aria-pressed={status === filter.value} onClick={() => { setStatus(filter.value); setPage(0); setNotice(null); }}>{filter.label}</button>)}
      </div>
      {total !== null && <p className={classes.count} aria-live="polite">{total === 1 ? "1 solicitud" : `${total} solicitudes`}</p>}
    </div>
    {requests.isPending ? <p className={classes.count} role="status">Consultando solicitudes…</p>
      : requests.isError ? <p className={classes.status} data-tone="error" role="alert">No pudimos consultar las solicitudes. <Button type="button" variant="text" onClick={() => void requests.refetch()}>Reintentar</Button></p>
      : requests.data.items.length === 0 ? <div className={classes.empty}>
        <MaterialSymbol name="badge" size={28} aria-hidden="true" />
        <p>{status === "PENDING" ? "No hay solicitudes por revisar." : "No hay solicitudes en este estado."}</p>
      </div>
      : <>
        <ul className={classes.requests}>
          {requests.data.items.map((request) => <CorrectionRequest key={request.id} request={request} onDecided={setNotice} />)}
        </ul>
        {pages > 1 && <nav className={classes.pager} aria-label="Páginas de solicitudes">
          <Button type="button" variant="secondary" disabled={page === 0} onClick={() => setPage(page - 1)}>Anterior</Button>
          <span>Página {page + 1} de {pages}</span>
          <Button type="button" variant="secondary" disabled={page + 1 >= pages} onClick={() => setPage(page + 1)}>Siguiente</Button>
        </nav>}
      </>}
  </AdminPage>;
}

function identityValue(type: string | null | undefined, number: string | null | undefined) {
  return <><span>{identityTypeLabel(type)}</span><span className={classes.number}>{number ?? "—"}</span></>;
}

function decisionErrorText(error: unknown) {
  if (error instanceof ApiRequestError) {
    if (isDomainError(error, "BILLING_IDENTITY_CORRECTION_INVALID_TRANSITION")) return "Esta solicitud ya no está pendiente: otra persona la resolvió o el cliente la retiró.";
    if (isDomainError(error, "BILLING_IDENTITY_CONFLICT")) return "La identificación del cliente cambió desde que envió la solicitud. No se aplicó ningún cambio.";
    if (isDomainError(error, "BILLING_IDENTITY_CORRECTION_NOT_FOUND")) return "No encontramos esta solicitud.";
    if (error.status === 403) return "Tu cuenta no tiene permiso para resolver solicitudes.";
    if (error.detail) return error.detail;
  }
  return "No pudimos guardar la decisión. Revisa tu conexión e inténtalo otra vez.";
}

function CorrectionRequest({ request, onDecided }: { request: AdminCorrection; onDecided: (notice: { text: string; tone: "success" | "error" }) => void }) {
  const reasonId = useId();
  const [dialog, setDialog] = useState<"approve" | "reject" | null>(null);
  const [reason, setReason] = useState("");
  const [reasonError, setReasonError] = useState<string | null>(null);
  const reasonRef = useRef<HTMLTextAreaElement>(null);
  const approveRef = useRef<HTMLButtonElement>(null);
  const rejectRef = useRef<HTMLButtonElement>(null);
  const decide = useDecideCorrection();
  const name = request.customerName || "el cliente";
  const urgency = request.status === "PENDING" ? correctionUrgency(request.dueAt) : "normal";
  const headingId = `correction-${request.id}`;

  const close = () => {
    const returnTo = dialog === "reject" ? rejectRef : approveRef;
    setDialog(null); setReasonError(null);
    requestAnimationFrame(() => returnTo.current?.focus({ preventScroll: true }));
  };
  const submit = () => {
    const decision = dialog === "approve" ? "APPROVE" : "REJECT";
    const text = reason.trim();
    if (decision === "REJECT" && !text) { setReasonError("Escribe el motivo del rechazo."); reasonRef.current?.focus(); return; }
    decide.mutate({ id: request.id, decision, decisionReason: decision === "REJECT" ? text : null }, {
      onSuccess: () => {
        setDialog(null);
        onDecided({ tone: "success", text: decision === "APPROVE"
          ? `Aprobaste la corrección de ${name}. Su nueva identificación se usará en las próximas facturas.`
          : `Rechazaste la solicitud de ${name}. Verá el motivo en su perfil.` });
      },
      onError: (error) => { setDialog(null); onDecided({ tone: "error", text: decisionErrorText(error) }); },
    });
  };

  return <li className={classes.card} aria-labelledby={headingId}>
    <div className={classes.requestHead}>
      <div>
        <h3 id={headingId}>{request.customerName ?? "Cliente"}</h3>
        {request.customerEmail && <p>{request.customerEmail}</p>}
      </div>
      {request.status === "PENDING" ? <div className={classes.due}>
        {urgency !== "normal" && <span className={classes.stateChip} data-state={urgency}>{urgency === "overdue" ? "Plazo vencido" : "Vence pronto"}</span>}
        {adminDateLabel(request.dueAt) && <span>Responder antes del {adminDateLabel(request.dueAt)}</span>}
      </div> : <span className={classes.stateChip} data-state={request.status}>{correctionStatusLabel(request.status)}</span>}
    </div>

    <dl className={classes.change} aria-label="Cambio solicitado">
      <div><dt>Actual</dt><dd>{identityValue(request.currentType, request.currentNumber)}</dd></div>
      <MaterialSymbol name="arrow_forward" size={22} aria-hidden="true" />
      <div className={classes.proposed}><dt>Solicitada</dt><dd>{identityValue(request.proposedType, request.proposedNumber)}</dd></div>
    </dl>

    <dl className={classes.facts}>
      <div><dt>Motivo</dt><dd>{correctionReasonLabel(request.reasonCode)}</dd></div>
      {adminDateLabel(request.createdAt) && <div><dt>Enviada</dt><dd>{adminDateLabel(request.createdAt)}</dd></div>}
      {request.note && <div className={classes.wide}><dt>Nota del cliente</dt><dd className={classes.note}>«{request.note}»</dd></div>}
    </dl>

    {request.status === "PENDING" && <p className={classes.context}>
      <MaterialSymbol name="receipt_long" size={20} aria-hidden="true" />
      <span>{request.customerHasBilledInvoices
        ? "Ya tiene facturas emitidas con su identificación actual. Si apruebas, esas facturas no cambian: solo las nuevas usarán la identificación solicitada."
        : "Todavía no tiene facturas emitidas con su identificación actual."}</span>
    </p>}

    {request.status === "PENDING" ? <div className={classes.actions}>
      <Button ref={approveRef} type="button" variant="primary" onClick={() => setDialog("approve")}>Aprobar</Button>
      <Button ref={rejectRef} type="button" variant="secondary" onClick={() => { setReason(""); setDialog("reject"); }}>Rechazar</Button>
    </div> : <p className={classes.outcome} data-tone={request.status === "APPROVED" ? "success" : undefined}>
      <MaterialSymbol name={request.status === "APPROVED" ? "check_circle" : request.status === "REJECTED" ? "block" : "info"} size={20} aria-hidden="true" />
      <span>{request.status === "WITHDRAWN"
        ? `El cliente retiró la solicitud${adminDateLabel(request.decidedAt) ? ` el ${adminDateLabel(request.decidedAt)}` : ""}.`
        : `${request.status === "APPROVED" ? "Aprobada" : "Rechazada"}${adminDateLabel(request.decidedAt) ? ` el ${adminDateLabel(request.decidedAt)}` : ""}${request.decidedByEmail ? ` por ${request.decidedByEmail}` : ""}.`}
        {request.status === "REJECTED" && request.decisionReason ? ` Motivo: ${request.decisionReason}` : ""}</span>
    </p>}

    <ConfirmDialog opened={dialog === "approve"} title={`¿Aprobar la corrección de ${name}?`}
      confirmLabel="Aprobar corrección" busyLabel="Aprobando…" keepLabel="Volver" busy={decide.isPending} onConfirm={submit} onKeep={close}>
      <p className={classes.dialogText}>Su identificación de facturación pasará de {identityTypeLabel(request.currentType)} {request.currentNumber} a {identityTypeLabel(request.proposedType)} {request.proposedNumber}.</p>
      <p className={classes.dialogText}>Las facturas ya emitidas no cambian.</p>
    </ConfirmDialog>

    <ConfirmDialog opened={dialog === "reject"} destructive title={`¿Rechazar la solicitud de ${name}?`}
      confirmLabel="Rechazar solicitud" busyLabel="Rechazando…" keepLabel="Volver" busy={decide.isPending} onConfirm={submit} onKeep={close}>
      <p className={classes.dialogText}>Su identificación seguirá siendo {identityTypeLabel(request.currentType)} {request.currentNumber}.</p>
      <div className={classes.reasonField}>
        <label htmlFor={reasonId}>Motivo del rechazo</label>
        <textarea ref={reasonRef} id={reasonId} value={reason} maxLength={500} aria-invalid={reasonError ? true : undefined}
          aria-describedby={`${reasonId}-help${reasonError ? ` ${reasonId}-error` : ""}`}
          onChange={(event) => { setReason(event.target.value); if (reasonError) setReasonError(null); }} />
        <small id={`${reasonId}-help`}>El cliente lo verá en Mi perfil. Explica qué debe hacer, por ejemplo: «El RUC no corresponde a tu nombre».</small>
        {reasonError && <p id={`${reasonId}-error`} className={classes.fieldError} role="alert">{reasonError}</p>}
      </div>
    </ConfirmDialog>
  </li>;
}
