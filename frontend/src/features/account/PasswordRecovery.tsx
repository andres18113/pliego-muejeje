import { useEffect, useRef, useState } from "react";
import { useSessionOperationScope } from "@/app/sessionOperation";
import { EmailActionOutcomeUnknown, requestEmailAction } from "@/shared/api/emailActions";
import { ApiRequestError } from "@/shared/api/errors";
import { EditorFrame, type Result } from "./EditorFrame";
import classes from "./profile.module.css";

const COOLDOWN_MS = 60_000;

/** A visual wait after each explicit request; the server's own limits remain authoritative. */
export function usePasswordCooldown() {
  const [until, setUntil] = useState(0);
  useEffect(() => {
    if (!until) return;
    const timer = setTimeout(() => setUntil(0), Math.max(0, until - Date.now()));
    return () => clearTimeout(timer);
  }, [until]);
  return { cooling: until > Date.now(), start: () => setUntil(Date.now() + COOLDOWN_MS) };
}

/**
 * The Contraseña row's inline step. It reuses the recovery command with the current server email — never a
 * draft or a cached session claim — and only the emailed, single-use link can change the password.
 */
export function PasswordRecoveryEditor({ email, readCurrent, onDone, onRequested }: {
  email: string; readCurrent: boolean; onDone: (result?: Result) => void; onRequested: () => void;
}) {
  const scope = useSessionOperationScope(`profile-password:${email}`);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const lock = useRef(false);
  useEffect(() => { document.querySelector<HTMLButtonElement>('form[aria-label="Cambiar contraseña"] button[type="submit"]')?.focus(); }, []);

  async function request() {
    if (lock.current || !readCurrent || !scope.isCurrent()) return;
    lock.current = true;
    setPending(true);
    setError(null);
    try {
      await requestEmailAction("recovery", email, "/account");
      if (!scope.isCurrent()) return;
      onRequested();
      onDone({ message: `Solicitud recibida. Revisa ${email}; podrás pedir otro enlace en un minuto.`, error: false });
    } catch (failure) {
      if (!scope.isCurrent()) return;
      if (failure instanceof EmailActionOutcomeUnknown) {
        onRequested();
        onDone({ message: "No pudimos confirmar el envío. Revisa tu correo antes de pedir otro enlace.", error: true });
      } else if (failure instanceof ApiRequestError && failure.status === 429) {
        onRequested();
        onDone({ message: "Espera un minuto antes de pedir otro enlace.", error: true });
      } else {
        setError("No pudimos solicitar el enlace. Inténtalo de nuevo.");
      }
    } finally {
      lock.current = false;
      if (scope.isCurrent()) setPending(false);
    }
  }

  return <EditorFrame label="Cambiar contraseña" saving={pending} saved={false} error={error} blocked={!readCurrent}
    submit={{ idle: "Enviar enlace", pending: "Enviando…", success: "Enviado" }}
    onCancel={() => onDone()} onSubmit={() => void request()}>
    <p className={classes.inlineText} id="profile-password-note">
      Te enviaremos un enlace a <strong>{email}</strong> para elegir una nueva contraseña. Caduca en 15 minutos y sirve una sola vez.
    </p>
  </EditorFrame>;
}
