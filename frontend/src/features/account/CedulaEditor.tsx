import { useEffect, useState, useRef } from "react";
import { ApiRequestError, fieldErrorMessages } from "@/shared/api/errors";
import { BillingIdentityOutcomeUnknown, registerBillingIdentity } from "@/shared/api/customer";
import type { StoredBillingIdentity } from "@/shared/api/billing";
import { useSessionOperationScope } from "@/app/sessionOperation";
import { identificationError, identificationType, normalizeIdentification, type IdentificationType } from "@/shared/validation/identification";
import { EcuadorianCedulaInput } from "@/shared/ui/EcuadorianCedulaInput";
import { IdentificationStatus, identificationInvalid } from "@/shared/ui/IdentificationStatus";
import { ConfirmDialog } from "@/shared/ui/ConfirmDialog";
import { EditorFrame, type Result } from "./EditorFrame";
import { useProfileSaving } from "./profileDraft";
import classes from "./profile.module.css";

type Pending = { type: IdentificationType; number: string };

export const identificationName = (type: IdentificationType) => type === "EC_RUC" ? "RUC" : "cédula";
const savedMessage = (type: IdentificationType) => type === "EC_RUC" ? "Guardamos tu RUC." : "Guardamos tu cédula.";

/**
 * Adding the cédula or RUC the account needs to buy (ADR 0040, 0041), inline in Mi perfil like any missing value.
 * PLIEGO checks the algorithm, never the owner, so no password is asked; the number is read back before it is
 * stored. Correcting a stored number is a separate process with its own page (`IdentityCorrectionPage`).
 */
export function CedulaEditor({ customerId, refetch, onExpired, onDone }: {
  customerId: string;
  refetch: () => Promise<{ data?: StoredBillingIdentity | null; isError: boolean }>;
  onExpired: () => void;
  onDone: (result?: Result) => void;
}) {
  const scope = useSessionOperationScope(`${customerId}:cedula`);
  const [value, setValue] = useState("");
  const [fieldError, setFieldError] = useState<string | undefined>();
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<Pending | null>(null);
  const numberRef = useRef<HTMLInputElement>(null);
  const { saving, saved, run } = useProfileSaving(customerId, "cedula");
  useEffect(() => { numberRef.current?.focus(); }, []);

  const typed = normalizeIdentification(value);

  function review() {
    setError(null);
    const message = identificationError(value) ?? undefined;
    setFieldError(message);
    if (message) { numberRef.current?.focus(); return; }
    setConfirming({ type: identificationType(typed)!, number: typed });
  }

  function keep() {
    setConfirming(null);
    requestAnimationFrame(() => numberRef.current?.focus());
  }

  const save = (requested: Pending) => void run(async () => {
    const done = savedMessage(requested.type);
    try {
      scope.assertCurrent();
      await registerBillingIdentity(requested);
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
        setConfirming(null);
        if (failure.code === "P1105") {
          // Another session stored one meanwhile: the row shows it, with Corregir if it is not right.
          await refetch();
          if (!scope.isCurrent()) return false;
          onDone({ message: "Tu perfil ya tiene una cédula o RUC. Revísala y, si no es correcta, usa Corregir.", error: true });
          return false;
        }
        const numberMessage = fieldErrorMessages(failure, "number");
        if (numberMessage) {
          setFieldError(numberMessage);
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
    <EditorFrame label="Agregar cédula o RUC" saving={saving} saved={saved} error={error}
      onCancel={() => onDone()} onSubmit={review}>
      <EcuadorianCedulaInput ref={numberRef} id="profile-cedula-input" className={classes.input} value={value}
        onInputRejected={rejection => setFieldError(rejection)}
        aria-invalid={identificationInvalid(value, fieldError) || undefined} aria-describedby="profile-cedula-status"
        onChange={(event) => { setValue(event.target.value); setFieldError(undefined); }}
        onBlur={(event) => setFieldError(identificationError(event.currentTarget.value) ?? undefined)} />
      <IdentificationStatus id="profile-cedula-status" value={value} error={fieldError} />
    </EditorFrame>
    <ConfirmDialog opened={confirming !== null} readBack busy={saving} busyLabel="Guardando…"
      title={confirming?.type === "EC_RUC" ? "¿Es correcto tu RUC?" : "¿Es correcta tu cédula?"}
      confirmLabel={`Confirmar ${confirming ? identificationName(confirming.type) : "cédula"}`} keepLabel="Editar"
      onConfirm={() => { if (confirming) save(confirming); }} onKeep={keep}>
      <p className={classes.confirmNumber}>{confirming?.number}</p>
      <p>La usaremos por defecto para tus facturas.</p>
    </ConfirmDialog>
  </>;
}
