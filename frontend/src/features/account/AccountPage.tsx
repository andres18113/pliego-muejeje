import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { useQuery, type QueryObserverResult } from "@tanstack/react-query";
import { z } from "zod";
import { parsePhoneNumberFromString } from "libphonenumber-js/max";
import { Button } from "@/components/ui/button";
import { useSession } from "@/app/session";
import { billingIdentityQueryKey, changeEmail, EmailChangeOutcomeUnknown, getBillingIdentity, getProfile, profileQueryKey, patchProfile, type ProfileField, type CustomerProfile } from "@/shared/api/customer";
import { personNameSchema, personNameError, phoneError, normalizePhonePresentation } from "@/shared/validation/person";
import { ApiRequestError, fieldErrorMessages } from "@/shared/api/errors";
import { FieldMessage } from "@/shared/ui/Field";
import { ReadFailure } from "@/features/purchase/CartPage";
import { useSessionOperationScope, type SessionOperationScope } from "@/app/sessionOperation";
import { CustomerOnly, PurchasePage } from "@/features/purchase/PurchaseChrome";
import { MaterialSymbol } from "@/shared/ui/MaterialSymbol";
import { PersonNameInput } from "@/shared/ui/PersonNameInput";
import { InternationalPhoneField } from "@/shared/ui/InternationalPhoneField";
import { Link } from "react-router-dom";
import { CedulaEditor } from "./CedulaEditor";
import { EditorFrame, type Result } from "./EditorFrame";
import { PasswordRecoveryEditor, usePasswordCooldown } from "./PasswordRecovery";
import { AccountShell } from "./AccountShell";
import { AccountMonogram } from "@/shared/ui/AccountMonogram";
import classes from "./profile.module.css";
import { restoredProfileField, useProfileDraft, useProfileSaving } from "./profileDraft";
import { PasswordInput } from "@/shared/ui/PasswordInput";

type FieldKey = "firstNames" | "lastNames" | "cedula" | "email" | "phone" | "password";
type Feedback = { field: FieldKey } & Result;
type Refetch = () => Promise<QueryObserverResult<CustomerProfile>>;

const nameRule = personNameSchema;
const emailRule = z.string().trim().min(1, "Escribe tu nuevo correo.").max(254, "El correo no puede superar 254 caracteres.").email("Escribe un correo válido, por ejemplo nombre@dominio.com.");

export function AccountPage() {
  return <PurchasePage title="Mi perfil"><CustomerOnly intent="/account" task="ver tu cuenta"><AccountContent /></CustomerOnly></PurchasePage>;
}

function AccountContent() {
  const { clear } = useSession();
  const profileQuery = useQuery({
    queryKey: profileQueryKey,
    queryFn: ({ signal }) => getProfile(signal),
    meta: { authRequired: true },
    refetchOnMount: "always",
    retry: false,
  });
  const identityQuery = useQuery({ queryKey: billingIdentityQueryKey, queryFn: ({ signal }) => getBillingIdentity(signal), meta: { authRequired: true }, refetchOnMount: "always", retry: false });
  useEffect(() => {
    if (profileQuery.error instanceof ApiRequestError && profileQuery.error.status === 401) clear("expired");
  }, [clear, profileQuery.error]);

  return <AccountShell title="Mi perfil" trail="Mi perfil">
    {profileQuery.isPending ? <p className="purchase-loading" role="status">Consultando tus datos…</p> : !profileQuery.data ? <ReadFailure error={profileQuery.error} title="No pudimos consultar tus datos." onRetry={() => void profileQuery.refetch()} retrying={profileQuery.isFetching} /> : <>
      {profileQuery.isError && <p className="stale-data-note" role="status">No pudimos actualizar tus datos. Se muestra la última consulta disponible. <Button variant="text" type="button" onClick={() => void profileQuery.refetch()}>Actualizar</Button></p>}
      <Profile profile={profileQuery.data} readCurrent={!profileQuery.isError} refetch={profileQuery.refetch} onExpired={() => clear("expired")}
        identity={{ data: identityQuery.data, pending: identityQuery.isPending, failed: identityQuery.isError && identityQuery.data === undefined, refetch: identityQuery.refetch }}
        passwordReadCurrent={!profileQuery.isError && !profileQuery.isFetching} />
    </>}
  </AccountShell>;
}

type IdentityState = {
  data: import("@/shared/api/billing").BillingIdentity | null | undefined;
  pending: boolean;
  failed: boolean;
  refetch: () => Promise<{ data?: import("@/shared/api/billing").BillingIdentity | null; isError: boolean }>;
};

/**
 * Identity first and read-only: the reader's avatar and name, then each piece of data as plain text.
 * One field opens for editing at a time, in place; saving or cancelling returns focus to its action.
 */
function Profile({ profile, readCurrent, refetch, onExpired, identity, passwordReadCurrent }: { profile: CustomerProfile; readCurrent: boolean; refetch: Refetch; onExpired: () => void; identity: IdentityState; passwordReadCurrent: boolean }) {
  const [editing, setEditing] = useState<FieldKey | null>(() => restoredProfileField(profile.customerId));
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const editButtons = useRef<Partial<Record<FieldKey, HTMLButtonElement | null>>>({});
  const password = usePasswordCooldown();
  const fullName = `${profile.firstNames} ${profile.lastNames}`.trim();
  const phone = profile.phone ? parsePhoneNumberFromString(profile.phone)?.formatInternational() ?? profile.phone : null;
  const verified = profile.emailVerified !== false;

  function open(field: FieldKey) {
    setFeedback(null);
    setEditing(field);
  }
  function close(field: FieldKey, result?: Result) {
    setEditing(null);
    if (result) setFeedback({ field, ...result });
    requestAnimationFrame(() => editButtons.current[field]?.focus({ preventScroll: true }));
  }
  const editorProps = (field: FieldKey) => ({ profile, refetch, onExpired, onDone: (result?: Result) => close(field, result) });

  const cedula: Row = identity.pending
    ? { field: "cedula", label: "Cédula o RUC", value: null, empty: "Consultando…", disabled: true, editor: null }
    : identity.failed
      ? { field: "cedula", label: "Cédula o RUC", value: null, empty: "No pudimos consultarla.", action: "Volver a consultar", icon: "refresh", onAction: () => void identity.refetch(), editor: null }
      : { field: "cedula", label: "Cédula o RUC", value: identity.data?.number ?? null, missing: { tone: "required", hint: "Necesaria para comprar" }, action: identity.data ? "Corregir" : "Agregar",
          editor: <CedulaEditor customerId={profile.customerId} identity={identity.data ?? null} refetch={identity.refetch} onExpired={onExpired} onDone={(result) => close("cedula", result)} /> };
  const rows: Row[] = [
    { field: "firstNames", label: "Nombres", value: profile.firstNames, editor: <NameEditor field="firstNames" label="nombres" {...editorProps("firstNames")} /> },
    { field: "lastNames", label: "Apellidos", value: profile.lastNames, editor: <NameEditor field="lastNames" label="apellidos" {...editorProps("lastNames")} /> },
    cedula,
    { field: "email", label: "Correo electrónico", value: profile.email, editor: <EmailEditor {...editorProps("email")} /> },
    { field: "phone", label: "Teléfono", value: phone, missing: { tone: "optional", hint: "Opcional" }, editor: <PhoneEditor {...editorProps("phone")} /> },
    verified
      ? { field: "password", label: "Contraseña", value: "Contraseña configurada", masked: true, action: "Cambiar", icon: "lock", disabled: !passwordReadCurrent, waiting: password.cooling,
          editor: <PasswordRecoveryEditor key={profile.email} email={profile.email} readCurrent={passwordReadCurrent} onRequested={password.start} onDone={(result) => close("password", result)} /> }
      : { field: "password", label: "Contraseña", value: null, empty: "Verifica tu correo para cambiarla", action: "Cambiar", icon: "lock", disabled: true, editor: null },
  ];

  return <section className={classes.profile} aria-label="Perfil y datos personales">
    <header className={classes.identity}>
      <AccountMonogram firstNames={profile.firstNames} lastNames={profile.lastNames} size={76} />
      <div className={classes.identityCopy}>
        <h2 className={classes.name}>{fullName}</h2>
        <p className={classes.tagline}>Tus datos para comprar y recibir tus libros.</p>
      </div>
    </header>

    <ul className={classes.facts}>
      {rows.map((row) => {
        const isEditing = editing === row.field && row.editor !== null;
        const rowFeedback = feedback?.field === row.field ? feedback : null;
        const labelsInput = row.field !== "email" && row.field !== "password";
        return <li key={row.field} className={classes.fact} data-editing={isEditing || undefined}>
          {/* While editing, the row's own label names the input; nothing else on the page moves. */}
          {isEditing && labelsInput
            ? <label className={classes.factLabel} htmlFor={`profile-${row.field}-input`}>{row.label}</label>
            : <span className={classes.factLabel} id={`profile-${row.field}-label`}>{row.label}</span>}
          {isEditing ? row.editor : <>
            <p className={classes.factValue} data-empty={!row.value || undefined}>
              {row.masked && row.value
                // A fixed mask, never the password's length; the row still reads its state aloud.
                ? <><span className={classes.mask} aria-hidden="true">{PASSWORD_MASK}</span><span className="visually-hidden">{row.value}</span></>
                : row.value ?? (row.missing
                // Not registered yet: a chip names the state; the hint says whether and when it is needed.
                ? <span className={classes.missing}><span className={classes.missingChip} data-tone={row.missing.tone}>Sin registrar</span><span className="visually-hidden">. </span><span className={classes.missingHint}>{row.missing.hint}</span></span>
                : row.empty)}
            </p>
            <Button
              ref={(element: HTMLButtonElement | null) => { editButtons.current[row.field] = element; }}
              variant="text" type="button" className={classes.edit}
              disabled={row.disabled || (!row.onAction && !readCurrent) || (editing !== null && !isEditing)}
              // Waiting keeps the action focusable, so focus can return to it after a request.
              aria-disabled={row.waiting || undefined}
              onClick={() => { if (row.waiting) return; if (row.onAction) row.onAction(); else open(row.field); }}
            ><MaterialSymbol name={row.icon ?? (row.value ? "edit" : "add")} aria-hidden="true" size={18} />{row.action ?? (row.value ? "Editar" : "Agregar")}{" "}<span className="visually-hidden">{row.label[0].toLowerCase() + row.label.slice(1)}</span></Button>
          </>}
          {rowFeedback && !isEditing && <p className={`${classes.feedback} ${rowFeedback.error ? classes.feedbackError : ""}`} role={rowFeedback.error ? "alert" : "status"}>
            <MaterialSymbol name={rowFeedback.error ? "info" : "check_circle"} aria-hidden="true" size={16} />{rowFeedback.message}
          </p>}
        </li>;
      })}
    </ul>
    {!verified && readCurrent && <p className={classes.verification}>
      Tu correo está pendiente de verificación. <Link to="/reenviar-verificacion" state={{ email: profile.email }}>Reenviar verificación de correo</Link>
    </p>}
  </section>;
}

const PASSWORD_MASK = "••••••••";

type Row = {
  field: FieldKey; label: string; value: string | null; empty?: string; editor: ReactNode;
  /** An absent value: "Sin registrar" plus whether and when it is needed. */
  missing?: { tone: "required" | "optional"; hint: string };
  /** Defaults follow the action: `add` creates a value that does not exist yet, `edit` changes one that does. */
  /** The password: `value` is read aloud, the eye sees a fixed mask (the password itself is never shown). */
  masked?: boolean;
  /** `lock` marks the security action of the password row. */
  action?: string; icon?: "add" | "edit" | "lock" | "refresh"; disabled?: boolean; waiting?: boolean; onAction?: () => void;
};

interface EditorProps {
  profile: CustomerProfile;
  refetch: Refetch;
  onExpired: () => void;
  onDone: (result?: Result) => void;
}

/** Save only the edited field, conditional on the version seen when its editor opened. */
async function saveProfileField(profile: CustomerProfile, field: ProfileField, value: string | null, refetch: Refetch, onExpired: () => void, savedMessage: string, scope: SessionOperationScope): Promise<{ done?: Result; error?: string; fieldError?: string; current?: CustomerProfile }> {
  try {
    scope.assertCurrent();
    await patchProfile(field, value, profile.version);
    if (!scope.isCurrent()) return {};
    const current = await refetch();
    if (!scope.isCurrent()) return {};
    return { current: current.isError ? undefined : current.data, done: { message: current.isError ? `${savedMessage} No pudimos actualizar la vista; usa Actualizar para comprobarlo.` : savedMessage, error: current.isError } };
  } catch (error) {
    if (!scope.isCurrent()) return {};
    if (error instanceof ApiRequestError && error.status === 401) { onExpired(); return {}; }
    if (error instanceof ApiRequestError && error.code === "P1104") {
      await refetch();
      if (!scope.isCurrent()) return {};
      return { error: "Tu perfil cambió mientras editabas. Conservamos lo que escribiste. Cancela y vuelve a abrir el campo para revisar los datos actuales antes de guardar." };
    }
    const specific = fieldErrorMessages(error,field) ?? fieldErrorMessages(error,"value");
    if(specific) return {fieldError:specific};
    if (error instanceof ApiRequestError && error.status < 500) return { error: `${error.title}. ${error.detail}` };
    const current = await refetch();
    if (!scope.isCurrent()) return {};
    const applied = !current.isError && current.data?.[field] === value && current.data.version !== profile.version;
    return applied ? { current: current.data, done: { message: savedMessage, error: false } } : { error: "No pudimos confirmar el cambio. Conservamos lo que escribiste; revisa el dato actual antes de volver a guardarlo." };
  }
}

function NameEditor({ field, label, profile, refetch, onExpired, onDone }: EditorProps & { field: "firstNames" | "lastNames"; label: "nombres" | "apellidos" }) {
  const scope = useSessionOperationScope(`${profile.customerId}:${field}`);
  const inputId = useId();
  const draft = useProfileDraft(profile, field, profile[field]);
  const { value, setValue } = draft;
  const original = draft.original.current;
  const [invalid, setInvalid] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const { saving, saved, run } = useProfileSaving(profile.customerId, field);
  useEffect(() => { inputRef.current?.focus(); inputRef.current?.select(); }, []);

  return <EditorFrame label={`Editar ${label}`} saving={saving} saved={saved} error={error} notice={draft.notice} onCancel={() => { draft.cancel(); onDone(); }} onSubmit={() => void run(async () => {
    const submitted = value;
    setError(null);
    const parsed = nameRule(label).safeParse(value);
    if (!parsed.success) { setInvalid(parsed.error.issues[0].message); inputRef.current?.focus(); return false; }
    setInvalid(null);
    if (parsed.data === original[field]) { draft.cancel(); onDone(); return false; }
    const result = await saveProfileField(original, field, parsed.data, refetch, onExpired, `Guardamos tus ${label}.`, scope);
    if (!scope.isCurrent()) return false;
    if (result.fieldError) { setInvalid(result.fieldError); inputRef.current?.focus(); return false; }
    if (result.error) { setError(result.error); return false; }
    if (result.done && draft.complete(submitted, result.current)) { onDone(result.done); return true; }
    return false;
  })}>
    <PersonNameInput onInputRejected={setInvalid} ref={inputRef} id={`profile-${field}-input`} className={classes.input} value={value} autoComplete={field === "firstNames" ? "given-name" : "family-name"}
      aria-invalid={Boolean(invalid) || undefined} aria-describedby={invalid ? `${inputId}-error` : undefined}
      onChange={(event) => { setValue(event.target.value); setInvalid(null); }}
      // A rejected edit leaves the accepted value unchanged. Keep its explanation
      // until another edit or submission; removing it on blur can move the clicked action.
      onBlur={() => setInvalid(current => current ?? personNameError(value, label))} />
    {invalid && <FieldMessage id={`${inputId}-error`} tone="error">{invalid}</FieldMessage>}
  </EditorFrame>;
}

function PhoneEditor({ profile, refetch, onExpired, onDone }: EditorProps) {
  const scope = useSessionOperationScope(`${profile.customerId}:phone`);
  const draft = useProfileDraft(profile, "phone", profile.phone ?? "");
  const { value, setValue } = draft;
  const original = draft.original.current;
  const [invalid, setInvalid] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { saving, saved, run } = useProfileSaving(profile.customerId, "phone");
  useEffect(() => { document.getElementById("profile-phone-input")?.focus(); }, []);

  return <EditorFrame label="Editar teléfono" saving={saving} saved={saved} error={error} notice={draft.notice} onCancel={() => { draft.cancel(); onDone(); }} onSubmit={() => void run(async () => {
    const submitted = value;
    setError(null);
    const trimmed = value.trim();
    const phoneProblem=phoneError(trimmed);
    if (phoneProblem) { setInvalid(phoneProblem); document.getElementById("profile-phone-input")?.focus(); return false; }
    setInvalid(null);
    const next = trimmed ? normalizePhonePresentation(trimmed) : null;
    if (next === (original.phone ?? null)) { draft.cancel(); onDone(); return false; }
    const result = await saveProfileField(original, "phone", next, refetch, onExpired, next ? "Guardamos tu teléfono." : "Quitamos tu teléfono.", scope);
    if (!scope.isCurrent()) return false;
    if(result.fieldError) { setInvalid(result.fieldError); document.getElementById("profile-phone-input")?.focus(); return false; }
    if (result.error) { setError(result.error); return false; }
    if (result.done && draft.complete(submitted, result.current)) { onDone(result.done); return true; }
    return false;
  })}>
    <div className={classes.phone}>
      <InternationalPhoneField
        id="profile-phone-input"
        label="Teléfono"
        countries={[{ code: "EC", name: "Ecuador" }]}
        countryCode="EC"
        value={value || undefined}
        onCountryChange={() => undefined}
        onChange={(next) => { setValue(next ?? ""); setInvalid(null); }}
        onBlur={() => setInvalid(phoneError(value.trim()))}
        error={invalid}
        hint="Vacío para quitarlo."
        invalid={Boolean(invalid)}
      />
    </div>
  </EditorFrame>;
}

/**
 * The email is the sign-in identity, so the change asks for the current password. The server owns
 * normalization and uniqueness; a lost response is reconciled by reading the profile, never retried blindly.
 */
function EmailEditor({ profile, refetch, onExpired, onDone }: EditorProps) {
  const scope = useSessionOperationScope(`${profile.customerId}:email`);
  const { session, updateEmailForSession } = useSession();
  const emailId = useId(), passwordId = useId();
  const draft = useProfileDraft(profile, "email", "");
  const { value: email, setValue: setEmail } = draft;
  const [password, setPassword] = useState("");
  const [errors, setErrors] = useState<{ email?: string; password?: string }>({});
  const [error, setError] = useState<string | null>(null);
  const emailRef = useRef<HTMLInputElement>(null);
  const passwordRef = useRef<HTMLInputElement>(null);
  const { saving, saved, run } = useProfileSaving(profile.customerId, "email");
  useEffect(() => { emailRef.current?.focus(); }, []);

  function confirmed(stored: string): Result {
    if (session && session.user.email !== stored) updateEmailForSession(session, stored);
    return { message: `Correo actualizado. Revisa ${stored} para verificarlo.`, error: false };
  }

  return <EditorFrame label="Cambiar correo electrónico" saving={saving} saved={saved} error={error} notice={draft.notice} onCancel={() => { draft.cancel(); onDone(); }} onSubmit={() => void run(async () => {
    const submitted = email;
    const submittedPassword = password;
    setError(null);
    const parsed = emailRule.safeParse(email);
    const next: { email?: string; password?: string } = {};
    if (!parsed.success) next.email = parsed.error.issues[0].message;
    else if (parsed.data.toLowerCase() === profile.email.toLowerCase()) next.email = "Ese ya es tu correo. Escribe uno distinto.";
    if (!password) next.password = "Escribe tu contraseña actual para confirmar el cambio.";
    setErrors(next);
    if (next.email || next.password || !parsed.success) { (next.email ? emailRef : passwordRef).current?.focus(); return false; }
    const requested = parsed.data;
    try {
      scope.assertCurrent();
      const stored = await changeEmail(requested, password);
      if (!scope.isCurrent()) return false;
      const current = await refetch();
      if (!scope.isCurrent()) return false;
      const feedback = confirmed(stored);
      const passwordChanged = passwordRef.current?.value !== submittedPassword;
      setPassword(latest => latest === submittedPassword ? "" : latest);
      if (draft.complete(submitted, current.isError ? undefined : current.data, passwordChanged)) { onDone(feedback); return true; }
      return false;
    } catch (failure) {
      if (!scope.isCurrent()) return false;
      if (failure instanceof ApiRequestError) {
        if (failure.status === 401) { onExpired(); return false; }
        if (failure.code === "CURRENT_PASSWORD_INVALID") { setErrors({ password: "La contraseña actual no es correcta." }); setPassword(""); passwordRef.current?.focus(); return false; }
        if (failure.code === "P1101") { setErrors({ email: "Ya existe una cuenta con ese correo." }); emailRef.current?.focus(); return false; }
        const emailMessage=fieldErrorMessages(failure,"newEmail"), passwordMessage=fieldErrorMessages(failure,"currentPassword");
        if(emailMessage || passwordMessage) {
          setErrors({email:emailMessage,password:passwordMessage});
          (emailMessage ? emailRef : passwordRef).current?.focus(); return false;
        }
        setError(`${failure.title}. ${failure.detail}`);
        return false;
      }
      if (failure instanceof EmailChangeOutcomeUnknown) {
        const current = await refetch();
        if (!scope.isCurrent()) return false;
        if (!current.isError && current.data && current.data.email.toLowerCase() === requested.toLowerCase()) {
          const feedback = confirmed(current.data.email);
          const passwordChanged = passwordRef.current?.value !== submittedPassword;
          setPassword(latest => latest === submittedPassword ? "" : latest);
          if (draft.complete(submitted, current.data, passwordChanged)) { onDone(feedback); return true; }
          return false;
        }
        setError("No pudimos confirmar si tu correo cambió. Revisa el correo que aparece en tu perfil antes de intentarlo otra vez.");
        return false;
      }
      throw failure;
    }
  })}>
    <input ref={emailRef} id={emailId} className={classes.input} type="email" inputMode="email" autoComplete="email" maxLength={254} value={email}
      aria-label="Nuevo correo" placeholder={profile.email}
      aria-invalid={Boolean(errors.email) || undefined} aria-describedby={errors.email ? `${emailId}-error` : `${emailId}-note`}
      onChange={(event) => { setEmail(event.target.value); setErrors(current => ({ ...current, email: undefined })); }} />
    {errors.email && <FieldMessage id={`${emailId}-error`} tone="error">{errors.email}</FieldMessage>}
    {!errors.email && <p className={classes.inlineNote} id={`${emailId}-note`}>Te enviaremos un enlace para verificar el nuevo correo.</p>}
    <label className={classes.subLabel} htmlFor={passwordId}>Contraseña actual</label>
    <PasswordInput ref={passwordRef} id={passwordId} className={classes.input} autoComplete="current-password" value={password}
      aria-invalid={Boolean(errors.password) || undefined} aria-describedby={errors.password ? `${passwordId}-error` : undefined}
      onChange={(event) => { setPassword(event.target.value); setErrors(current => ({ ...current, password: undefined })); }} />
    {errors.password && <FieldMessage id={`${passwordId}-error`} tone="error">{errors.password}</FieldMessage>}
    <details className={classes.securityDisclosure}>
      <summary>Seguridad del cambio</summary>
      <p>Te pedimos tu contraseña para proteger tu cuenta. Cuando tu sesión termine, tendrás que iniciar sesión de nuevo en tus dispositivos.</p>
    </details>
  </EditorFrame>;
}
