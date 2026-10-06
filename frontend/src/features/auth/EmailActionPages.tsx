import { useEffect, useId, useRef, useState, type FormEvent, type ReactNode } from "react";
import { Link, useLocation } from "react-router-dom";
import { z } from "zod";
import { useSession } from "@/app/session";
import { Button, ButtonLink } from "@/components/ui/button";
import { ApiRequestError, describeApiError } from "@/shared/api/errors";
import { EmailActionOutcomeUnknown } from "@/shared/api/emailActions";
import { SiteFooter } from "@/shared/ui/SiteFooter";
import { Field, FieldMessage } from "@/shared/ui/Field";
import { MaterialSymbol } from "@/shared/ui/MaterialSymbol";
import { AuthState, authFlowClasses as flow } from "./AuthFlow";
import { useEmailRequest, useEmailTokenAction } from "./emailActionHooks";

/** The page for one email action: the way back to sign-in, the name, then the form or its outcome. */
function EmailActionFrame({ title, children }: { title: string; children: ReactNode }) {
  useEffect(() => { document.title = `${title} · PLIEGO`; }, [title]);
  return <><main className={`auth-page page-frame ${flow.page}`} id="contenido-principal" tabIndex={-1} data-storefront-surface>
    <div className="auth-content">
      <Link to="/sign-in" className={flow.back}><MaterialSymbol name="arrow_back" /><span>Iniciar sesión</span></Link>
      <h1>{title}</h1>
      {children}
    </div>
  </main><SiteFooter returnHref="/catalog" /></>;
}

function ActionError({ children, inline = false }: { children: ReactNode; inline?: boolean }) {
  const ref = useRef<HTMLParagraphElement>(null);
  useEffect(() => { ref.current?.focus(); }, [children]);
  return <p className={inline ? flow.inlineError : undefined} role="alert" tabIndex={-1} ref={ref}>{children}</p>;
}

/** A finished link (invalid, expired or already used — the server does not tell them apart) or an outcome nobody could confirm. */
function ActionFailure({ error, another }: { error: unknown; another: ReactNode }) {
  const uncertain = error instanceof EmailActionOutcomeUnknown;
  const finished = error instanceof ApiRequestError && error.code === "EMAIL_ACTION_INVALID";
  return <AuthState tone={finished ? "terminal" : "error"} title={uncertain ? "No sabemos si se completó" : finished ? "Este enlace ya no está disponible" : "No pudimos completarlo"}
    actions={<>{another}{uncertain && <Link to="/sign-in">Iniciar sesión</Link>}</>}>
    <ActionError>{failureMessage(error)}</ActionError>
  </AuthState>;
}

function MissingLink({ children, another }: { children: ReactNode; another: ReactNode }) {
  return <AuthState tone="terminal" title="Falta el enlace del correo" actions={another}><ActionError>{children}</ActionError></AuthState>;
}

function failureMessage(error: unknown) {
  if (error instanceof EmailActionOutcomeUnknown) return error.message;
  const message = describeApiError(error);
  return `${message.title}. ${message.detail}`;
}

export function ResendVerificationPage() { return <EmailRequestPage purpose="verification" />; }
export function ForgotPasswordPage() { return <EmailRequestPage purpose="recovery" />; }

function EmailRequestPage({ purpose }: { purpose: "verification" | "recovery" }) {
  const location = useLocation();
  const initialEmail = typeof location.state?.email === "string" ? location.state.email : "";
  const [email, setEmail] = useState(initialEmail);
  const [validation, setValidation] = useState<string | null>(null);
  const id = useId();
  const mutation = useEmailRequest(purpose);
  const lock = useRef(false);
  const title = purpose === "verification" ? "Reenviar verificación" : "Recuperar contraseña";
  const label = purpose === "verification" ? "Solicitar enlace de verificación" : "Solicitar recuperación";
  const blocked = mutation.isPending || mutation.isSuccess || (mutation.isError && mutation.error instanceof EmailActionOutcomeUnknown);
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (lock.current || blocked) return;
    const parsed = z.string().trim().toLowerCase().max(254).email().safeParse(email);
    if (!parsed.success) { setValidation("Escribe un correo válido."); return; }
    setValidation(null);
    lock.current = true;
    try { await mutation.mutateAsync(parsed.data); } catch { /* Mutation exposes the failure. */ }
    finally { lock.current = false; }
  }
  const uncertain = mutation.isError && mutation.error instanceof EmailActionOutcomeUnknown;
  return <EmailActionFrame title={title}>
    {!mutation.isSuccess && <p>{purpose === "verification"
      ? "Escribe el correo de tu cuenta. Si la cuenta cumple los requisitos, recibirás un enlace para verificarla."
      : "Escribe el correo de tu cuenta. Si la cuenta cumple los requisitos, recibirás un enlace para elegir una contraseña nueva."}</p>}
    <form className={`auth-form${mutation.isSuccess ? ` ${flow.settled}` : ""}`} onSubmit={submit} noValidate aria-busy={mutation.isPending}>
      <Field controlId={id} label="Correo electrónico">
        <input id={id} type="email" autoComplete="email" autoCapitalize="none" maxLength={254} value={email} disabled={blocked}
          aria-invalid={Boolean(validation)} aria-describedby={validation ? `${id}-error` : undefined}
          onChange={event => { setEmail(event.target.value); setValidation(null); if (mutation.isError) mutation.reset(); }} />
        {validation && <span id={`${id}-error`}><ActionError inline>{validation}</ActionError></span>}
      </Field>
      {mutation.isError && !uncertain && <ActionError inline>{failureMessage(mutation.error)}</ActionError>}
      <Button type="submit" variant="primary" disabled={blocked}>{mutation.isPending ? "Solicitando…" : label}</Button>
    </form>
    {mutation.isSuccess && <AuthState tone="waiting" scene title="Revisa tu correo">
      <p role="status">{mutation.data}</p>
      <p>Mira también la carpeta de correo no deseado. Espera un minuto antes de volver a solicitar un enlace; puedes abrir esta página de nuevo si necesitas otra solicitud.</p>
    </AuthState>}
    {uncertain && <AuthState tone="error" title="No sabemos si se envió" actions={<Link to="/sign-in">Iniciar sesión</Link>}>
      <ActionError>{failureMessage(mutation.error)}</ActionError>
      <p>Espera un minuto antes de volver a solicitar un enlace. Puedes abrir esta página de nuevo si necesitas otra solicitud.</p>
    </AuthState>}
  </EmailActionFrame>;
}

export function VerifyEmailPage() {
  const { token, mutation } = useEmailTokenAction("verification");
  const lock = useRef(false);
  async function verify() {
    if (lock.current || !token) return;
    lock.current = true;
    try { await mutation.mutateAsync({ token }); } catch { /* Mutation exposes the failure. */ }
    finally { lock.current = false; }
  }
  const another = <Link to="/reenviar-verificacion">Solicitar otro enlace</Link>;
  return <EmailActionFrame title="Verificar correo">
    {mutation.isSuccess ? <AuthState tone="success" title="Correo verificado" actions={<ButtonLink variant="primary" to="/sign-in">Iniciar sesión</ButtonLink>}>
      <p role="status">Tu correo está verificado. Ya puedes iniciar sesión.</p>
    </AuthState>
      : mutation.isError ? <ActionFailure error={mutation.error} another={another} />
        : !token ? <MissingLink another={another}>Abre el enlace completo del correo para verificar tu cuenta.</MissingLink>
          : <AuthState tone="info" symbol="mail" title="Confirma que este correo es tuyo"
            actions={<><Button variant="primary" disabled={mutation.isPending} aria-busy={mutation.isPending || undefined} onClick={() => void verify()}>{mutation.isPending ? "Verificando…" : "Verificar correo"}</Button>{another}</>}>
            <p>Confirma la verificación de tu correo. Este enlace se puede utilizar una sola vez.</p>
          </AuthState>}
  </EmailActionFrame>;
}

export function ResetPasswordPage() {
  const { token, mutation } = useEmailTokenAction("recovery");
  const { clear } = useSession();
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [validation, setValidation] = useState<string | null>(null);
  const id = useId();
  const lock = useRef(false);
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (lock.current || !token) return;
    if ([...password].length < 8) { setValidation("Usa al menos 8 caracteres para tu contraseña."); return; }
    if (new TextEncoder().encode(password).length > 72) { setValidation("La contraseña es demasiado larga. Usa una más corta."); return; }
    if (password !== confirmation) { setValidation("Las contraseñas no coinciden."); return; }
    setValidation(null);
    lock.current = true;
    try { await mutation.mutateAsync({ token, password }); clear(); } catch { /* Mutation exposes the failure. */ }
    finally { setPassword(""); setConfirmation(""); lock.current = false; }
  }
  const another = <Link to="/recuperar-contrasena">Solicitar otro enlace</Link>;
  return <EmailActionFrame title="Restablecer contraseña">
    {mutation.isSuccess ? <AuthState tone="success" title="Contraseña actualizada" actions={<ButtonLink variant="primary" to="/sign-in">Iniciar sesión</ButtonLink>}>
      <p role="status">Tu contraseña cambió. Inicia sesión de nuevo; las sesiones anteriores ya no se renovarán.</p>
    </AuthState>
      : mutation.isError ? <ActionFailure error={mutation.error} another={another} />
        : !token ? <MissingLink another={another}>Abre el enlace completo del correo para restablecer tu contraseña.</MissingLink>
          : <>
            <p>Elige la contraseña nueva de tu cuenta. Este enlace se puede utilizar una sola vez.</p>
            <form className="auth-form" onSubmit={submit} noValidate aria-busy={mutation.isPending}>
              <Field controlId={`${id}-password`} label="Nueva contraseña">
                <input id={`${id}-password`} type="password" autoComplete="new-password" value={password} disabled={mutation.isPending} aria-describedby={`${id}-password-help`} onChange={event => setPassword(event.target.value)} />
                <FieldMessage tone="help" id={`${id}-password-help`}>Usa al menos 8 caracteres.</FieldMessage>
              </Field>
              <Field controlId={`${id}-confirmation`} label="Confirma tu contraseña">
                <input id={`${id}-confirmation`} type="password" autoComplete="new-password" value={confirmation} disabled={mutation.isPending} onChange={event => setConfirmation(event.target.value)} />
              </Field>
              {validation && <ActionError inline>{validation}</ActionError>}
              <Button type="submit" variant="primary" disabled={mutation.isPending}>{mutation.isPending ? "Guardando…" : "Restablecer contraseña"}</Button>
            </form>
            <p className={flow.links}>{another}</p>
          </>}
  </EmailActionFrame>;
}
