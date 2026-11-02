import { zodResolver } from "@hookform/resolvers/zod";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { useForm } from "react-hook-form";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { useSession } from "@/app/session";
import { useSessionOperationScope } from "@/app/sessionOperation";
import { adminReturnHref, authLocation, emailActionLocation, safeAuthReturnHref } from "@/features/auth/authLocation";
import { login, register } from "@/shared/api/auth";
import { ApiRequestError, describeApiError, fieldErrorMessages, LoginRateLimitedError } from "@/shared/api/errors";
import { BackToCatalogLink } from "@/shared/ui/BackToCatalogLink";
import { personNameSchema, personNameError, phoneError, optionalPhoneSchema } from "@/shared/validation/person";
import { PersonNameInput } from "@/shared/ui/PersonNameInput";
import { InternationalPhoneField } from "@/shared/ui/InternationalPhoneField";
import { Field, FieldMessage } from "@/shared/ui/Field";
import { SiteFooter } from "@/shared/ui/SiteFooter";
import { stateAfterSignIn } from "@/features/favorites/favoriteIntent";
import { authFlowClasses as flow } from "./AuthFlow";
import { PasswordInput } from "@/shared/ui/PasswordInput";
import { RegistrationWaiting } from "./RegistrationWaiting";

const MAX_PASSWORD_UTF8_BYTES = 72;

const emailSchema = z.string()
  .trim()
  .toLowerCase()
  .min(1, "Escribe tu correo electrónico.")
  .max(254, "El correo no puede superar 254 caracteres.")
  .email("Escribe un correo válido.");

const passwordByteLimit = (value: string) => new TextEncoder().encode(value).length <= MAX_PASSWORD_UTF8_BYTES;

const signInSchema = z.object({
  email: emailSchema,
  password: z.string()
    .min(1, "Escribe tu contraseña.")
    .refine(passwordByteLimit, "La contraseña es demasiado larga. Usa una más corta."),
});


const registerSchema = z.object({
  firstNames: personNameSchema("nombres"),
  lastNames: personNameSchema("apellidos"),
  email: emailSchema,
  password: z.string()
    .refine((value) => [...value].length >= 8, "Usa al menos 8 caracteres.")
    .refine(passwordByteLimit, "La contraseña es demasiado larga. Usa una más corta."),
  phone: optionalPhoneSchema,
});

type SignInValues = z.infer<typeof signInSchema>;
type RegisterValues = z.infer<typeof registerSchema>;
type FeedbackState = "idle" | "validating" | "submitting" | "success" | "error";
type Feedback = { state: FeedbackState; message: string };

export function SignInPage() {
  const location = useLocation();
  const navigate = useNavigate();
  const session = useSession();
  const scope = useSessionOperationScope(location.key);
  const errorRef = useRef<HTMLDivElement>(null);
  const submitLockRef = useRef(false);
  const intent = safeAuthReturnHref(new URLSearchParams(location.search).get("from"));
  const from = intent;
  const [serverError, setServerError] = useState<{ title: string; detail: string } | null>(null);
  // The server refuses the sign-in until the address is verified; the address typed goes on to the resend page.
  const [unverifiedEmail, setUnverifiedEmail] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  // ADR 0053: too many attempts from here. Until then the form keeps what was typed and sends nothing.
  const [pausedUntil, setPausedUntil] = useState<number | null>(null);
  const paused = pausedUntil !== null;
  useEffect(() => {
    if (pausedUntil === null) return;
    const timer = window.setTimeout(() => {
      setPausedUntil(null);
      setServerError({ title: "Ya puedes volver a intentarlo", detail: "Revisa tu correo y tu contraseña antes de enviar." });
    }, Math.max(0, pausedUntil - Date.now()));
    return () => window.clearTimeout(timer);
  }, [pausedUntil]);
  const {
    register: registerField,
    handleSubmit,
    setFocus,
    setError,
    formState: { errors, isSubmitting, isValidating },
  } = useForm<SignInValues>({
    resolver: zodResolver(signInSchema),
    defaultValues: { email: registrationEmailFromState(location.state), password: "" },
    mode: "onSubmit",
    reValidateMode: "onChange",
    shouldFocusError: false,
  });

  useEffect(() => {
    document.title = "Iniciar sesión · PLIEGO";
  }, []);

  useEffect(() => {
    if (serverError) errorRef.current?.focus();
  }, [serverError]);

  const submit = handleSubmit(async (values) => {
    setServerError(null);
    try {
      setUnverifiedEmail(null);
      const response = await login(values);
      if (!scope.isCurrent()) return;
      if (!response.user) throw new Error("La respuesta de inicio de sesión está incompleta.");
      const acceptedSession = {
        accessToken: response.accessToken!,
        expiresAt: Date.now() + response.expiresInSeconds! * 1000,
        user: response.user as NonNullable<typeof response.user> & Required<NonNullable<typeof response.user>>,
      };
      session.establish(acceptedSession);
      const acceptedAuthority = session.captureAuthority(acceptedSession);
      setFeedback({ state: "success", message: "Inicio de sesión correcto. Abriendo tu cuenta…" });
      await new Promise<void>((resolve) => window.setTimeout(resolve, 220));
      if (!acceptedAuthority.isCurrent() || !scope.isViewCurrent()) return;
      if (response.user.role === "ADMIN") navigate(adminReturnHref(new URLSearchParams(location.search).get("from")), { replace: true });
      else navigate(intent, { replace: true, state: stateAfterSignIn(location.state) });
    } catch (error: unknown) {
      if (!scope.isCurrent()) return;
      const fields = (["email", "password"] as const).filter((field) => {
        const message=fieldErrorMessages(error,field);
        if(message) setError(field,{type:"server",message});
        return Boolean(message);
      });
      if(fields.length) { setFocus(fields[0]); setFeedback({state:"error",message:"Revisa los campos señalados."}); return; }
      if (error instanceof LoginRateLimitedError) {
        // Never says whether the account exists: the pause belongs to these attempts, not to an account.
        setPausedUntil(error.retryAt);
        setServerError({ title: "Demasiados intentos", detail: `Por seguridad pausamos el inicio de sesión desde aquí. Podrás volver a intentarlo ${retryMoment(error.retryAt)}.` });
        setFeedback({ state: "error", message: "Inicio de sesión en pausa." });
        return;
      }
      setUnverifiedEmail(error instanceof ApiRequestError && error.code === "EMAIL_NOT_VERIFIED" ? values.email : null);
      setServerError(authFailure(error, "No se pudo iniciar sesión", "Comprueba tu conexión e inténtalo otra vez.", true));
      setFeedback({ state: "error", message: "No se pudo iniciar sesión." });
    }
  }, (invalid) => {
    setFeedback({ state: "error", message: "Revisa los campos señalados y vuelve a intentarlo." });
    const firstInvalid = (["email", "password"] as const).find((field) => invalid[field]);
    if (firstInvalid) setFocus(firstInvalid);
  });

  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    if (submitLockRef.current || paused) {
      event.preventDefault();
      // While paused nothing is sent; the explanation is brought back into view and focus.
      if (paused) errorRef.current?.focus();
      return;
    }
    submitLockRef.current = true;
    setServerError(null);
    setFeedback({ state: "validating", message: "Revisando tus datos…" });
    void submit(event).finally(() => { submitLockRef.current = false; });
  };

  const activeFeedback = resolveFeedback(feedback, isValidating, isSubmitting, "Comprobando tu cuenta…");

  return (
    <>

      <main className={`auth-page page-frame ${flow.page}`} id="contenido-principal" tabIndex={-1} data-storefront-surface>
        <div className="auth-content" data-auth-state={activeFeedback.state}>
          <BackToCatalogLink to={from} />
          <h1>Iniciar sesión</h1>
          <p>Ingresa con el correo y la contraseña de tu cuenta.</p>

          <form className="auth-form" onSubmit={onSubmit} onChangeCapture={() => { if (!paused) clearErrorFeedback(feedback, serverError, setFeedback, setServerError); }} noValidate aria-busy={isSubmitting || isValidating}>
            {serverError && (
              <div className="auth-error" role="alert" tabIndex={-1} ref={errorRef} data-tone={unverifiedEmail ? "info" : undefined}>
                <h2>{serverError.title}</h2>
                <p>{serverError.detail}</p>
                {unverifiedEmail && <Link to={emailActionLocation("/reenviar-verificacion", intent)} state={{ email: unverifiedEmail }}>Solicitar enlace de verificación</Link>}
                {paused && <Link to={emailActionLocation("/recuperar-contrasena", intent)}>¿Olvidaste tu contraseña? Restablécela</Link>}
              </div>
            )}

            <Field controlId="sign-in-email" label="Correo electrónico">
              <input
                id="sign-in-email"
                type="email"
                autoComplete="email"
                autoCapitalize="none"
                required
                aria-required="true"
                aria-invalid={Boolean(errors.email)}
                aria-describedby={errors.email ? "sign-in-email-error" : undefined}
                {...registerField("email")}
              />
              {errors.email && <FieldMessage tone="error" id="sign-in-email-error">{errors.email.message}</FieldMessage>}
            </Field>
            <Field controlId="sign-in-password" label="Contraseña">
              <PasswordInput
                id="sign-in-password"
                autoComplete="current-password"
                required
                aria-required="true"
                aria-invalid={Boolean(errors.password)}
                aria-describedby={errors.password ? "sign-in-password-error" : undefined}
                {...registerField("password")}
              />
              {errors.password && <FieldMessage tone="error" id="sign-in-password-error">{errors.password.message}</FieldMessage>}
            </Field>
            {activeFeedback.state === "error" && !serverError && (
              <p className="auth-feedback auth-feedback--error" role="status" aria-live="polite">{activeFeedback.message}</p>
            )}
            {activeFeedback.state !== "idle" && activeFeedback.state !== "error" && (
              <p className={`auth-feedback auth-feedback--${activeFeedback.state}`} role="status" aria-live="polite" aria-atomic="true">
                {activeFeedback.message}
              </p>
            )}
            <Button
              variant="primary"
              type="submit"
              aria-disabled={isSubmitting || isValidating || activeFeedback.state === "success" || paused}
              aria-busy={isSubmitting || isValidating}
            >
              {paused ? "En pausa" : activeFeedback.state === "validating" ? "Revisando…" : activeFeedback.state === "submitting" ? "Ingresando…" : activeFeedback.state === "success" ? "Sesión iniciada…" : "Iniciar sesión"}
            </Button>
          </form>

          <p className={flow.links}><Link to={emailActionLocation("/recuperar-contrasena", intent)}>¿Olvidaste tu contraseña?</Link><Link to={emailActionLocation("/reenviar-verificacion", intent)}>Reenviar verificación</Link></p>

          <p className="auth-switch">
            ¿Todavía no tienes una cuenta? <Link to={authLocation("/register", intent)} state={location.state}>Crear cuenta</Link>
          </p>
        </div>
      </main>
      <SiteFooter returnHref={from} />
    </>
  );
}

export function RegisterPage() {
  const location = useLocation();
  const errorRef = useRef<HTMLDivElement>(null);
  const successRef = useRef<HTMLHeadingElement>(null);
  const submitLockRef = useRef(false);
  const intent = safeAuthReturnHref(new URLSearchParams(location.search).get("from"));
  const from = intent;
  const [serverError, setServerError] = useState<{ title: string; detail: string } | null>(null);
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  // The waiting view survives a refresh through history state (never storage or the URL); the original state,
  // including any pending catalog action, rides along for the sign-in that follows.
  const remembered = readRegistration(location.state);
  const [registered, setRegistered] = useState(Boolean(remembered));
  const [registeredEmail, setRegisteredEmail] = useState(remembered ?? "");
  const navigate = useNavigate();
  const returnState = withoutRegistration(location.state);
  const [phoneVisible, setPhoneVisible] = useState(false);
  const {
    register: registerField,
    handleSubmit,
    reset,
    watch,
    setFocus,
    setError,
    setValue,
    clearErrors,
    formState: { errors, isSubmitting, isValidating },
  } = useForm<RegisterValues>({
    resolver: zodResolver(registerSchema),
    defaultValues: { email: "", password: "", firstNames: "", lastNames: "", phone: "" },
    // A field is checked once it has been visited (or on submit), then as it is corrected; never while untouched.
    mode: "onTouched",
    reValidateMode: "onChange",
    shouldFocusError: false,
  });

  useEffect(() => {
    document.title = registered ? "Revisa tu correo · PLIEGO" : "Crear cuenta · PLIEGO";
  }, [registered]);

  useEffect(() => {
    if (serverError) errorRef.current?.focus();
    if (registered) successRef.current?.focus();
  }, [serverError, registered]);

  function focusRegistrationField(field: keyof RegisterValues) {
    if (field === "phone") document.getElementById("register-phone")?.focus();
    else setFocus(field);
  }

  const submit = handleSubmit(async (values) => {
    setServerError(null);
    try {
      await register({
        email: values.email,
        password: values.password,
        firstNames: values.firstNames,
        lastNames: values.lastNames,
        phone: values.phone || undefined,
        ...(intent !== "/" ? { returnTo: intent } : {}),
      });
      reset({ email: values.email, password: "", firstNames: "", lastNames: "", phone: "" });
      setRegisteredEmail(values.email);
      setFeedback({ state: "success", message: "La cuenta se creó correctamente. Verifica tu correo para continuar." });
      setRegistered(true);
      navigate({ pathname: location.pathname, search: location.search }, { replace: true, state: rememberRegistration(location.state, values.email) });
    } catch (error: unknown) {
      const fields=(["firstNames","lastNames","email","password","phone"] as const).filter((field) => {
        const message=fieldErrorMessages(error,field);
        if(message) setError(field,{type:"server",message});
        return Boolean(message);
      });
      if(fields.length) {
        if(fields.includes("phone")) setPhoneVisible(true);
        requestAnimationFrame(() => focusRegistrationField(fields[0]));
        setFeedback({state:"error",message:"Revisa los campos señalados."}); return;
      }
      setServerError(authFailure(error, "No pudimos crear tu cuenta", "Comprueba tu conexión e inténtalo otra vez."));
      setFeedback({ state: "error", message: "No pudimos crear tu cuenta." });
    }
  }, (invalid) => {
    setFeedback({ state: "error", message: "Revisa los campos señalados y vuelve a intentarlo." });
    const firstInvalid = (["firstNames", "lastNames", "email", "password", "phone"] as const).find((field) => invalid[field]);
    if (firstInvalid) focusRegistrationField(firstInvalid);
  });

  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    if (submitLockRef.current) {
      event.preventDefault();
      return;
    }
    submitLockRef.current = true;
    setServerError(null);
    setFeedback({ state: "validating", message: "Revisando tus datos…" });
    void submit(event).finally(() => { submitLockRef.current = false; });
  };

  const activeFeedback = resolveFeedback(feedback, isValidating, isSubmitting, "Creando tu cuenta…");

  return (
    <>

      <main className={`auth-page page-frame ${flow.page}`} id="contenido-principal" tabIndex={-1} data-storefront-surface>
        <div className="auth-content" data-auth-state={registered ? "success" : activeFeedback.state} data-auth-view={registered ? undefined : "register"}>
          <BackToCatalogLink to={from} />
          {registered ? (
            <RegistrationWaiting email={registeredEmail} intent={intent} returnState={returnState} headingRef={successRef} />
          ) : (
            <>
              <h1>Crear cuenta</h1>
              <p className="auth-form-note">Todos los campos son obligatorios, excepto el teléfono.</p>
              <form className="auth-form register-form" onSubmit={onSubmit} onChangeCapture={() => clearErrorFeedback(feedback, serverError, setFeedback, setServerError)} noValidate aria-busy={isSubmitting || isValidating}>
                {serverError && (
                  <div className="auth-error" role="alert" tabIndex={-1} ref={errorRef}>
                    <h2>{serverError.title}</h2>
                    <p>{serverError.detail}</p>
                  </div>
                )}

                <div className="register-names">
                <Field controlId="register-first-names" label="Nombres">
                  <PersonNameInput
                    onInputRejected={(message) => setError("firstNames", { type: "validate", message })}
                    id="register-first-names"
                    type="text"
                    autoComplete="given-name"
                    autoCapitalize="words"
                    required
                    aria-required="true"
                    aria-invalid={Boolean(errors.firstNames)}
                    aria-describedby={errors.firstNames ? "register-first-names-error" : undefined}
                    {...registerField("firstNames", { onChange: (event) => {
                      const message = personNameError(event.target.value, "nombres");
                      if (message) setError("firstNames", { type: "validate", message });
                      else clearErrors("firstNames");
                    } })}
                  />
                  {errors.firstNames && <FieldMessage tone="error" id="register-first-names-error">{errors.firstNames.message}</FieldMessage>}
                </Field>
                <Field controlId="register-last-names" label="Apellidos">
                  <PersonNameInput
                    onInputRejected={(message) => setError("lastNames", { type: "validate", message })}
                    id="register-last-names"
                    type="text"
                    autoComplete="family-name"
                    autoCapitalize="words"
                    required
                    aria-required="true"
                    aria-invalid={Boolean(errors.lastNames)}
                    aria-describedby={errors.lastNames ? "register-last-names-error" : undefined}
                    {...registerField("lastNames", { onChange: (event) => {
                      const message = personNameError(event.target.value, "apellidos");
                      if (message) setError("lastNames", { type: "validate", message });
                      else clearErrors("lastNames");
                    } })}
                  />
                  {errors.lastNames && <FieldMessage tone="error" id="register-last-names-error">{errors.lastNames.message}</FieldMessage>}
                </Field>
                </div>
                <Field controlId="register-email" label="Correo electrónico">
                  <input
                    id="register-email"
                    type="email"
                    autoComplete="email"
                    autoCapitalize="none"
                    maxLength={254}
                    required
                    aria-required="true"
                    aria-invalid={Boolean(errors.email)}
                    aria-describedby={errors.email ? "register-email-error" : undefined}
                    {...registerField("email")}
                  />
                  {errors.email && <FieldMessage tone="error" id="register-email-error">{errors.email.message}</FieldMessage>}
                </Field>
                <Field controlId="register-password" label="Contraseña">
                  <PasswordInput
                    id="register-password"
                    autoComplete="new-password"
                    required
                    aria-required="true"
                    aria-invalid={Boolean(errors.password)}
                    aria-describedby={errors.password ? "register-password-error" : "register-password-help"}
                    {...registerField("password")}
                  />
                  {errors.password
                    ? <FieldMessage tone="error" id="register-password-error">{errors.password.message}</FieldMessage>
                    : <FieldMessage tone="help" id="register-password-help">Usa al menos 8 caracteres.</FieldMessage>}
                </Field>
                <button
                  className="auth-optional-trigger"
                  type="button"
                  aria-expanded={phoneVisible}
                  aria-controls="register-phone-field"
                  onClick={() => {
                    if (phoneVisible) {
                      setValue("phone", "");
                      clearErrors("phone");
                    }
                    setPhoneVisible(!phoneVisible);
                  }}
                >
                  {phoneVisible ? "Quitar teléfono" : "Añadir teléfono (opcional)"}
                </button>
                <Field controlId="register-phone" id="register-phone-field" hidden={!phoneVisible} label={<>Teléfono <span>(opcional)</span></>}>
                  {phoneVisible && <InternationalPhoneField
                    id="register-phone" label="Teléfono (opcional)"
                    countries={[{ code: "EC", name: "Ecuador" }]}
                    countryCode="EC" onCountryChange={() => undefined}
                    value={watch("phone") || undefined}
                    onChange={(value) => {
                      const next = value ?? "";
                      setValue("phone", next, { shouldDirty: true });
                      clearErrors("phone");
                    }}
                    onBlur={() => {
                      const message = phoneError(watch("phone"));
                      if (message) setError("phone", { type: "validate", message });
                      else clearErrors("phone");
                    }}
                    error={errors.phone?.message}
                  />}
                </Field>
                {activeFeedback.state === "error" && !serverError && (
                  <p className="auth-feedback auth-feedback--error" role="status" aria-live="polite">{activeFeedback.message}</p>
                )}
                {activeFeedback.state !== "idle" && activeFeedback.state !== "error" && (
                  <p className={`auth-feedback auth-feedback--${activeFeedback.state}`} role="status" aria-live="polite" aria-atomic="true">
                    {activeFeedback.message}
                  </p>
                )}
                <Button
                  variant="primary"
                  type="submit"
                  aria-disabled={isSubmitting || isValidating}
                  aria-busy={isSubmitting || isValidating}
                >
                  {activeFeedback.state === "validating" ? "Revisando…" : activeFeedback.state === "submitting" ? "Creando cuenta…" : "Crear cuenta"}
                </Button>
              </form>
              <p className="auth-switch">
                ¿Ya tienes una cuenta? <Link to={authLocation("/sign-in", intent)} state={location.state}>Iniciar sesión</Link>
              </p>
            </>
          )}
        </div>
      </main>
      <SiteFooter returnHref={from} />
    </>
  );
}


/** "en unos segundos" / "en 1 minuto, a las 14:05" / "en 5 minutos, a las 14:09" — local time of this device. */
function retryMoment(retryAt: number) {
  const seconds = Math.max(1, Math.ceil((retryAt - Date.now()) / 1000));
  if (seconds < 60) return "en unos segundos";
  const minutes = Math.ceil(seconds / 60);
  const at = new Date(retryAt).toLocaleTimeString("es-EC", { hour: "2-digit", minute: "2-digit" });
  return `en ${minutes === 1 ? "1 minuto" : `${minutes} minutos`}, a las ${at}`;
}

function registrationEmailFromState(state: unknown) {
  if (state === null || typeof state !== "object" || !("registeredEmail" in state)) return "";
  const email = state.registeredEmail;
  return typeof email === "string" ? email : "";
}

function authFailure(error: unknown, fallbackTitle: string, fallbackDetail: string, identifyInvalidCredentials = false) {
  if (identifyInvalidCredentials && error instanceof ApiRequestError && error.code === "AUTH_INVALID_CREDENTIALS") {
    return { title: "No se pudo iniciar sesión", detail: "El correo o la contraseña no son correctos." };
  }
  if (!(error instanceof ApiRequestError) || error.status === 0) {
    return { title: "No pudimos conectar con PLIEGO", detail: "Comprueba tu conexión e inténtalo otra vez." };
  }
  if (error.status >= 500) {
    return { title: "El servicio no está disponible", detail: "Inténtalo de nuevo dentro de unos minutos." };
  }
  const described = describeApiError(error, fallbackTitle, fallbackDetail);
  return { title: described.title, detail: described.detail };
}

function resolveFeedback(feedback: Feedback | null, isValidating: boolean, isSubmitting: boolean, submittingMessage: string): Feedback {
  if (feedback?.state === "success") return feedback;
  if (isValidating) return { state: "validating", message: "Revisando tus datos…" };
  if (isSubmitting) return { state: "submitting", message: submittingMessage };
  return feedback ?? { state: "idle", message: "" };
}

function clearErrorFeedback(
  feedback: Feedback | null,
  serverError: { title: string; detail: string } | null,
  setFeedback: (feedback: Feedback | null) => void,
  setServerError: (error: { title: string; detail: string } | null) => void,
) {
  if (feedback?.state === "error") setFeedback(null);
  if (serverError) setServerError(null);
}

const REGISTRATION_KEY = "pliegoRegistration";
function isStateRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
function readRegistration(state: unknown): string | null {
  const entry = isStateRecord(state) ? state[REGISTRATION_KEY] : null;
  const email = isStateRecord(entry) ? entry.email : null;
  return typeof email === "string" && email.includes("@") ? email : null;
}
function withoutRegistration(state: unknown): unknown {
  if (!isStateRecord(state) || !(REGISTRATION_KEY in state)) return state;
  const { [REGISTRATION_KEY]: _registration, ...rest } = state;
  return Object.keys(rest).length ? rest : null;
}
function rememberRegistration(state: unknown, email: string) {
  return { ...(isStateRecord(state) ? state : {}), [REGISTRATION_KEY]: { email } };
}
