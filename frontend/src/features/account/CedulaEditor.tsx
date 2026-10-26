import { useEffect, useRef, useState } from "react";
import { ApiRequestError, fieldErrorMessages } from "@/shared/api/errors";
import { BillingIdentityOutcomeUnknown, correctBillingIdentity, registerBillingIdentity, requestBillingIdentityCorrection } from "@/shared/api/customer";
import { isSamePersonIdentification, type CorrectionReason, type StoredBillingIdentity } from "@/shared/api/billing";
import { useSessionOperationScope } from "@/app/sessionOperation";
import { identificationError, identificationType, normalizeIdentification, type IdentificationType } from "@/shared/validation/identification";
import { EcuadorianCedulaInput } from "@/shared/ui/EcuadorianCedulaInput";
import { IdentificationStatus, identificationInvalid } from "@/shared/ui/IdentificationStatus";
import { ConfirmDialog } from "@/shared/ui/ConfirmDialog";
import { FieldMessage } from "@/shared/ui/Field";
import { EditorFrame, type Result } from "./EditorFrame";
import { useProfileSaving } from "./profileDraft";
import classes from "./profile.module.css";

type Errors = { number?: string; reason?: string };
/** `review`: the number is already on an invoice, so the change goes to staff as a request (ADR 0043). */
type Pending = { type: IdentificationType; number: string; review: boolean };

export const identificationName = (type: IdentificationType) => type === "EC_RUC" ? "RUC" : "cédula";
const savedMessage = (type: IdentificationType) => type === "EC_RUC" ? "Guardamos tu RUC." : "Guardamos tu cédula.";
const correctedMessage = "Corregimos tu identificación. Tus facturas anteriores no cambian.";
const requestedMessage = "Enviamos tu solicitud. Te responderemos en un plazo de 15 días.";
const reasons: { value: CorrectionReason; label: string }[] = [
  { value: "DOCUMENT_TYPO", label: "Lo escribí mal" },
  { value: "DOCUMENT_CHANGED", label: "Ahora uso otro documento" },
];

/**
 * The cédula or RUC is required to buy and is not freely editable (ADR 0040, 0041, 0043). PLIEGO checks the
 * algorithm, never the owner, so a password would prove nothing about the new number and none is asked. While the
 * number is on no invoice it is corrected directly; once it is, only the same person's cédula ↔ RUC switch is
 * direct and any other change is sent to staff as a request. Every change is read back before it is sent, and
 * issued invoices never change.
 */
export function CedulaEditor({ customerId, identity, refetch, onExpired, onDone }: {
  customerId: string;
  identity: StoredBillingIdentity | null;
  refetch: () => Promise<{ data?: StoredBillingIdentity | null; isError: boolean }>;
  onExpired: () => void;
  onDone: (result?: Result) => void;
}) {
  const correcting = identity !== null;
  const scope = useSessionOperationScope(`${customerId}:cedula`);
  // The current number is the starting point: a typo is fixed in place, not retyped from nothing.
  const [value, setValue] = useState(identity?.number ?? "");
  const [reason, setReason] = useState<CorrectionReason | null>(null);
  const [errors, setErrors] = useState<Errors>({});
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<Pending | null>(null);
  /** Set when the server says the number is on an invoice although this view had not seen it yet. */
  const [serverReview, setServerReview] = useState(false);
  const attempt = useRef<{ payload: string; key: string } | null>(null);
  const numberRef = useRef<HTMLInputElement>(null);
  const reasonRef = useRef<HTMLInputElement>(null);
  const { saving, saved, run } = useProfileSaving(customerId, "cedula");
  useEffect(() => { numberRef.current?.focus(); numberRef.current?.select(); }, []);

  const typed = normalizeIdentification(value);
  const typedType = identificationType(typed);
  const reviewMode = correcting && (identity.correctionMode === "REQUEST" || serverReview);
  const samePerson = correcting && typedType !== null && isSamePersonIdentification(identity, { type: typedType, number: typed });
  const asksReason = reviewMode && !samePerson;

  function review() {
    setError(null);
    const next: Errors = {};
    next.number = identificationError(value) ?? undefined;
    if (!next.number && identity && typed === identity.number) next.number = "Ese ya es tu número. Escribe el correcto.";
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

  const save = (requested: Pending) => void run(async () => {
    const done = requested.review ? requestedMessage : correcting ? correctedMessage : savedMessage(requested.type);
    try {
      scope.assertCurrent();
      if (identity && requested.review) await requestBillingIdentityCorrection(identity.number, requested, reason!, attemptKey(requested, reason!));
      else if (identity) await correctBillingIdentity(identity.number, requested);
      else await registerBillingIdentity(requested);
      if (!scope.isCurrent()) return false;
      await refetch();
      if (!scope.isCurrent()) return false;
      setConfirming(null);
      onDone({ message: done, error: false });
      return true;
    } catch (failure) {
      if (!scope.isCurrent()) return false;
      if (failure instanceof ApiRequestError) {
        if (failure.status === 401) { setConfirming(null); onExpired(); return false; }
        if (failure.code === "P1107") {
          // Already on an invoice: the same confirmation becomes a request, after one choice of reason.
          setServerReview(true);
          setConfirming(null);
          setError("Esta identificación ya figura en una factura: revisaremos la corrección antes de aplicarla. Elige el motivo y vuelve a enviarla.");
          requestAnimationFrame(() => reasonRef.current?.focus());
          return false;
        }
        if (failure.code === "P1110") {
          setConfirming({ ...requested, review: false });
          return false;
        }
        setConfirming(null);
        if (failure.code === "P1108") {
          await refetch();
          if (!scope.isCurrent()) return false;
          onDone({ message: "Ya tienes una solicitud de corrección en revisión.", error: true });
          return false;
        }
        if (failure.code === "P1105") {
          await refetch();
          if (!scope.isCurrent()) return false;
          setError(correcting
            ? "Tu identificación cambió mientras editabas. Cancela y vuelve a abrir el campo para revisar la actual."
            : "Tu perfil ya tiene una cédula o RUC. Cancela para revisarlo y, si es incorrecto, usa Corregir.");
          return false;
        }
        const numberMessage = fieldErrorMessages(failure, "number");
        if (numberMessage) {
          setErrors({ number: numberMessage });
          numberRef.current?.focus();
          return false;
        }
        setError(`${failure.title}. ${failure.detail}`);
        return false;
      }
      if (failure instanceof BillingIdentityOutcomeUnknown) {
        setConfirming(null);
        // A lost reply is reconciled by reading the stored identification, never by sending the change again.
        const current = await refetch();
        if (!scope.isCurrent()) return false;
        const pending = current.data?.correctionRequest;
        const applied = requested.review
          ? pending?.status === "PENDING" && pending.proposedNumber === requested.number
          : current.data?.number === requested.number;
        if (!current.isError && applied) {
          onDone({ message: done, error: false });
          return true;
        }
        setError("No pudimos confirmar el cambio. Revisa tu identificación actual antes de intentarlo otra vez.");
        return false;
      }
      throw failure;
    }
  });

  const describedBy = ["profile-cedula-status", reviewMode ? "profile-cedula-review" : null].filter(Boolean).join(" ");
  return <>
    <EditorFrame label={correcting ? "Corregir cédula o RUC" : "Agregar cédula o RUC"} saving={saving} saved={saved} error={error}
      submit={{ idle: correcting ? "Corregir" : "Guardar", pending: "Guardando…", success: "Guardado" }}
      onCancel={() => onDone()} onSubmit={review}>
      <EcuadorianCedulaInput ref={numberRef} id="profile-cedula-input" className={classes.input} value={value}
        onInputRejected={rejection => setErrors(current => ({ ...current, number: rejection }))}
        aria-invalid={identificationInvalid(value, errors.number) || undefined} aria-describedby={describedBy}
        onChange={(event) => { setValue(event.target.value); setErrors(current => ({ ...current, number: undefined })); }}
        onBlur={(event) => { const next = event.currentTarget.value; setErrors(current => ({ ...current, number: identificationError(next) ?? undefined })); }} />
      <IdentificationStatus id="profile-cedula-status" value={value} error={errors.number} />
      {reviewMode && <p id="profile-cedula-review" className={classes.inlineNote}>
        {samePerson
          ? "Es la misma persona: el cambio se aplica de inmediato."
          : "Ya figura en una factura: revisaremos la corrección antes de aplicarla."}
      </p>}
      {asksReason && <fieldset className={classes.reasons} aria-describedby={errors.reason ? "profile-cedula-reason-error" : undefined}>
        <legend className={classes.subLabel}>Motivo</legend>
        <div className={classes.reasonOptions}>
          {reasons.map((option, index) => <label key={option.value} className={classes.reason}>
            <input ref={index === 0 ? reasonRef : undefined} type="radio" name="profile-cedula-reason" value={option.value}
              checked={reason === option.value} aria-invalid={Boolean(errors.reason) || undefined}
              onChange={() => { setReason(option.value); setErrors(current => ({ ...current, reason: undefined })); }} />
            {option.label}
          </label>)}
        </div>
        {errors.reason && <FieldMessage id="profile-cedula-reason-error" tone="error">{errors.reason}</FieldMessage>}
      </fieldset>}
    </EditorFrame>
    <ConfirmDialog opened={confirming !== null} readBack busy={saving} busyLabel={confirming?.review ? "Enviando…" : "Guardando…"}
      title={confirming?.review ? "¿Enviar la corrección?" : correcting ? "¿Corregir tu identificación?" : confirming?.type === "EC_RUC" ? "¿Es correcto tu RUC?" : "¿Es correcta tu cédula?"}
      confirmLabel={confirming?.review ? "Enviar solicitud" : correcting ? "Sí, corregir" : `Confirmar ${confirming ? identificationName(confirming.type) : "cédula"}`} keepLabel="Editar"
      onConfirm={() => { if (confirming) save(confirming); }} onKeep={keep}>
      <p className={classes.confirmNumber}>{confirming?.number}</p>
      <p>{confirming?.review
        ? "La revisaremos y te responderemos en un plazo de 15 días. Hasta entonces tus compras usan la identificación actual; las facturas emitidas no cambian."
        : correcting
          ? `Las facturas nuevas usarán este ${confirming?.type === "EC_RUC" ? "RUC" : "número de cédula"}. Las anteriores conservan la identificación con la que se emitieron.`
          : "La usaremos por defecto para tus facturas."}</p>
    </ConfirmDialog>
  </>;
}
