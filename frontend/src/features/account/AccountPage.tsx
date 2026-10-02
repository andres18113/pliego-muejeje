import { zodResolver } from "@hookform/resolvers/zod";
import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { parsePhoneNumberFromString, type CountryCode } from "libphonenumber-js/min";
import { Button } from "@/components/ui/button";
import { useSession } from "@/app/session";
import { getProfile, profileQueryKey, updateProfile, type CustomerProfile } from "@/shared/api/customer";
import { ApiRequestError } from "@/shared/api/errors";
import { useCountries } from "@/shared/api/reference";
import { Field, FieldMessage } from "@/shared/ui/Field";
import { ReadFailure } from "@/features/purchase/CartPage";
import { TransactionButtonLabel } from "@/shared/ui/TransactionButtonLabel";
import { CustomerOnly, PurchasePage } from "@/features/purchase/PurchaseChrome";
import { AccountNavigation } from "./AccountNavigation";
import { InternationalPhoneField, isValidPhoneNumber } from "@/shared/ui/InternationalPhoneField";

const name = (label: string) => z.string().trim().min(1, `Escribe tus ${label}.`).max(120, `Los ${label} no pueden superar 120 caracteres.`);
const profileSchema = z.object({
  firstNames: name("nombres"),
  lastNames: name("apellidos"),
  phone: z.string().trim(),
});
type ProfileValues = z.infer<typeof profileSchema>;

export function AccountPage() {
  return <PurchasePage title="Cuenta"><CustomerOnly intent="/account" task="ver tu cuenta"><AccountContent /></CustomerOnly></PurchasePage>;
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

  return <div className="account-page">
    <header className="purchase-heading">
      <h1>Mi cuenta</h1>
      <p>Administra tus datos y consulta tus compras.</p>
    </header>
    <AccountNavigation />
    <section className="account-section" aria-labelledby="account-profile-heading">
      <h2 id="account-profile-heading">Perfil y datos personales</h2>
      {profileQuery.isPending ? <p className="purchase-loading" role="status">Consultando tus datos…</p> : !profileQuery.data ? <ReadFailure title="No pudimos consultar tus datos." onRetry={() => void profileQuery.refetch()} retrying={profileQuery.isFetching} /> : <>
        {profileQuery.isError && <p className="stale-data-note" role="status">No pudimos actualizar tus datos. Se muestra la última consulta disponible. <Button variant="text" type="button" onClick={() => void profileQuery.refetch()}>Actualizar</Button></p>}
        <ProfileForm profile={profileQuery.data} readCurrent={!profileQuery.isError && !profileQuery.isFetching} refetch={() => profileQuery.refetch()} onExpired={() => clear("expired")} />
      </>}
    </section>
  </div>;
}

function ProfileForm({ profile, readCurrent, refetch, onExpired }: {
  profile: CustomerProfile;
  readCurrent: boolean;
  refetch: () => Promise<{ data?: CustomerProfile; isError: boolean }>;
  onExpired: () => void;
}) {
  const [feedback, setFeedback] = useState<{ message: string; error: boolean } | null>(null);
  const [phoneCountry, setPhoneCountry] = useState<CountryCode>((parsePhoneNumberFromString(profile.phone ?? "")?.country ?? "EC") as CountryCode);
  const countries = useCountries();
  const lock = useRef(false);
  const savedPulseTimer = useRef<number | null>(null);
  const [savedPulse, setSavedPulse] = useState(false);
  const form = useForm<ProfileValues>({
    resolver: zodResolver(profileSchema),
    defaultValues: { firstNames: profile.firstNames, lastNames: profile.lastNames, phone: profile.phone ?? "" },
  });
  useEffect(() => {
    if (!form.formState.isDirty) form.reset({ firstNames: profile.firstNames, lastNames: profile.lastNames, phone: profile.phone ?? "" });
  }, [profile.firstNames, profile.lastNames, profile.phone, form.formState.isDirty, form.reset]);
  const mutation = useMutation({ mutationFn: updateProfile, retry: false });
  useEffect(() => () => {
    if (savedPulseTimer.current !== null) window.clearTimeout(savedPulseTimer.current);
  }, []);
  function showSavedPulse() {
    setSavedPulse(true);
    if (savedPulseTimer.current !== null) window.clearTimeout(savedPulseTimer.current);
    savedPulseTimer.current = window.setTimeout(() => setSavedPulse(false), 1_100);
  }
  const save = form.handleSubmit(async (values) => {
    if (lock.current || !readCurrent) return;
    const parsedPhone = values.phone.trim() ? parsePhoneNumberFromString(values.phone) : null;
    if (values.phone.trim() && !isValidPhoneNumber(values.phone)) {
      form.setError("phone", { message: "Escribe un número válido para el país elegido." }, { shouldFocus: true });
      requestAnimationFrame(() => document.getElementById("account-phone")?.focus());
      return;
    }
    lock.current = true;
    setFeedback(null);
    const body = { firstNames: values.firstNames, lastNames: values.lastNames, phone: parsedPhone?.number ?? null };
    try {
      await mutation.mutateAsync(body);
      showSavedPulse();
      const current = await refetch();
      if (current.data) form.reset({ firstNames: current.data.firstNames, lastNames: current.data.lastNames, phone: current.data.phone ?? "" });
      setFeedback({ message: current.isError ? "Guardamos tus datos, pero no pudimos actualizar la vista. Usa Actualizar para comprobarlos." : "Guardamos tus datos personales.", error: current.isError });
    } catch (error) {
      if (error instanceof ApiRequestError && error.status === 401) onExpired();
      else if (error instanceof ApiRequestError && error.status < 500) setFeedback({ message: `${error.title}. ${error.detail}`, error: true });
      else {
        const current = await refetch();
        const applied = !current.isError && current.data?.firstNames === body.firstNames && current.data?.lastNames === body.lastNames && current.data?.phone === body.phone;
        if (applied && current.data) {
          showSavedPulse();
          form.reset({ firstNames: current.data.firstNames, lastNames: current.data.lastNames, phone: current.data.phone ?? "" });
        }
        setFeedback({ message: applied ? "Confirmamos que tus datos se guardaron." : "No pudimos confirmar los cambios. Revisa los datos actuales antes de volver a guardarlos.", error: !applied });
      }
    } finally {
      lock.current = false;
    }
  });

  return <form className="account-profile-form" onSubmit={save} noValidate>
    <div className="account-profile-email"><span>Correo electrónico</span><strong>{profile.email}</strong><small>El correo de esta cuenta no se puede cambiar aquí.</small></div>
    <div className="account-profile-fields">
      <Field controlId="account-first-names" label="Nombres">
        <input id="account-first-names" autoComplete="given-name" maxLength={120} aria-invalid={Boolean(form.formState.errors.firstNames) || undefined} aria-describedby={form.formState.errors.firstNames ? "account-first-names-error" : undefined} {...form.register("firstNames")} />
        {form.formState.errors.firstNames && <FieldMessage id="account-first-names-error" tone="error">{form.formState.errors.firstNames.message}</FieldMessage>}
      </Field>
      <Field controlId="account-last-names" label="Apellidos">
        <input id="account-last-names" autoComplete="family-name" maxLength={120} aria-invalid={Boolean(form.formState.errors.lastNames) || undefined} aria-describedby={form.formState.errors.lastNames ? "account-last-names-error" : undefined} {...form.register("lastNames")} />
        {form.formState.errors.lastNames && <FieldMessage id="account-last-names-error" tone="error">{form.formState.errors.lastNames.message}</FieldMessage>}
      </Field>
      <div className="form-field">
        <Field controlId="account-phone" label={<>Teléfono<span className="field-optional"> (opcional)</span></>}>
          <InternationalPhoneField
            id="account-phone"
            label="Teléfono"
            countries={countries.data ?? []}
            countryCode={phoneCountry}
            value={form.watch("phone") || undefined}
            onCountryChange={(code) => setPhoneCountry(code as CountryCode)}
            onChange={(value) => form.setValue("phone", value ?? "", { shouldDirty: true, shouldValidate: true })}
            onBlur={() => form.trigger("phone")}
            disabled={countries.isPending || countries.isError}
            invalid={Boolean(form.formState.errors.phone)}
            describedBy={form.formState.errors.phone ? "account-phone-error" : undefined}
          />
        {form.formState.errors.phone && <FieldMessage id="account-phone-error" tone="error">{form.formState.errors.phone.message}</FieldMessage>}
        </Field>
      </div>
    </div>
    <div className="account-profile-actions">
      <Button variant="primary" type="submit" disabled={!readCurrent} aria-disabled={!readCurrent || mutation.isPending || undefined} aria-busy={mutation.isPending || undefined}>
        <TransactionButtonLabel
          state={mutation.isPending ? "pending" : savedPulse ? "success" : "idle"}
          idle="Guardar datos personales"
          pending="Guardando…"
          success="Guardado"
        />
      </Button>
      {feedback && <p
          className={`purchase-notice ${feedback.error ? "purchase-notice--error" : "purchase-notice--success"}`}
          role={feedback.error ? "alert" : "status"}
        >{feedback.message}</p>}
    </div>
  </form>;
}
