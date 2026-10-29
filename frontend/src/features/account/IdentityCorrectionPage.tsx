import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { Button, ButtonLink } from "@/components/ui/button";
import { useSession } from "@/app/session";
import { useSessionOperationScope } from "@/app/sessionOperation";
import { ApiRequestError, fieldErrorMessages } from "@/shared/api/errors";
import { billingIdentityQueryKey, BillingIdentityOutcomeUnknown, correctBillingIdentity, getBillingIdentity, requestBillingIdentityCorrection, withdrawBillingIdentityCorrection } from "@/shared/api/customer";
import { isSamePersonIdentification, type BillingIdentityCorrectionRequest, type CorrectionReason, type StoredBillingIdentity } from "@/shared/api/billing";
import { identificationError, identificationType, normalizeIdentification, type IdentificationType } from "@/shared/validation/identification";
import { orderShortDateLabel } from "@/features/purchase/purchaseText";
import { ReadFailure } from "@/features/purchase/CartPage";
import { CustomerOnly, PurchasePage } from "@/features/purchase/PurchaseChrome";
import { EcuadorianCedulaInput } from "@/shared/ui/EcuadorianCedulaInput";
import { IdentificationStatus, identificationInvalid } from "@/shared/ui/IdentificationStatus";
import { ConfirmDialog } from "@/shared/ui/ConfirmDialog";
import { FieldMessage } from "@/shared/ui/Field";
import { MaterialSymbol } from "@/shared/ui/MaterialSymbol";
import { ParentLink } from "@/shared/ui/ParentLink";
import { TransactionButtonLabel } from "@/shared/ui/TransactionButtonLabel";
import { AccountShell } from "./AccountShell";
import type { Result } from "./EditorFrame";
import profile from "./profile.module.css";
import classes from "./identityCorrection.module.css";

export const identityCorrectionPath = "/account/identity";
/** Read by Mi perfil after a direct correction sends the customer back to it. */
export type IdentityCorrectionState = { identityFeedback?: string };

type Notice = Result;
type Refetch = () => Promise<{ data?: StoredBillingIdentity | null; isError: boolean }>;
/** `review`: the number is already on an invoice, so the change goes to staff as a request (ADR 0043). */
type Pending = { type: IdentificationType; number: string; review: boolean };

const typeName = (type: IdentificationType) => type === "EC_RUC" ? "RUC" : "Cédula";
const correctedMessage = "Corregimos tu identificación. Tus facturas anteriores no cambian.";
const requestedMessage = "Enviamos tu solicitud. Te responderemos en un plazo de 15 días.";
const reasons: { value: CorrectionReason; label: string }[] = [
  { value: "DOCUMENT_TYPO", label: "Lo escribí mal" },
  { value: "DOCUMENT_CHANGED", label: "Ahora uso otro documento" },
];
const reasonLabel = (reason: CorrectionReason) => reasons.find(option => option.value === reason)?.label ?? "Otro motivo";

export function IdentityCorrectionPage() {
  return <PurchasePage title="Cédula o RUC"><CustomerOnly intent={identityCorrectionPath} task="corregir tu cédula o RUC"><IdentityCorrection /></CustomerOnly></PurchasePage>;
}

/**
 * Correcting the cédula or RUC is its own process, not profile editing (ADR 0040, 0041, 0043): the page shows the
 * identification in use, then exactly one next step — the correction form, which says before anything is typed
 * whether the change applies at once or goes to review, or the request in review with its one action, withdrawing
 * it, which asks first. Issued invoices never change; the server decides and audits every step.
 */
function IdentityCorrection() {
  const { clear } = useSession();
  const navigate = useNavigate();
  const query = useQuery({ queryKey: billingIdentityQueryKey, queryFn: ({ signal }) => getBillingIdentity(signal), meta: { authRequired: true }, refetchOnMount: "always", retry: false });
  const noticeRef = useRef<HTMLParagraphElement>(null);
  const [notice, setNotice] = useState<Notice | null>(null);
  const onExpired = () => clear("expired");

  useEffect(() => {
    if (query.error instanceof ApiRequestError && query.error.status === 401) clear("expired");
  }, [clear, query.error]);
  useEffect(() => { if (notice) noticeRef.current?.focus({ preventScroll: true }); }, [notice]);

  const identity = query.data;
  const request = identity?.correctionRequest ?? null;
  const pending = request?.status === "PENDING" ? request : null;
  const refetch: Refetch = () => query.refetch();

  return <AccountShell title="Cédula o RUC" before={<ParentLink to="/account">Volver a Mi perfil</ParentLink>}
    intro="La identificación con la que emitimos tus facturas.">
    {query.isPending ? <p className="purchase-loading" role="status">Consultando tu identificación…</p>
      : identity === undefined ? <ReadFailure error={query.error} title="No pudimos consultar tu identificación." onRetry={() => void query.refetch()} retrying={query.isFetching} />
        : identity === null ? <section className={classes.column} aria-labelledby="identity-missing-heading">
          <div className={classes.panel}>
            <h2 id="identity-missing-heading" className={classes.panelTitle}>Todavía no registraste tu cédula o RUC</h2>
            <p className={classes.lead}>La necesitas para comprar. Agrégala en Mi perfil; la confirmaremos contigo antes de guardarla.</p>
            <div className={classes.actions}><ButtonLink variant="primary" to="/account">Ir a Mi perfil</ButtonLink></div>
          </div>
        </section>
          : <div className={classes.column}>
            <CurrentIdentity identity={identity} request={pending ? null : request} />
            {notice && <p ref={noticeRef} tabIndex={-1} className={`${classes.notice} ${notice.error ? classes.noticeError : ""}`} role={notice.error ? "alert" : "status"}>
              <MaterialSymbol name={notice.error ? "info" : "check_circle"} aria-hidden="true" size={18} />{notice.message}
            </p>}
            {pending
              ? <PendingRequest identity={identity} request={pending} refetch={refetch} onExpired={onExpired} onNotice={setNotice} />
              : <CorrectionForm key={identity.number} identity={identity} refetch={refetch} onExpired={onExpired} onNotice={setNotice}
                onCorrected={() => navigate("/account", { state: { identityFeedback: correctedMessage } satisfies IdentityCorrectionState })} />}
          </div>}
  </AccountShell>;
}

/** The identification in use, large enough to compare digit by digit, and a recent decision on the last request. */
function CurrentIdentity({ identity, request }: { identity: StoredBillingIdentity; request: BillingIdentityCorrectionRequest | null }) {
  return <section className={classes.current} aria-labelledby="identity-current-heading">
    <h2 id="identity-current-heading" className={classes.eyebrow}>{typeName(identity.type)} en uso</h2>
    <p className={classes.number}>{identity.number}</p>
    <p className={classes.meta}>Tus compras y facturas nuevas usan este número.</p>
    {request?.status === "APPROVED" && <p className={classes.history}>
      <MaterialSymbol name="check_circle" aria-hidden="true" size={16} />
      <span>Aplicamos la corrección que pediste el {orderShortDateLabel(request.createdAt)}.</span>
    </p>}
    {request?.status === "REJECTED" && <p className={classes.history}>
      <MaterialSymbol name="info" aria-hidden="true" size={16} />
      <span>No aplicamos tu solicitud del {orderShortDateLabel(request.createdAt)} para cambiarla a <span className={classes.inlineNumber}>{request.proposedNumber}</span>{request.decisionReason ? `: ${request.decisionReason}` : "."}</span>
    </p>}
  </section>;
}

/** A request in review: what was asked, until when, and the one action — withdrawing it, confirmed first. */
function PendingRequest({ identity, request, refetch, onExpired, onNotice }: {
  identity: StoredBillingIdentity; request: BillingIdentityCorrectionRequest; refetch: Refetch; onExpired: () => void; onNotice: (notice: Notice | null) => void;
}) {
  const scope = useSessionOperationScope(`identity-request:${request.id}`);
  const [confirming, setConfirming] = useState(false);
  const [withdrawing, setWithdrawing] = useState(false);
  const withdrawRef = useRef<HTMLButtonElement>(null);
  const kept = `Tu identificación sigue siendo ${identity.number}.`;

  function keep() {
    setConfirming(false);
    requestAnimationFrame(() => withdrawRef.current?.focus({ preventScroll: true }));
  }

  /** A refused or lost reply is answered by the stored state: withdrawn, decided meanwhile, or still in review. */
  async function settle(fallback: string) {
    const current = await refetch();
    if (!scope.isCurrent()) return;
    setConfirming(false);
    const now = current.data?.correctionRequest;
    if (!current.isError && now?.id === request.id && now.status === "WITHDRAWN") onNotice({ message: `Retiraste la solicitud. ${kept}`, error: false });
    else if (!current.isError && now?.id === request.id && now.status !== "PENDING") onNotice({ message: "Ya revisamos tu solicitud, así que no se puede retirar. Te mostramos el resultado.", error: true });
    else { onNotice({ message: fallback, error: true }); requestAnimationFrame(() => withdrawRef.current?.focus({ preventScroll: true })); }
  }

  async function withdraw() {
    onNotice(null);
    setWithdrawing(true);
    try {
      scope.assertCurrent();
      await withdrawBillingIdentityCorrection(request.id);
      if (!scope.isCurrent()) return;
      await refetch();
      if (!scope.isCurrent()) return;
      setConfirming(false);
      onNotice({ message: `Retiraste la solicitud. ${kept}`, error: false });
    } catch (failure) {
      if (!scope.isCurrent()) return;
      if (failure instanceof ApiRequestError && failure.status === 401) { setConfirming(false); onExpired(); return; }
      if (failure instanceof ApiRequestError && failure.code !== "P1109" && failure.code !== "P1111") {
        await settle(`${failure.title}. ${failure.detail}`);
        return;
      }
      await settle("No pudimos confirmar si se retiró. Sigue en revisión; vuelve a intentarlo.");
    } finally {
      if (scope.isCurrent()) setWithdrawing(false);
    }
  }

  return <section className={classes.panel} aria-labelledby="identity-request-heading">
    <div className={classes.panelHead}>
      <h2 id="identity-request-heading" className={classes.panelTitle}>Solicitud de corrección</h2>
      <span className={profile.missingChip} data-tone="review">En revisión</span>
    </div>
    {/* Scanned top-down: what was asked (as large as the number in use above), when we answer, then the record.
        That purchases keep the current number is already said under it, so only the invoices line remains. */}
    <dl className={classes.facts}>
      <div className={classes.requested}><dt>{request.proposedType === "EC_RUC" ? "RUC solicitado" : "Cédula solicitada"}</dt><dd>{request.proposedNumber}</dd></div>
      <div className={classes.deadline}><dt>Respuesta antes del</dt><dd>{orderShortDateLabel(request.dueAt)}</dd></div>
      <div><dt>Motivo</dt><dd>{reasonLabel(request.reasonCode)}</dd></div>
      <div><dt>Enviada el</dt><dd>{orderShortDateLabel(request.createdAt)}</dd></div>
    </dl>
    <div className={classes.withdraw}>
      <p className={classes.lead}>Las facturas ya emitidas no cambian.</p>
      <Button ref={withdrawRef} variant="secondary" type="button" className={classes.secondary} onClick={() => { onNotice(null); setConfirming(true); }}>Retirar solicitud</Button>
    </div>
    <ConfirmDialog opened={confirming} destructive busy={withdrawing} busyLabel="Retirando…"
      title="¿Retirar tu solicitud de corrección?" confirmLabel="Retirar solicitud" keepLabel="Conservar solicitud"
      onConfirm={() => void withdraw()} onKeep={keep}>
      <p>Cancelaremos la revisión. {identity.type === "EC_RUC" ? "Tu RUC actual no cambiará" : "Tu cédula actual no cambiará"} y podrás enviar otra solicitud después.</p>
    </ConfirmDialog>
  </section>;
}

/**
 * The correction itself. Before anything is typed it says what will happen: applied at once while the number is
 * on no invoice; reviewed by staff once it is, except the same person's cédula ↔ RUC switch. Every change is read
 * back before it is sent. A password is not asked: it would prove the session, not the number.
 */
function CorrectionForm({ identity, refetch, onExpired, onNotice, onCorrected }: {
  identity: StoredBillingIdentity; refetch: Refetch; onExpired: () => void; onNotice: (notice: Notice | null) => void; onCorrected: () => void;
}) {
  const scope = useSessionOperationScope(`identity-correction:${identity.number}`);
  // The current number is the starting point: a typo is fixed in place, not retyped from nothing.
  const [value, setValue] = useState(identity.number);
  const [reason, setReason] = useState<CorrectionReason | null>(null);
  const [errors, setErrors] = useState<{ number?: string; reason?: string }>({});
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<Pending | null>(null);
  const [saving, setSaving] = useState(false);
  /** Set when the server says the number is on an invoice although this view had not seen it yet. */
  const [serverReview, setServerReview] = useState(false);
  const attempt = useRef<{ payload: string; key: string } | null>(null);
  const numberRef = useRef<HTMLInputElement>(null);
  const reasonRef = useRef<HTMLInputElement>(null);

  const typed = normalizeIdentification(value);
  const typedType = identificationType(typed);
  const reviewMode = identity.correctionMode === "REQUEST" || serverReview;
  const samePerson = typedType !== null && isSamePersonIdentification(identity, { type: typedType, number: typed });
  const asksReason = reviewMode && !samePerson;

  function review() {
    setError(null);
    onNotice(null);
    const next: { number?: string; reason?: string } = {};
    next.number = identificationError(value) ?? undefined;
    if (!next.number && typed === identity.number) next.number = "Ese ya es tu número. Escribe el correcto.";
    if (!next.number && asksReason && !reason) next.reason = "Elige qué pasó con el número.";
    setErrors(next);
    if (next.number || next.reason) { (next.number ? numberRef : reasonRef).current?.focus(); return; }
    setConfirming({ type: typedType!, number: typed, review: asksReason });
  }

  function keep() {
    setConfirming(null);
    requestAnimationFrame(() => numberRef.current?.focus());
  }

  /** One key per attempted change: resending the same change after a lost reply returns the original request. */
  function attemptKey(requested: Pending, motive: CorrectionReason) {
    const payload = `${requested.type}:${requested.number}:${motive}`;
    if (attempt.current?.payload !== payload) attempt.current = { payload, key: crypto.randomUUID() };
    return attempt.current.key;
  }

  function finished(requested: Pending) {
    setConfirming(null);
    if (requested.review) onNotice({ message: requestedMessage, error: false });
    else onCorrected();
  }

  async function save(requested: Pending) {
    if (saving) return;
    setSaving(true);
    try {
      scope.assertCurrent();
      if (requested.review) await requestBillingIdentityCorrection(identity.number, requested, reason!, attemptKey(requested, reason!));
      else await correctBillingIdentity(identity.number, requested);
      if (!scope.isCurrent()) return;
      await refetch();
      if (!scope.isCurrent()) return;
      finished(requested);
    } catch (failure) {
      if (!scope.isCurrent()) return;
      if (failure instanceof ApiRequestError) {
        if (failure.status === 401) { setConfirming(null); onExpired(); return; }
        if (failure.code === "P1107") {
          // Already on an invoice: the same correction becomes a request, after one choice of reason.
          setServerReview(true);
          setConfirming(null);
          setError("Esta identificación ya figura en una factura: revisaremos la corrección antes de aplicarla. Elige el motivo y vuelve a enviarla.");
          requestAnimationFrame(() => reasonRef.current?.focus());
          return;
        }
        if (failure.code === "P1110") { setConfirming({ ...requested, review: false }); return; }
        setConfirming(null);
        if (failure.code === "P1108") {
          // A request is already in review: the page turns to it.
          onNotice({ message: "Ya tienes una solicitud de corrección en revisión.", error: true });
          await refetch();
          return;
        }
        if (failure.code === "P1105") {
          onNotice({ message: "Tu identificación cambió mientras la corregías. Revisa la actual antes de intentarlo otra vez.", error: true });
          await refetch();
          return;
        }
        const numberMessage = fieldErrorMessages(failure, "number");
        if (numberMessage) { setErrors({ number: numberMessage }); numberRef.current?.focus(); return; }
        setError(`${failure.title}. ${failure.detail}`);
        return;
      }
      if (failure instanceof BillingIdentityOutcomeUnknown) {
        setConfirming(null);
        // A lost reply is reconciled by reading the stored identification, never by sending the change again.
        const current = await refetch();
        if (!scope.isCurrent()) return;
        const asked = current.data?.correctionRequest;
        const applied = requested.review
          ? asked?.status === "PENDING" && asked.proposedNumber === requested.number
          : current.data?.number === requested.number;
        if (!current.isError && applied) { finished(requested); return; }
        setError("No pudimos confirmar el cambio. Revisa tu identificación actual antes de intentarlo otra vez.");
        return;
      }
      throw failure;
    } finally {
      if (scope.isCurrent()) setSaving(false);
    }
  }

  const describedBy = ["identity-correction-mode", "identity-number-status", reviewMode && samePerson ? "identity-number-same" : null].filter(Boolean).join(" ");
  return <section className={classes.panel} aria-labelledby="identity-correction-heading">
    <h2 id="identity-correction-heading" className={classes.panelTitle}>Corregir identificación</h2>
    <p id="identity-correction-mode" className={classes.lead}>{reviewMode
      ? "Ya figura en una factura: revisaremos la corrección y te responderemos en un plazo de 15 días. Hasta entonces usamos la actual."
      : "Todavía no figura en ninguna factura: la corrección se aplica en cuanto la confirmes."}</p>
    <form className={classes.form} noValidate aria-labelledby="identity-correction-heading"
      onSubmit={(event) => { event.preventDefault(); if (!saving) review(); }}>
      <div className={classes.field}>
        <label htmlFor="identity-number" className={classes.label}>Número correcto</label>
        <EcuadorianCedulaInput ref={numberRef} id="identity-number" className={classes.input} value={value}
          onInputRejected={rejection => setErrors(current => ({ ...current, number: rejection }))}
          aria-invalid={identificationInvalid(value, errors.number) || undefined} aria-describedby={describedBy}
          onChange={(event) => { setValue(event.target.value); setErrors(current => ({ ...current, number: undefined })); }}
          onBlur={(event) => { const next = event.currentTarget.value; setErrors(current => ({ ...current, number: identificationError(next) ?? undefined })); }} />
        <IdentificationStatus id="identity-number-status" value={value} error={errors.number} />
        {reviewMode && samePerson && <p id="identity-number-same" className={classes.help}>Es tu misma persona (cédula ↔ RUC): este cambio se aplica de inmediato, sin revisión.</p>}
      </div>
      {asksReason && <fieldset className={classes.reasons} aria-describedby={errors.reason ? "identity-reason-error" : undefined}>
        <legend className={classes.label}>¿Qué pasó con el número?</legend>
        {reasons.map((option, index) => <label key={option.value} className={classes.reason}>
          <input ref={index === 0 ? reasonRef : undefined} type="radio" name="identity-reason" value={option.value}
            checked={reason === option.value} aria-invalid={Boolean(errors.reason) || undefined}
            onChange={() => { setReason(option.value); setErrors(current => ({ ...current, reason: undefined })); }} />
          {option.label}
        </label>)}
        {errors.reason && <FieldMessage id="identity-reason-error" tone="error">{errors.reason}</FieldMessage>}
      </fieldset>}
      {error && <p className={`${classes.notice} ${classes.noticeError}`} role="alert"><MaterialSymbol name="info" aria-hidden="true" size={18} />{error}</p>}
      <div className={classes.actions}>
        <Button variant="primary" type="submit" className={classes.primary} aria-disabled={saving || undefined} aria-busy={saving || undefined}>
          <TransactionButtonLabel state={saving ? "pending" : "idle"} idle={asksReason ? "Enviar solicitud" : "Corregir"} pending={asksReason ? "Enviando…" : "Guardando…"} success="" reserve={asksReason ? "Enviar solicitud" : "Guardando…"} />
        </Button>
        <ButtonLink variant="text" to="/account" className={classes.cancel}>Cancelar</ButtonLink>
      </div>
    </form>
    <ConfirmDialog opened={confirming !== null} readBack busy={saving} busyLabel={confirming?.review ? "Enviando…" : "Guardando…"}
      title={confirming?.review ? "¿Enviar la corrección?" : "¿Corregir tu identificación?"}
      confirmLabel={confirming?.review ? "Enviar solicitud" : "Sí, corregir"} keepLabel="Editar"
      onConfirm={() => { if (confirming) void save(confirming); }} onKeep={keep}>
      <p className={profile.confirmNumber}>{confirming?.number}</p>
      <p>{confirming?.review
        ? "La revisaremos y te responderemos en un plazo de 15 días. Hasta entonces tus compras usan la identificación actual; las facturas emitidas no cambian."
        : `Las facturas nuevas usarán este ${confirming?.type === "EC_RUC" ? "RUC" : "número de cédula"}. Las anteriores conservan la identificación con la que se emitieron.`}</p>
    </ConfirmDialog>
  </section>;
}
