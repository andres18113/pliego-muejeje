import { useEffect, useId, useRef, useState, type FormEvent, type ReactNode } from "react";
import { useMutation } from "@tanstack/react-query";
import { Link, useLocation, useNavigate, useNavigation } from "react-router-dom";
import { z } from "zod";
import { useSession } from "@/app/session";
import { Button, ButtonLink } from "@/components/ui/button";
import { ApiRequestError, describeApiError } from "@/shared/api/errors";
import { cancelEmailChangeByLink, confirmEmailChange, EmailActionOutcomeUnknown } from "@/shared/api/emailActions";
import { SiteFooter } from "@/shared/ui/SiteFooter";
import { Field, FieldMessage } from "@/shared/ui/Field";
import { MaterialSymbol } from "@/shared/ui/MaterialSymbol";
import { AuthState, authFlowClasses as flow } from "./AuthFlow";
import { useEmailRequest, useEmailTokenAction, useFragmentToken } from "./emailActionHooks";
import { emailActionLocation, safeAuthReturnHref } from "./authLocation";
import { PasswordInput } from "@/shared/ui/PasswordInput";
import { adoptSharedSession, registrationDestination, sessionFromRegistration } from "./registrationContinuation";

function useEmailReturnHref() {
  const location = useLocation();
  return safeAuthReturnHref(new URLSearchParams(location.search).get("from"));
}

/** The page for one email action: the way back to sign-in, the name, then the form or its outcome. */
function EmailActionFrame({ title, children }: { title: string; children: ReactNode }) {
  const from = useEmailReturnHref();
  useEffect(() => { document.title = `${title} · PLIEGO`; }, [title]);
  return <><main className={`auth-page page-frame ${flow.page}`} id="contenido-principal" tabIndex={-1} data-storefront-surface>
    <div className="auth-content">
      <Link to={emailActionLocation("/sign-in", from)} className={flow.back}><MaterialSymbol name="arrow_back" /><span>Iniciar sesión</span></Link>
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
  const from = useEmailReturnHref();
  const uncertain = error instanceof EmailActionOutcomeUnknown;
  const finished = error instanceof ApiRequestError && error.code === "EMAIL_ACTION_INVALID";
  return <AuthState tone={finished ? "terminal" : "error"} title={uncertain ? "No sabemos si se completó" : finished ? "Este enlace ya no está disponible" : "No pudimos completarlo"}
    actions={<>{another}{uncertain && <Link to={emailActionLocation("/sign-in", from)}>Iniciar sesión</Link>}</>}>
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
  const from = useEmailReturnHref();
  const [email, setEmail] = useState(initialEmail);
  const [validation, setValidation] = useState<string | null>(null);
  const id = useId();
  const mutation = useEmailRequest(purpose, from);
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
    {!mutation.isSuccess && <p>Escribe el correo de tu cuenta.</p>}
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
      <p>Revisa también el correo no deseado. Para pedir otro enlace, espera un minuto y vuelve a abrir esta página.</p>
    </AuthState>}
    {uncertain && <AuthState tone="error" title="No sabemos si se envió" actions={<Link to={emailActionLocation("/sign-in", from)}>Iniciar sesión</Link>}>
      <ActionError>{failureMessage(mutation.error)}</ActionError>
      <p>Para pedir otro enlace, espera un minuto y vuelve a abrir esta página.</p>
    </AuthState>}
  </EmailActionFrame>;
}

export function VerifyEmailPage() {
  const location = useLocation();
  const navigate = useNavigate();
  const navigation = useNavigation();
  const from = useEmailReturnHref();
  const { session, establish } = useSession();
  const { token, mutation } = useEmailTokenAction("verification");
  const attempted = useRef("");
  const verify = mutation.mutate;
  const idle = mutation.isIdle;
  useEffect(() => {
    if (!token) {
      if (idle) attempted.current = "";
      return;
    }
    // Synchronous identity guard also survives Strict Mode's repeated effects.
    // Never replay an uncertain response just because the page rerenders.
    if (attempted.current === token) return;
    attempted.current = token;
    verify({ token });
  }, [token, verify, idle]);

  // In the browser that registered, verifying also signed in (ADR 0050): install that session once. Its broadcast
  // lets the "Revisa tu correo" tab restore the same cookie and continue on its own.
  const created = mutation.isSuccess ? mutation.data ?? null : null;
  const installed = useRef<object | null>(null);
  useEffect(() => {
    if (!created || installed.current === created) return;
    installed.current = created;
    establish(sessionFromRegistration(created));
  }, [created, establish]);
  // A lost answer may still have verified and signed in: the cookie decides, before any new link is suggested.
  const uncertain = mutation.isError && mutation.error instanceof EmailActionOutcomeUnknown;
  const restoreTried = useRef(false);
  useEffect(() => {
    if (!uncertain || session || restoreTried.current) return;
    restoreTried.current = true;
    void adoptSharedSession(establish);
  }, [uncertain, session, establish]);

  const signedIn = Boolean(session) && (mutation.isSuccess || uncertain);
  const destination = created ? registrationDestination(created, from) : from;
  useEffect(() => {
    // Let the confirmation be read, then continue without another required click — only with a session, since
    // the destination may be a customer page. A new fragment belongs to a new verification; leaving cancels it.
    if (!signedIn || location.hash || navigation.state !== "idle") return;
    const timer = window.setTimeout(() => navigate(destination, { replace: true }), 1200);
    return () => window.clearTimeout(timer);
  }, [signedIn, location.hash, navigation.state, destination, navigate]);
  const another = <Link to={emailActionLocation("/reenviar-verificacion", from)}>Solicitar otro enlace</Link>;
  return <EmailActionFrame title="Verificación de correo">
    {signedIn ? <AuthState tone="success" title="Correo verificado" actions={<ButtonLink variant="primary" to={destination} replace>Continuar</ButtonLink>}>
      <p role="status">{destination === "/" ? "Ya iniciaste sesión. Abriendo el inicio…" : "Ya iniciaste sesión. Volviendo a donde estabas…"}</p>
    </AuthState>
      : mutation.isSuccess ? <AuthState tone="success" title="Correo verificado"
        actions={<ButtonLink variant="primary" to={emailActionLocation("/sign-in", from)}>Iniciar sesión</ButtonLink>}>
        <p role="status">Tu cuenta ya está activa.</p>
        <p>Si la creaste en otro navegador o dispositivo, vuelve a esa página: continuará sola. Aquí, inicia sesión para seguir.</p>
      </AuthState>
      : mutation.isError ? <ActionFailure error={mutation.error} another={another} />
        : !token && !mutation.isPending ? <MissingLink another={another}>Abre el enlace completo del correo para verificar tu cuenta.</MissingLink>
          : <AuthState tone="info" symbol="mail" title="Verificando tu correo">
            <p role="status">Estamos comprobando el enlace…</p>
          </AuthState>}
  </EmailActionFrame>;
}

export function ResetPasswordPage() {
  const from = useEmailReturnHref();
  const { token, mutation } = useEmailTokenAction("recovery");
  const { session, captureAuthority, clear } = useSession();
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
    const issued = captureAuthority(session);
    try {
      await mutation.mutateAsync({ token, password });
      if (issued.isCurrent()) clear();
    } catch { /* Mutation exposes the failure. */ }
    finally { setPassword(""); setConfirmation(""); lock.current = false; }
  }
  const another = <Link to={emailActionLocation("/recuperar-contrasena", from)}>Solicitar otro enlace</Link>;
  return <EmailActionFrame title="Restablecer contraseña">
    {mutation.isSuccess ? <AuthState tone="success" title="Contraseña actualizada" actions={<ButtonLink variant="primary" to={emailActionLocation("/sign-in", from)}>Iniciar sesión</ButtonLink>}>
      <p role="status">Inicia sesión con tu nueva contraseña.</p>
      <details>
        <summary>Seguridad de tu cuenta</summary>
        <p>El acceso en otros dispositivos puede seguir activo hasta que caduque o se vuelva a comprobar la sesión. Para continuar, será necesario iniciar sesión de nuevo.</p>
      </details>
    </AuthState>
      : mutation.isError ? <ActionFailure error={mutation.error} another={another} />
        : !token ? <MissingLink another={another}>Abre el enlace completo del correo para restablecer tu contraseña.</MissingLink>
          : <>
            <p>Elige la contraseña nueva de tu cuenta. Este enlace se puede utilizar una sola vez.</p>
            <form className="auth-form" onSubmit={submit} noValidate aria-busy={mutation.isPending}>
              <Field controlId={`${id}-password`} label="Nueva contraseña">
                <PasswordInput id={`${id}-password`} autoComplete="new-password" value={password} disabled={mutation.isPending} aria-describedby={`${id}-password-help`} onChange={event => setPassword(event.target.value)} />
                <FieldMessage tone="help" id={`${id}-password-help`}>Usa al menos 8 caracteres.</FieldMessage>
              </Field>
              <Field controlId={`${id}-confirmation`} label="Confirma tu contraseña">
                <PasswordInput id={`${id}-confirmation`} autoComplete="new-password" value={confirmation} disabled={mutation.isPending} onChange={event => setConfirmation(event.target.value)} />
              </Field>
              {validation && <ActionError inline>{validation}</ActionError>}
              <Button type="submit" variant="primary" disabled={mutation.isPending}>{mutation.isPending ? "Guardando…" : "Restablecer contraseña"}</Button>
            </form>
            <p className={flow.links}>{another}</p>
          </>}
  </EmailActionFrame>;
}

/**
 * The link sent to a requested address. Opening it confirms (it only proves that mailbox, which the customer asked
 * for); the server then swaps the login email and closes every session, so the next step is signing in with it.
 */
export function ConfirmEmailChangePage() {
  const token = useFragmentToken();
  const { session, clear } = useSession();
  const attempted = useRef("");
  const mutation = useMutation({ mutationFn: confirmEmailChange, retry: false });
  const confirm = mutation.mutate;
  useEffect(() => {
    // One attempt per token, also under Strict Mode's repeated effects; an uncertain outcome is never replayed.
    if (!token || attempted.current === token) return;
    attempted.current = token;
    confirm(token);
  }, [token, confirm]);
  const confirmed = mutation.isSuccess;
  useEffect(() => { if (confirmed && session) clear(); }, [confirmed, session, clear]);
  const another = <Link to="/account">Ir a Mi perfil</Link>;
  return <EmailActionFrame title="Confirmar nuevo correo">
    {mutation.isSuccess ? <AuthState tone="success" title="Correo confirmado" actions={<ButtonLink variant="primary" to={emailActionLocation("/sign-in", "/account")}>Iniciar sesión</ButtonLink>}>
      <p role="status">Desde ahora entras con <strong>{mutation.data}</strong>. Por seguridad cerramos tus sesiones abiertas.</p>
    </AuthState>
      : mutation.isError ? <ActionFailure error={mutation.error} another={another} />
        : !token ? <MissingLink another={another}>Abre el enlace completo del correo para confirmar tu nuevo correo.</MissingLink>
          : <AuthState tone="info" symbol="mail" title="Confirmando tu correo">
            <p role="status">Estamos comprobando el enlace…</p>
          </AuthState>}
  </EmailActionFrame>;
}

/**
 * The link sent to the address still in use when a change is requested: the account's way back. It waits for an
 * explicit press, so a mail scanner that follows links cannot withdraw a change the customer did ask for.
 */
export function CancelEmailChangePage() {
  const token = useFragmentToken();
  const mutation = useMutation({ mutationFn: cancelEmailChangeByLink, retry: false });
  const lock = useRef(false);
  const alreadyConfirmed = mutation.error instanceof ApiRequestError && mutation.error.code === "EMAIL_CHANGE_ALREADY_CONFIRMED";
  const help = <Link to="/ayuda">Ir a Ayuda</Link>;
  return <EmailActionFrame title="Cancelar cambio de correo">
    {mutation.isSuccess ? <AuthState tone="success" title="Cambio cancelado" actions={<ButtonLink variant="primary" to="/recuperar-contrasena">Cambiar contraseña</ButtonLink>}>
      <p role="status">Tu cuenta sigue usando esta dirección. Si no pediste el cambio, alguien conoce tu contraseña: cámbiala ahora.</p>
    </AuthState>
      : alreadyConfirmed ? <AuthState tone="terminal" title="El cambio ya se confirmó" actions={help}>
        <ActionError>Tu cuenta ya usa la dirección nueva. Si no fuiste tú, escríbenos desde Ayuda para recuperarla.</ActionError>
      </AuthState>
        : mutation.isError ? <ActionFailure error={mutation.error} another={help} />
          : !token ? <MissingLink another={help}>Abre el enlace completo del correo para cancelar el cambio.</MissingLink>
            : <AuthState tone="info" symbol="lock" title="¿No pediste este cambio?" actions={<Button variant="primary" type="button" disabled={mutation.isPending} onClick={() => {
              if (lock.current) return; lock.current = true; mutation.mutate(token, { onSettled: () => { lock.current = false; } });
            }}>{mutation.isPending ? "Cancelando…" : "Cancelar el cambio"}</Button>}>
              <p>Si lo cancelas, tu cuenta seguirá usando esta dirección y el enlace enviado a la nueva dejará de funcionar.</p>
            </AuthState>}
  </EmailActionFrame>;
}
