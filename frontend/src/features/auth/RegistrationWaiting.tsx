import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Button, ButtonLink } from "@/components/ui/button";
import { useSession } from "@/app/session";
import { exchangeRegistrationSession } from "@/shared/api/auth";
import { ApiRequestError } from "@/shared/api/errors";
import { stateAfterRegistration, stateAfterSignIn } from "@/features/favorites/favoriteIntent";
import { AuthState } from "./AuthFlow";
import { authLocation, emailActionLocation } from "./authLocation";
import { adoptSharedSession, registrationDestination, sessionFromRegistration } from "./registrationContinuation";

/** Asks this often while visible; the API client still spaces every check, from any tab, by CHECK_GAP_MS (ADR 0050). */
const POLL_MS = 15_000;
/** After this, only coming back to the tab (focus, visibility, network) checks again. */
const POLL_WINDOW_MS = 30 * 60_000;

type Phase =
  | { kind: "waiting"; manual?: "checking" | "pending" | "failed" | "later" }
  | { kind: "continuing" }
  /** No continuation for this browser any more (expired, used elsewhere, other browser): ordinary sign-in. */
  | { kind: "ended" };

/**
 * "Revisa tu correo" after registration. The browser that registered holds an HttpOnly continuation; once the address
 * is verified — in this browser or any other — this page exchanges it for a normal session and continues to where the
 * customer was going. A refresh keeps this view (its address lives in history state, never in storage or the URL).
 * Nothing here authenticates on its own: a pending answer is only "not yet".
 */
export function RegistrationWaiting({ email, intent, returnState, headingRef }: {
  email: string; intent: string; returnState: unknown; headingRef: RefObject<HTMLHeadingElement | null>;
}) {
  const navigate = useNavigate();
  const { session, establish } = useSession();
  const [phase, setPhase] = useState<Phase>({ kind: "waiting" });
  const inFlight = useRef(false);
  /** A check that arrived inside the browser's check gap (coming back to the tab, the button): it runs when the gap
   * ends instead of never. One at a time; a pressed button upgrades a waiting automatic one so its answer is shown. */
  const deferred = useRef<{ timer: number; manual: boolean } | undefined>(undefined);
  /** Aborted when this view goes away: a check still waiting for the cross-tab lock is then never sent. */
  const lifetime = useRef(new AbortController());
  const startedAt = useRef(Date.now());
  const destination = useRef(intent);
  const done = phase.kind !== "waiting";

  const continueTo = useCallback((target: string) => {
    destination.current = target;
    setPhase({ kind: "continuing" });
  }, []);

  const check = useCallback(async (manual = false) => {
    if (inFlight.current) return;
    inFlight.current = true;
    if (manual) setPhase({ kind: "waiting", manual: "checking" });
    try {
      const outcome = await exchangeRegistrationSession(lifetime.current.signal);
      if (lifetime.current.signal.aborted) {
        // Gone while it answered: a session it created is still adopted; nothing is scheduled or shown.
        if (outcome.kind === "authenticated") establish(sessionFromRegistration(outcome.session));
        return;
      }
      if (outcome.kind === "authenticated") {
        establish(sessionFromRegistration(outcome.session));
        continueTo(registrationDestination(outcome.session, intent));
      } else if (outcome.kind === "refresh") {
        // Another tab of this browser won the exchange a moment ago: the shared cookie is restored, never invented.
        await adoptSharedSession(establish);
      } else if (outcome.kind === "ended") {
        setPhase({ kind: "ended" });
      } else if (outcome.kind === "wait") {
        // Too soon after the last check (this tab or another): ask once the gap ends. A pressed button keeps
        // "Comprobando…" until then; nothing extra is sent, the gap only moves the check.
        if (!deferred.current || (manual && !deferred.current.manual)) {
          window.clearTimeout(deferred.current?.timer);
          const timer = window.setTimeout(() => { deferred.current = undefined; void checkRef.current(manual); },
            Math.max(0, outcome.nextAt - Date.now()) + 50);
          deferred.current = { timer, manual };
        }
      } else if (manual) {
        // A spent quota keeps the continuation: the page waits for the server's time, then checks on its own again.
        setPhase({ kind: "waiting", manual: outcome.kind === "retry" ? "later" : "pending" });
      }
    } catch (error) {
      // A failed check changes nothing; the next lifecycle event or interval asks again.
      if (lifetime.current.signal.aborted) return;
      if (manual) setPhase({ kind: "waiting", manual: error instanceof ApiRequestError && error.status === 429 ? "pending" : "failed" });
    } finally {
      inFlight.current = false;
    }
  }, [continueTo, establish, intent]);
  const checkRef = useRef(check);
  useEffect(() => { checkRef.current = check; }, [check]);
  // Leaving the waiting view (signed in, ended, unmounted) cancels a deferred check.
  useEffect(() => {
    if (!done) return;
    window.clearTimeout(deferred.current?.timer); deferred.current = undefined;
  }, [done]);
  useEffect(() => {
    const current = new AbortController();
    lifetime.current = current;
    return () => { current.abort(); window.clearTimeout(deferred.current?.timer); };
  }, []);

  // A session restored here (this tab's exchange, another tab's verification broadcast, a refresh) is the answer.
  useEffect(() => {
    if (session && phase.kind !== "continuing") continueTo(destination.current);
  }, [continueTo, phase.kind, session]);

  useEffect(() => {
    if (phase.kind !== "continuing") return;
    const timer = window.setTimeout(() => navigate(destination.current, { replace: true, state: stateAfterSignIn(returnState) }), 900);
    return () => window.clearTimeout(timer);
  }, [navigate, phase.kind, returnState]);

  useEffect(() => {
    if (done) return;
    void check();
    const onReturn = () => { if (document.visibilityState === "visible") void check(); };
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible" && Date.now() - startedAt.current < POLL_WINDOW_MS) void check();
    }, POLL_MS);
    document.addEventListener("visibilitychange", onReturn);
    window.addEventListener("focus", onReturn);
    window.addEventListener("online", onReturn);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onReturn);
      window.removeEventListener("focus", onReturn);
      window.removeEventListener("online", onReturn);
    };
  }, [check, done]);

  const signIn = <ButtonLink variant={phase.kind === "ended" ? "primary" : "secondary"} to={authLocation("/sign-in", intent)} state={stateAfterRegistration(returnState, email)}>Iniciar sesión</ButtonLink>;
  const resend = <Link to={emailActionLocation("/reenviar-verificacion", intent)} state={{ email }}>Reenviar verificación</Link>;
  const going = intent.startsWith("/cart") ? "a tu carrito" : intent === "/" ? "al inicio" : "a donde estabas";

  return <section aria-labelledby="register-success-heading">
    <h1 id="register-success-heading" ref={headingRef} tabIndex={-1}>{phase.kind === "continuing" ? "Correo verificado" : "Revisa tu correo"}</h1>
    {phase.kind === "continuing" ? <AuthState tone="success" title="Ya iniciaste sesión">
      <p role="status">Tu cuenta está lista. Volviendo {going}…</p>
    </AuthState>
      : phase.kind === "ended" ? <AuthState tone="info" symbol="mail" title="Inicia sesión para continuar" actions={<>{signIn}{resend}</>}>
        <p role="status">Si ya verificaste <strong>{email}</strong>, inicia sesión con tu contraseña para seguir.</p>
        <p>Si todavía no lo hiciste, abre el enlace del correo o pide uno nuevo.</p>
      </AuthState>
      : <AuthState tone="waiting" scene title="Falta un paso: verificar tu correo"
        actions={<>
          <Button variant="secondary" type="button" aria-disabled={phase.manual === "checking" || undefined} onClick={() => { if (phase.manual !== "checking") void check(true); }}>
            {phase.manual === "checking" ? "Comprobando…" : "Ya verifiqué mi correo"}
          </Button>
          {resend}
          <Link to={authLocation("/sign-in", intent)} state={stateAfterRegistration(returnState, email)}>Iniciar sesión</Link>
        </>}>
        {/* ADR 0056: registering answers the same whether or not the address already has an account, so this page
            never says an account was created; it says what to open, and how to continue if one already existed. */}
        <p role="status">Enviamos a <strong>{email}</strong> el enlace para verificar tu nueva cuenta, si este correo aún no tenía una en PLIEGO.</p>
        <p>Cuando lo abras, aquí o en otro dispositivo, esta página iniciará tu sesión y te llevará {going}.</p>
        <p>Si no lo ves, mira en la carpeta de correo no deseado.</p>
        <p>¿Ya tenías una cuenta con este correo? <Link to={authLocation("/sign-in", intent)} state={stateAfterRegistration(returnState, email)}>Inicia sesión</Link> o <Link to={emailActionLocation("/recuperar-contrasena", intent)} state={{ email }}>restablece tu contraseña</Link>.</p>
        <p aria-live="polite">{phase.manual === "pending" ? "Todavía no vemos la verificación. Abre el enlace del correo e inténtalo de nuevo."
          : phase.manual === "failed" ? "No pudimos comprobarlo ahora. Seguiremos intentándolo."
          : phase.manual === "later" ? "Comprobamos muchas veces seguidas. Volveremos a intentarlo en unos minutos; no tienes que hacer nada." : ""}</p>
      </AuthState>}
  </section>;
}
