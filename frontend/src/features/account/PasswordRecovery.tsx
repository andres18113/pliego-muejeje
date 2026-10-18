import { useEffect, useId, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { useSessionOperationScope } from "@/app/sessionOperation";
import { EmailActionOutcomeUnknown, requestEmailAction } from "@/shared/api/emailActions";
import { ApiRequestError } from "@/shared/api/errors";
import classes from "./profile.module.css";

type Outcome = "idle" | "pending" | "accepted" | "unknown" | "rejected" | "limited";

/** Reuse the recovery command; only the emailed token can change the password. */
export function PasswordRecovery({ email, readCurrent, verified = true }: { email: string; readCurrent: boolean; verified?: boolean }) {
  const id = useId();
  const scope = useSessionOperationScope(`profile-password:${email}`);
  const [outcome, setOutcome] = useState<Outcome>("idle");
  const [cooldownUntil, setCooldownUntil] = useState(0);
  const lock = useRef(false);
  useEffect(() => {
    if (!cooldownUntil) return;
    const timer = setTimeout(() => setCooldownUntil(0), Math.max(0, cooldownUntil - Date.now()));
    return () => clearTimeout(timer);
  }, [cooldownUntil]);

  async function request() {
    if (lock.current || cooldownUntil > Date.now() || !readCurrent || !verified || !scope.isCurrent()) return;
    lock.current = true;
    setOutcome("pending");
    try {
      // A public recovery request intentionally uses the current server profile email,
      // never an editable draft or a cached session claim. No password changes here.
      await requestEmailAction("recovery", email, "/account");
      if (!scope.isCurrent()) return;
      setOutcome("accepted");
      setCooldownUntil(Date.now() + 60_000);
    } catch (error) {
      if (!scope.isCurrent()) return;
      const result = error instanceof EmailActionOutcomeUnknown ? "unknown"
        : error instanceof ApiRequestError && error.status === 429 ? "limited" : "rejected";
      setOutcome(result);
      if (result !== "rejected") setCooldownUntil(Date.now() + 60_000);
    } finally {
      lock.current = false;
    }
  }

  const pending = outcome === "pending";
  const requested = outcome === "accepted" || outcome === "unknown";
  const message = outcome === "accepted" ? "Solicitud recibida. Revisa tu correo."
    : outcome === "unknown" ? "No pudimos confirmar el envío. Revisa tu correo antes de solicitar otro enlace."
    : outcome === "limited" ? "Espera un minuto antes de solicitar otro enlace."
    : outcome === "rejected" ? "No pudimos solicitar el enlace. Inténtalo de nuevo." : null;

  return <section className={classes.passwordSection} aria-labelledby={`${id}-heading`}>
    <h2 id={`${id}-heading`}>Contraseña</h2>
    {!verified ? <>
      <p className={classes.passwordIntro}>Verifica tu correo para restablecer la contraseña.</p>
      {readCurrent && <p className={classes.passwordVerification}><Link to="/reenviar-verificacion" state={{ email }}>Reenviar verificación de correo</Link></p>}
    </> : <>
    <p className={classes.passwordIntro}>Para elegir una nueva contraseña, solicita un enlace a <strong>{email}</strong>.</p>
    <Button type="button" variant="secondary" className={classes.passwordAction}
      disabled={pending || cooldownUntil > Date.now() || !readCurrent} aria-busy={pending || undefined}
      onClick={() => void request()}>
      {pending ? "Solicitando enlace…" : requested ? "Solicitar otro enlace" : "Enviar enlace para restablecer"}
    </Button>
    {message && <p className={`${classes.passwordNotice} ${outcome !== "accepted" ? classes.feedbackError : ""}`}
      role={outcome === "accepted" ? "status" : "alert"}>{message}</p>}
    {cooldownUntil > Date.now() && outcome !== "limited" && <p className={classes.inlineNote}>Podrás solicitar otro enlace en un minuto.</p>}
    </>}
  </section>;
}
