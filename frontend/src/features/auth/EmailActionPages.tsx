import { useEffect, useId, useRef, useState, type FormEvent, type ReactNode } from "react";
import { Link, useLocation } from "react-router-dom";
import { z } from "zod";
import { useSession } from "@/app/session";
import { Button, ButtonLink } from "@/components/ui/button";
import { describeApiError } from "@/shared/api/errors";
import { EmailActionOutcomeUnknown } from "@/shared/api/emailActions";
import { SiteFooter } from "@/shared/ui/SiteFooter";
import { useEmailRequest, useEmailTokenAction } from "./emailActionHooks";

function EmailActionFrame({ title, children }: { title: string; children: ReactNode }) {
  useEffect(() => { document.title = `${title} · PLIEGO`; }, [title]);
  return <><main className="auth-page page-frame" id="contenido-principal" tabIndex={-1}>
    <div className="auth-content"><h1>{title}</h1>{children}<p><Link to="/sign-in">Iniciar sesión</Link></p></div>
  </main><SiteFooter returnHref="/catalog" /></>;
}

function ActionError({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLParagraphElement>(null);
  useEffect(() => { ref.current?.focus(); }, [children]);
  return <p className="auth-error" role="alert" tabIndex={-1} ref={ref}>{children}</p>;
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
  return <EmailActionFrame title={title}>
    <p>Si la cuenta cumple los requisitos, recibirás un correo con los pasos a seguir. Revisa también la carpeta de correo no deseado.</p>
    <form className="auth-form" onSubmit={submit} noValidate aria-busy={mutation.isPending}>
      <label htmlFor={id}>Correo electrónico</label>
      <input id={id} type="email" autoComplete="email" maxLength={254} value={email} disabled={blocked}
        aria-invalid={Boolean(validation)} aria-describedby={validation ? `${id}-error` : undefined}
        onChange={event => { setEmail(event.target.value); setValidation(null); if (mutation.isError) mutation.reset(); }} />
      {validation && <span id={`${id}-error`}><ActionError>{validation}</ActionError></span>}
      {mutation.isError && <ActionError>{failureMessage(mutation.error)}</ActionError>}
      {mutation.isSuccess && <p role="status">{mutation.data}</p>}
      <Button type="submit" variant="primary" disabled={blocked}>{mutation.isPending ? "Solicitando…" : label}</Button>
    </form>
    {(mutation.isSuccess || mutation.isError) && <p>Espera un minuto antes de volver a solicitar un enlace. Puedes abrir esta página de nuevo si necesitas otra solicitud.</p>}
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
  return <EmailActionFrame title="Verificar correo">
    {mutation.isSuccess ? <p role="status">Tu correo está verificado. Ya puedes iniciar sesión.</p>
      : mutation.isError ? <ActionError>{failureMessage(mutation.error)}</ActionError>
        : !token ? <ActionError>Abre el enlace completo del correo para verificar tu cuenta.</ActionError>
          : <><p>Confirma la verificación de tu correo. Este enlace se puede utilizar una sola vez.</p>
            <Button variant="primary" disabled={mutation.isPending} onClick={() => void verify()}>{mutation.isPending ? "Verificando…" : "Verificar correo"}</Button></>}
    <p><Link to="/reenviar-verificacion">Solicitar otro enlace</Link></p>
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
  return <EmailActionFrame title="Restablecer contraseña">
    {mutation.isSuccess ? <p role="status">Tu contraseña cambió. Inicia sesión de nuevo; las sesiones anteriores ya no se renovarán.</p>
      : mutation.isError ? <ActionError>{failureMessage(mutation.error)}</ActionError>
        : !token ? <ActionError>Abre el enlace completo del correo para restablecer tu contraseña.</ActionError>
          : <form className="auth-form" onSubmit={submit} noValidate aria-busy={mutation.isPending}>
            <label htmlFor={`${id}-password`}>Nueva contraseña</label>
            <input id={`${id}-password`} type="password" autoComplete="new-password" value={password} disabled={mutation.isPending} onChange={event => setPassword(event.target.value)} />
            <label htmlFor={`${id}-confirmation`}>Confirma tu contraseña</label>
            <input id={`${id}-confirmation`} type="password" autoComplete="new-password" value={confirmation} disabled={mutation.isPending} onChange={event => setConfirmation(event.target.value)} />
            {validation && <ActionError>{validation}</ActionError>}
            <Button type="submit" variant="primary" disabled={mutation.isPending}>{mutation.isPending ? "Guardando…" : "Restablecer contraseña"}</Button>
          </form>}
    <p><ButtonLink variant="text" to="/recuperar-contrasena">Solicitar otro enlace</ButtonLink></p>
  </EmailActionFrame>;
}
