import { useEffect, useId, useRef, useState, type FormEvent, type KeyboardEvent, type ReactNode } from "react";
import { useQuery, type QueryObserverResult } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { z } from "zod";
import { parsePhoneNumberFromString, type CountryCode } from "libphonenumber-js/max";
import { Button } from "@/components/ui/button";
import { useSession } from "@/app/session";
import { changeEmail, EmailChangeOutcomeUnknown, getProfile, profileQueryKey, patchProfile, type ProfileField, type CustomerProfile } from "@/shared/api/customer";
import { personNameSchema, phoneError, normalizePhonePresentation } from "@/shared/validation/person";
import { ApiRequestError, fieldErrorMessages } from "@/shared/api/errors";
import { useCountries } from "@/shared/api/reference";
import { FieldMessage } from "@/shared/ui/Field";
import { ReadFailure } from "@/features/purchase/CartPage";
import { useSessionOperationScope, type SessionOperationScope } from "@/app/sessionOperation";
import { TransactionButtonLabel } from "@/shared/ui/TransactionButtonLabel";
import { CustomerOnly, PurchasePage } from "@/features/purchase/PurchaseChrome";
import { MaterialSymbol } from "@/shared/ui/MaterialSymbol";
import { InternationalPhoneField } from "@/shared/ui/InternationalPhoneField";
import { AccountShell } from "./AccountShell";
import { AccountMonogram } from "@/shared/ui/AccountMonogram";
import classes from "./profile.module.css";
import { restoredProfileField, useProfileDraft, useProfileSaving } from "./profileDraft";

type FieldKey = "firstNames" | "lastNames" | "email" | "phone";
type Feedback = { field: FieldKey; message: string; error: boolean };
type Result = Omit<Feedback, "field">;
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
  useEffect(() => {
    if (profileQuery.error instanceof ApiRequestError && profileQuery.error.status === 401) clear("expired");
  }, [clear, profileQuery.error]);

  return <AccountShell title="Mi perfil" trail="Mi perfil">
    {profileQuery.isPending ? <p className="purchase-loading" role="status">Consultando tus datos…</p> : !profileQuery.data ? <ReadFailure error={profileQuery.error} title="No pudimos consultar tus datos." onRetry={() => void profileQuery.refetch()} retrying={profileQuery.isFetching} /> : <>
      {profileQuery.isError && <p className="stale-data-note" role="status">No pudimos actualizar tus datos. Se muestra la última consulta disponible. <Button variant="text" type="button" onClick={() => void profileQuery.refetch()}>Actualizar</Button></p>}
      <Profile profile={profileQuery.data} readCurrent={!profileQuery.isError} refetch={profileQuery.refetch} onExpired={() => clear("expired")} />
      <p className={classes.verification}>¿No encuentras el enlace para verificar tu correo? <Link to="/reenviar-verificacion" state={{ email: profileQuery.data.email }}>Reenviar verificación de correo</Link></p>
    </>}
  </AccountShell>;
}

/**
 * Identity first and read-only: the reader's avatar and name, then each piece of data as plain text.
 * One field opens for editing at a time, in place; saving or cancelling returns focus to its action.
 */
function Profile({ profile, readCurrent, refetch, onExpired }: { profile: CustomerProfile; readCurrent: boolean; refetch: Refetch; onExpired: () => void }) {
  const [editing, setEditing] = useState<FieldKey | null>(() => restoredProfileField(profile.customerId));
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const editButtons = useRef<Partial<Record<FieldKey, HTMLButtonElement | null>>>({});
  const fullName = `${profile.firstNames} ${profile.lastNames}`.trim();
  const phone = profile.phone ? parsePhoneNumberFromString(profile.phone)?.formatInternational() ?? profile.phone : null;

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

  const rows: { field: FieldKey; label: string; value: string | null; empty?: string; editor: ReactNode }[] = [
    { field: "firstNames", label: "Nombres", value: profile.firstNames, editor: <NameEditor field="firstNames" label="nombres" {...editorProps("firstNames")} /> },
    { field: "lastNames", label: "Apellidos", value: profile.lastNames, editor: <NameEditor field="lastNames" label="apellidos" {...editorProps("lastNames")} /> },
    { field: "email", label: "Correo electrónico", value: profile.email, editor: <EmailEditor {...editorProps("email")} /> },
    { field: "phone", label: "Teléfono", value: phone, empty: "Sin teléfono", editor: <PhoneEditor {...editorProps("phone")} /> },
  ];

  return <section className={classes.profile} aria-label="Perfil y datos personales">
    <header className={classes.identity}>
      <AccountMonogram firstNames={profile.firstNames} lastNames={profile.lastNames} size={76} stop />
      <div className={classes.identityCopy}>
        <h2 className={classes.name}>{fullName}</h2>
        <p className={classes.tagline}>Tus datos para comprar y recibir tus libros.</p>
      </div>
    </header>

    <ul className={classes.facts}>
      {rows.map((row) => {
        const isEditing = editing === row.field;
        const rowFeedback = feedback?.field === row.field ? feedback : null;
        return <li key={row.field} className={classes.fact} data-editing={isEditing || undefined}>
          {/* While editing, the row's own label names the input; nothing else on the page moves. */}
          {isEditing && row.field !== "email"
            ? <label className={classes.factLabel} htmlFor={`profile-${row.field}-input`}>{row.label}</label>
            : <span className={classes.factLabel} id={`profile-${row.field}-label`}>{row.label}</span>}
          {isEditing ? row.editor : <>
            <p className={classes.factValue} data-empty={!row.value || undefined}>{row.value ?? row.empty}</p>
            <Button
              ref={(element: HTMLButtonElement | null) => { editButtons.current[row.field] = element; }}
              variant="text" type="button" className={classes.edit}
              disabled={!readCurrent || (editing !== null && !isEditing)}
              onClick={() => open(row.field)}
            ><MaterialSymbol name="edit" aria-hidden="true" size={18} />{row.value ? "Editar" : "Agregar"}{" "}<span className="visually-hidden">{row.label.toLowerCase()}</span></Button>
          </>}
          {rowFeedback && !isEditing && <p className={`${classes.feedback} ${rowFeedback.error ? classes.feedbackError : ""}`} role={rowFeedback.error ? "alert" : "status"}>
            <MaterialSymbol name={rowFeedback.error ? "info" : "check_circle"} aria-hidden="true" size={16} />{rowFeedback.message}
          </p>}
        </li>;
      })}
    </ul>
  </section>;
}

interface EditorProps {
  profile: CustomerProfile;
  refetch: Refetch;
  onExpired: () => void;
  onDone: (result?: Result) => void;
}

/** One field's inline editor: its input(s) where the value was, Guardar/Cancelar where Editar was; Escape cancels. */
function EditorFrame({ label, onSubmit, onCancel, saving, saved, children, error, notice }: {
  label: string; onSubmit: () => void; onCancel: () => void; saving: boolean; saved: boolean; children: ReactNode; error: string | null; notice?: string;
}) {
  return <form className={classes.inline} noValidate aria-label={label}
    onSubmit={(event: FormEvent) => { event.preventDefault(); if (!saving) onSubmit(); }}
    onKeyDown={(event: KeyboardEvent) => { if (event.key === "Escape" && !saving) { event.preventDefault(); onCancel(); } }}>
    <div className={classes.inlineFields}>
      {children}
      {error && <p className={`${classes.feedback} ${classes.feedbackError}`} role="alert"><MaterialSymbol name="info" aria-hidden="true" size={16} />{error}</p>}
    </div>
    <div className={classes.inlineActions}>
      <button type="submit" className={classes.save} aria-disabled={saving || undefined} aria-busy={saving || undefined}>
        <TransactionButtonLabel state={saving ? "pending" : saved ? "success" : "idle"} idle="Guardar" pending="Guardando…" success="Guardado" />
      </button>
      <button type="button" className={classes.cancel} aria-disabled={saving || undefined} onClick={() => { if (!saving) onCancel(); }}>Cancelar</button>
    </div>
    {(saving || notice) && <p className={`${classes.feedback} ${classes.draftNotice}`} role="status">{saving ? "Guardando el dato enviado… Puedes seguir escribiendo; los cambios nuevos quedarán sin guardar." : notice}</p>}
  </form>;
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
    <input ref={inputRef} id={`profile-${field}-input`} className={classes.input} value={value} autoComplete={field === "firstNames" ? "given-name" : "family-name"}
      aria-invalid={Boolean(invalid) || undefined} aria-describedby={invalid ? `${inputId}-error` : undefined}
      onChange={(event) => setValue(event.target.value)} />
    {invalid && <FieldMessage id={`${inputId}-error`} tone="error">{invalid}</FieldMessage>}
  </EditorFrame>;
}

function PhoneEditor({ profile, refetch, onExpired, onDone }: EditorProps) {
  const scope = useSessionOperationScope(`${profile.customerId}:phone`);
  const countries = useCountries();
  const draft = useProfileDraft(profile, "phone", profile.phone ?? "");
  const { value, setValue } = draft;
  const original = draft.original.current;
  const [country, setCountry] = useState<CountryCode>((draft.country.current ?? parsePhoneNumberFromString(value)?.country ?? "EC") as CountryCode);
  const [invalid, setInvalid] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { saving, saved, run } = useProfileSaving(profile.customerId, "phone");
  useEffect(() => { document.getElementById("profile-phone-input")?.focus(); }, [countries.isPending]);

  return <EditorFrame label="Editar teléfono" saving={saving} saved={saved} error={error} notice={draft.notice} onCancel={() => { draft.cancel(); onDone(); }} onSubmit={() => void run(async () => {
    const submitted = value;
    const submittedCountry = country;
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
    if (result.done && draft.complete(submitted, result.current, Boolean(draft.country.current && draft.country.current !== submittedCountry))) { onDone(result.done); return true; }
    return false;
  })}>
    <div className={classes.phone}>
      <InternationalPhoneField
        id="profile-phone-input"
        label="Teléfono"
        countries={countries.data ?? []}
        countryCode={country}
        value={value || undefined}
        onCountryChange={(code) => { draft.setCountry(code); setCountry(code as CountryCode); }}
        onChange={(next) => setValue(next ?? "")}
        disabled={countries.isPending || countries.isError}
        invalid={Boolean(invalid)}
        describedBy={invalid ? "profile-phone-error" : "profile-phone-help"}
      />
    </div>
    {invalid ? <FieldMessage id="profile-phone-error" tone="error">{invalid}</FieldMessage> : <FieldMessage id="profile-phone-help" tone="help">Déjalo vacío para quitarlo.</FieldMessage>}
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
    return { message: `Verifica ${stored} con el enlace enviado. Las sesiones anteriores ya no se renovarán.`, error: false };
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
      onChange={(event) => setEmail(event.target.value)} />
    {errors.email && <FieldMessage id={`${emailId}-error`} tone="error">{errors.email}</FieldMessage>}
    <label className={classes.subLabel} htmlFor={passwordId}>Contraseña actual</label>
    <input ref={passwordRef} id={passwordId} className={classes.input} type="password" autoComplete="current-password" value={password}
      aria-invalid={Boolean(errors.password) || undefined} aria-describedby={errors.password ? `${passwordId}-error` : undefined}
      onChange={(event) => setPassword(event.target.value)} />
    {errors.password && <FieldMessage id={`${passwordId}-error`} tone="error">{errors.password}</FieldMessage>}
    <p className={classes.inlineNote} id={`${emailId}-note`}>Enviaremos un enlace al nuevo correo para verificarlo. Las sesiones anteriores ya no se renovarán; el acceso actual vence según su duración.</p>
  </EditorFrame>;
}
