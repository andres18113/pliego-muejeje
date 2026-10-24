import { useEffect, useId, useRef, useState } from "react";
import { ApiRequestError, fieldErrorMessages } from "@/shared/api/errors";
import { BillingIdentityOutcomeUnknown, correctBillingIdentity, registerBillingIdentity } from "@/shared/api/customer";
import type { BillingIdentity } from "@/shared/api/billing";
import { useSessionOperationScope } from "@/app/sessionOperation";
import { identificationError, identificationType, normalizeIdentification, type IdentificationType } from "@/shared/validation/identification";
import { EcuadorianCedulaInput } from "@/shared/ui/EcuadorianCedulaInput";
import { IdentificationStatus, identificationInvalid } from "@/shared/ui/IdentificationStatus";
import { ConfirmDialog } from "@/shared/ui/ConfirmDialog";
import { FieldMessage } from "@/shared/ui/Field";
import { PasswordInput } from "@/shared/ui/PasswordInput";
import { EditorFrame, type Result } from "./EditorFrame";
import { useProfileSaving } from "./profileDraft";
import classes from "./profile.module.css";

type Errors = { number?: string; password?: string };
type Pending = { type: IdentificationType; number: string };

export const identificationName = (type: IdentificationType) => type === "EC_RUC" ? "RUC" : "cédula";
const savedMessage = (type: IdentificationType) => type === "EC_RUC" ? "Guardamos tu RUC." : "Guardamos tu cédula.";
const correctedMessage = "Corregimos tu identificación. Tus facturas anteriores no cambian.";

/**
 * The cédula or RUC is required to buy and is not freely editable (ADR 0040, 0041). Each digit is judged while
 * the customer types; PLIEGO checks the algorithm, never the owner, so a typo can still pass: the number is
 * read back for confirmation before it is stored, and a later correction asks for the current password.
 * Earlier invoices never change.
 */
export function CedulaEditor({ customerId, identity, refetch, onExpired, onDone }: {
  customerId: string;
  identity: BillingIdentity | null;
  refetch: () => Promise<{ data?: BillingIdentity | null; isError: boolean }>;
  onExpired: () => void;
  onDone: (result?: Result) => void;
}) {
  const correcting = identity !== null;
  const scope = useSessionOperationScope(`${customerId}:cedula`);
  const passwordId = useId();
  const [value, setValue] = useState("");
  const [password, setPassword] = useState("");
  const [errors, setErrors] = useState<Errors>({});
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<Pending | null>(null);
  const numberRef = useRef<HTMLInputElement>(null);
  const passwordRef = useRef<HTMLInputElement>(null);
  const { saving, saved, run } = useProfileSaving(customerId, "cedula");
  useEffect(() => { numberRef.current?.focus(); }, []);

  function review() {
    setError(null);
    const next: Errors = {};
    const number = normalizeIdentification(value);
    next.number = identificationError(value) ?? undefined;
    if (!next.number && identity && number === identity.number) next.number = "Ese ya es tu número. Escribe el correcto.";
    if (correcting && !password) next.password = "Escribe tu contraseña actual para confirmar la corrección.";
    setErrors(next);
    if (next.number || next.password) { (next.number ? numberRef : passwordRef).current?.focus(); return; }
    setConfirming({ type: identificationType(number)!, number });
  }

  function keep() {
    setConfirming(null);
    requestAnimationFrame(() => numberRef.current?.focus());
  }

  const save = (requested: Pending) => void run(async () => {
    const submittedPassword = password;
    const done = correcting ? correctedMessage : savedMessage(requested.type);
    try {
      scope.assertCurrent();
      if (identity) await correctBillingIdentity(identity.number, requested, submittedPassword);
      else await registerBillingIdentity(requested);
      if (!scope.isCurrent()) return false;
      await refetch();
      if (!scope.isCurrent()) return false;
      setConfirming(null);
      onDone({ message: done, error: false });
      return true;
    } catch (failure) {
      if (!scope.isCurrent()) return false;
      setConfirming(null);
      if (failure instanceof ApiRequestError) {
        if (failure.status === 401) { onExpired(); return false; }
        if (failure.code === "CURRENT_PASSWORD_INVALID") {
          setErrors({ password: "La contraseña actual no es correcta." });
          setPassword("");
          passwordRef.current?.focus();
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
        const numberMessage = fieldErrorMessages(failure, "number"), passwordMessage = fieldErrorMessages(failure, "currentPassword");
        if (numberMessage || passwordMessage) {
          setErrors({ number: numberMessage, password: passwordMessage });
          (numberMessage ? numberRef : passwordRef).current?.focus();
          return false;
        }
        setError(`${failure.title}. ${failure.detail}`);
        return false;
      }
      if (failure instanceof BillingIdentityOutcomeUnknown) {
        // A lost reply is reconciled by reading the stored identification, never by sending the change again.
        const current = await refetch();
        if (!scope.isCurrent()) return false;
        if (!current.isError && current.data?.number === requested.number) {
          onDone({ message: done, error: false });
          return true;
        }
        setError("No pudimos confirmar el cambio. Revisa tu identificación actual antes de intentarlo otra vez.");
        return false;
      }
      throw failure;
    }
  });

  return <>
    <EditorFrame label={correcting ? "Corregir cédula o RUC" : "Agregar cédula o RUC"} saving={saving} saved={saved} error={error}
      submit={{ idle: correcting ? "Corregir" : "Guardar", pending: "Guardando…", success: "Guardado" }}
      onCancel={() => onDone()} onSubmit={review}>
      <EcuadorianCedulaInput ref={numberRef} id="profile-cedula-input" className={classes.input} value={value}
        onInputRejected={reason => setErrors(current => ({ ...current, number: reason }))}
        aria-invalid={identificationInvalid(value, errors.number) || undefined} aria-describedby="profile-cedula-status"
        onChange={(event) => { setValue(event.target.value); setErrors(current => ({ ...current, number: undefined })); }}
        onBlur={(event) => { const next = event.currentTarget.value; setErrors(current => ({ ...current, number: identificationError(next) ?? undefined })); }} />
      <IdentificationStatus id="profile-cedula-status" value={value} error={errors.number} />
      {correcting && <>
        <label className={classes.subLabel} htmlFor={passwordId}>Contraseña actual</label>
        <PasswordInput ref={passwordRef} id={passwordId} className={classes.input} autoComplete="current-password" value={password}
          aria-invalid={Boolean(errors.password) || undefined} aria-describedby={errors.password ? `${passwordId}-error` : undefined}
          onChange={(event) => { setPassword(event.target.value); setErrors(current => ({ ...current, password: undefined })); }} />
        {errors.password && <FieldMessage id={`${passwordId}-error`} tone="error">{errors.password}</FieldMessage>}
        <details className={classes.securityDisclosure}>
          <summary>Por qué pedimos tu contraseña</summary>
          <p>Comprobamos el algoritmo de la cédula o el RUC, no a quién pertenece. Por eso una corrección pide tu contraseña y queda registrada. Tus facturas anteriores no cambian.</p>
        </details>
      </>}
    </EditorFrame>
    <ConfirmDialog opened={confirming !== null} busy={saving} busyLabel="Guardando…"
      title={correcting ? "¿Corregir tu identificación?" : confirming?.type === "EC_RUC" ? "¿Es correcto tu RUC?" : "¿Es correcta tu cédula?"}
      confirmLabel={correcting ? "Sí, corregir" : `Guardar ${confirming ? identificationName(confirming.type) : "cédula"}`} keepLabel="Revisar"
      onConfirm={() => { if (confirming) save(confirming); }} onKeep={keep}>
      <p className={classes.confirmNumber}>{confirming?.number}</p>
      <p>{correcting
        ? `Las facturas nuevas usarán este ${confirming?.type === "EC_RUC" ? "RUC" : "número de cédula"}. Las anteriores conservan la identificación con la que se emitieron.`
        : "La usaremos en tus facturas. Si después encuentras un error, podrás corregirla con tu contraseña."}</p>
    </ConfirmDialog>
  </>;
}
