import { safeCatalogReturnHref } from "@/features/catalog/catalogUrl";
import { zodResolver } from "@hookform/resolvers/zod";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { useForm } from "react-hook-form";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { z } from "zod";
import { Button, ButtonLink } from "@/components/ui/button";
import { useSession } from "@/app/session";
import { authLocation, safeAuthReturnHref } from "@/features/auth/authLocation";
import { login, register } from "@/shared/api/auth";
import { ApiRequestError, describeApiError, fieldErrorMessages } from "@/shared/api/errors";
import { BackToCatalogLink } from "@/shared/ui/BackToCatalogLink";
import { personNameSchema, optionalPhoneSchema } from "@/shared/validation/person";
import { Field, FieldMessage } from "@/shared/ui/Field";
import { SiteFooter } from "@/shared/ui/SiteFooter";
import { stateAfterRegistration, stateAfterSignIn } from "@/features/favorites/favoriteIntent";

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
  const errorRef = useRef<HTMLDivElement>(null);
  const submitLockRef = useRef(false);
  const intent = safeAuthReturnHref(new URLSearchParams(location.search).get("from"));
  const from = safeCatalogReturnHref(intent);
  const [serverError, setServerError] = useState<{ title: string; detail: string } | null>(null);
  const [feedback, setFeedback] = useState<Feedback | null>(null);
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
      const response = await login(values);
      if (!response.user) throw new Error("La respuesta de inicio de sesión está incompleta.");
      session.establish({
        accessToken: response.accessToken!,
        expiresAt: Date.now() + response.expiresInSeconds! * 1000,
        user: response.user as NonNullable<typeof response.user> & Required<NonNullable<typeof response.user>>,
      });
      setFeedback({ state: "success", message: "Inicio de sesión correcto. Abriendo tu cuenta…" });
      await new Promise<void>((resolve) => window.setTimeout(resolve, 220));
      if (response.user.role === "ADMIN") navigate("/admin", { replace: true });
      else navigate(intent, { replace: true, state: stateAfterSignIn(location.state) });
    } catch (error: unknown) {
      const fields = (["email", "password"] as const).filter((field) => {
        const message=fieldErrorMessages(error,field);
        if(message) setError(field,{type:"server",message});
        return Boolean(message);
      });
      if(fields.length) { setFocus(fields[0]); setFeedback({state:"error",message:"Revisa los campos señalados."}); return; }
      setServerError(authFailure(error, "No se pudo iniciar sesión", "Comprueba tu conexión e inténtalo otra vez.", true));
      setFeedback({ state: "error", message: "No se pudo iniciar sesión." });
    }
  }, (invalid) => {
    setFeedback({ state: "error", message: "Revisa los campos señalados y vuelve a intentarlo." });
    const firstInvalid = (["email", "password"] as const).find((field) => invalid[field]);
    if (firstInvalid) setFocus(firstInvalid);
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

  const activeFeedback = resolveFeedback(feedback, isValidating, isSubmitting, "Comprobando tu cuenta…");

  return (
    <>

      <main className="auth-page page-frame" id="contenido-principal" tabIndex={-1}>
        <div className="auth-content" data-auth-state={activeFeedback.state}>
          <BackToCatalogLink to={from} />
          <h1>Iniciar sesión</h1>
          <p>Ingresa con el correo y la contraseña de tu cuenta.</p>

          <form className="auth-form" onSubmit={onSubmit} onChangeCapture={() => clearErrorFeedback(feedback, serverError, setFeedback, setServerError)} noValidate aria-busy={isSubmitting || isValidating}>
            {serverError && (
              <div className="auth-error" role="alert" tabIndex={-1} ref={errorRef}>
                <h2>{serverError.title}</h2>
                <p>{serverError.detail}</p>
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
              <input
                id="sign-in-password"
                type="password"
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
              aria-disabled={isSubmitting || isValidating || activeFeedback.state === "success"}
              aria-busy={isSubmitting || isValidating}
            >
              {activeFeedback.state === "validating" ? "Revisando…" : activeFeedback.state === "submitting" ? "Ingresando…" : activeFeedback.state === "success" ? "Sesión iniciada…" : "Iniciar sesión"}
            </Button>
          </form>

          <p><Link to="/recuperar-contrasena">¿Olvidaste tu contraseña?</Link></p>
          <p><Link to="/reenviar-verificacion">Reenviar verificación</Link></p>

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
  const from = safeCatalogReturnHref(intent);
  const [serverError, setServerError] = useState<{ title: string; detail: string } | null>(null);
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const [registered, setRegistered] = useState(false);
  const [registeredEmail, setRegisteredEmail] = useState("");
  const [phoneVisible, setPhoneVisible] = useState(false);
  const {
    register: registerField,
    handleSubmit,
    reset,
    setFocus,
    setError,
    setValue,
    clearErrors,
    formState: { errors, isSubmitting, isValidating },
  } = useForm<RegisterValues>({
    resolver: zodResolver(registerSchema),
    defaultValues: { email: "", password: "", firstNames: "", lastNames: "", phone: "" },
    mode: "onSubmit",
    reValidateMode: "onChange",
    shouldFocusError: false,
  });

  useEffect(() => {
    document.title = registered ? "Cuenta creada · PLIEGO" : "Crear cuenta · PLIEGO";
  }, [registered]);

  useEffect(() => {
    if (serverError) errorRef.current?.focus();
    if (registered) successRef.current?.focus();
  }, [serverError, registered]);

  const submit = handleSubmit(async (values) => {
    setServerError(null);
    try {
      await register({
        email: values.email,
        password: values.password,
        firstNames: values.firstNames,
        lastNames: values.lastNames,
        phone: values.phone || undefined,
      });
      reset({ email: values.email, password: "", firstNames: "", lastNames: "", phone: "" });
      setRegisteredEmail(values.email);
      setFeedback({ state: "success", message: "La cuenta se creó correctamente. Verifica tu correo antes de iniciar sesión." });
      setRegistered(true);
    } catch (error: unknown) {
      const fields=(["firstNames","lastNames","email","password","phone"] as const).filter((field) => {
        const message=fieldErrorMessages(error,field);
        if(message) setError(field,{type:"server",message});
        return Boolean(message);
      });
      if(fields.length) {
        if(fields.includes("phone")) setPhoneVisible(true);
        requestAnimationFrame(() => setFocus(fields[0]));
        setFeedback({state:"error",message:"Revisa los campos señalados."}); return;
      }
      setServerError(authFailure(error, "No pudimos crear tu cuenta", "Comprueba tu conexión e inténtalo otra vez."));
      setFeedback({ state: "error", message: "No pudimos crear tu cuenta." });
    }
  }, (invalid) => {
    setFeedback({ state: "error", message: "Revisa los campos señalados y vuelve a intentarlo." });
    const firstInvalid = (["firstNames", "lastNames", "email", "password", "phone"] as const).find((field) => invalid[field]);
    if (firstInvalid) setFocus(firstInvalid);
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

      <main className="auth-page page-frame" id="contenido-principal" tabIndex={-1}>
        <div className="auth-content" data-auth-state={registered ? "success" : activeFeedback.state}>
          <BackToCatalogLink to={from} />
          {registered ? (
            <section className="auth-success" aria-labelledby="register-success-heading">
              <h1 id="register-success-heading" ref={successRef} tabIndex={-1}>Cuenta creada</h1>
              <p role="status" aria-live="polite">La cuenta se creó correctamente para <strong className="auth-success-email">{registeredEmail}</strong>. Verifica tu correo con el enlace enviado antes de iniciar sesión. Revisa también el correo no deseado.</p>
              <p><Link to="/reenviar-verificacion" state={{ email: registeredEmail }}>Reenviar verificación</Link></p>
              <ButtonLink variant="primary" to={authLocation("/sign-in", intent)} state={stateAfterRegistration(location.state, registeredEmail)}>Iniciar sesión</ButtonLink>
            </section>
          ) : (
            <>
              <h1>Crear cuenta</h1>
              <p>Regístrate como cliente para continuar.</p>
              <p className="auth-form-note">Todos los campos son obligatorios, excepto el teléfono.</p>
              <form className="auth-form register-form" onSubmit={onSubmit} onChangeCapture={() => clearErrorFeedback(feedback, serverError, setFeedback, setServerError)} noValidate aria-busy={isSubmitting || isValidating}>
                {serverError && (
                  <div className="auth-error" role="alert" tabIndex={-1} ref={errorRef}>
                    <h2>{serverError.title}</h2>
                    <p>{serverError.detail}</p>
                  </div>
                )}

                <Field controlId="register-first-names" label="Nombres">
                  <input
                    id="register-first-names"
                    type="text"
                    autoComplete="given-name"
                    autoCapitalize="words"
                    required
                    aria-required="true"
                    aria-invalid={Boolean(errors.firstNames)}
                    aria-describedby={errors.firstNames ? "register-first-names-error" : undefined}
                    {...registerField("firstNames")}
                  />
                  {errors.firstNames && <FieldMessage tone="error" id="register-first-names-error">{errors.firstNames.message}</FieldMessage>}
                </Field>
                <Field controlId="register-last-names" label="Apellidos">
                  <input
                    id="register-last-names"
                    type="text"
                    autoComplete="family-name"
                    autoCapitalize="words"
                    required
                    aria-required="true"
                    aria-invalid={Boolean(errors.lastNames)}
                    aria-describedby={errors.lastNames ? "register-last-names-error" : undefined}
                    {...registerField("lastNames")}
                  />
                  {errors.lastNames && <FieldMessage tone="error" id="register-last-names-error">{errors.lastNames.message}</FieldMessage>}
                </Field>
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
                  <input
                    id="register-password"
                    type="password"
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
                  <input
                    id="register-phone"
                    type="tel"
                    autoComplete="tel"
                    inputMode="tel"
                    aria-invalid={Boolean(errors.phone)}
                    aria-describedby={errors.phone ? "register-phone-error" : "register-phone-help"}
                    {...registerField("phone")}
                  />
                  {errors.phone
                    ? <FieldMessage tone="error" id="register-phone-error">{errors.phone.message}</FieldMessage>
                    : <FieldMessage tone="help" id="register-phone-help">Incluye el prefijo internacional, por ejemplo +593 99 123 4567. Puedes usar espacios, paréntesis o guiones.</FieldMessage>}
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
