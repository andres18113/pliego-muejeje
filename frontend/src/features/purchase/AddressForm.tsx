import { zodResolver } from "@hookform/resolvers/zod";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { isSupportedCountry, parsePhoneNumberFromString, type CountryCode } from "libphonenumber-js/max";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { createAddress, resolveAddress, AddressOutcomeUnknown, getProfile, profileQueryKey, updateAddress, type CustomerAddress } from "@/shared/api/customer";
import { useSession } from "@/app/session";
import { beginPendingAttempt, clearPendingAttempt, readPendingAttempt } from "@/shared/api/attemptStorage";
import { ApiRequestError, fieldErrorMessages } from "@/shared/api/errors";
import { useCountries } from "@/shared/api/reference";
import { Field, FieldMessage } from "@/shared/ui/Field";
import { CountryPicker } from "@/shared/ui/CountryPicker";
import { useSessionOperationScope } from "@/app/sessionOperation";
import { InternationalPhoneField } from "@/shared/ui/InternationalPhoneField";
import { phoneError, normalizePhonePresentation, normalizePersonName, recipientError } from "@/shared/validation/person";
import { TransactionButtonLabel } from "@/shared/ui/TransactionButtonLabel";

const required = (label: string, max: number) => z.string().trim()
  .min(1, `Escribe ${label}.`)
  .max(max, `Usa como máximo ${max} caracteres.`);
const optional = (max: number) => z.string().trim().max(max, `Usa como máximo ${max} caracteres.`);

// Mirrors AddressRequest in the OpenAPI contract; PostgreSQL remains the authority.
const addressSchema = z.object({
  recipient: z.string().optional().superRefine((value,context) => {
    if(value===undefined) return;
    const message=recipientError(value);
    if(message) context.addIssue({code:"custom",message});
  }),
  alias: required("un nombre para la dirección", 80),
  line1: required("la dirección", 200),
  line2: optional(200),
  city: required("la ciudad", 100),
  province: required("la provincia", 100),
  countryCode: z.string().trim().length(2, "Elige un país."),
  postalCode: optional(20),
  reference: optional(300),
  phone: z.string().trim().min(1, "Escribe un teléfono de contacto."),
  makePrimary: z.boolean(),
});

type AddressValues = z.infer<typeof addressSchema>;

const fields: { name: Exclude<keyof AddressValues, "makePrimary" | "countryCode" | "phone" | "recipient">; label: string; optional?: boolean; autoComplete?: string; inputMode?: "tel" | "text" }[] = [
  { name: "alias", label: "Nombre de la dirección" },
  { name: "line1", label: "Dirección", autoComplete: "address-line1" },
  { name: "city", label: "Ciudad", autoComplete: "address-level2" },
  { name: "province", label: "Provincia", autoComplete: "address-level1" },
];

const optionalFields: typeof fields = [
  { name: "line2", label: "Piso, departamento u oficina", optional: true, autoComplete: "address-line2" },
  { name: "postalCode", label: "Código postal", optional: true, autoComplete: "postal-code" },
  { name: "reference", label: "Referencia para la entrega", optional: true },
];

export function AddressForm({
  firstAddress,
  onSaved,
  onCancel,
  onUncertain,
  onSessionExpired,
  address,
  focusOnMount = false,
  disabled = false,
  onStateChange,
}: {
  firstAddress: boolean;
  onSaved: (addressId: string) => Promise<void> | void;
  onCancel?: () => void;
  onUncertain: () => Promise<void> | void;
  onSessionExpired: () => void;
  address?: CustomerAddress;
  focusOnMount?: boolean;
  disabled?: boolean;
  /** Lets a host surface (the Direcciones editor) guard its own close: unsaved input, or a request in flight. */
  onStateChange?: (state: { dirty: boolean; busy: boolean }) => void;
}) {
  const { session } = useSession();
  const actor = session!.user.userId;
  const scope = useSessionOperationScope(address?.addressId ?? "new-address");
  const [recovery] = useState(() => {
    try { return { key: address ? null : readPendingAttempt("address", actor), error: null }; }
    catch (error) { return { key: null, error: (error as Error).message }; }
  });
  const [pendingKey, setPendingKey] = useState<string | null>(recovery.key);
  const keyRef = useRef<string | null>(recovery.key);
  const [resolving, setResolving] = useState(false);
  const externallyDisabled = disabled;
  disabled = disabled || Boolean(pendingKey) || Boolean(recovery.error);
  const lock = useRef(false);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const optionalDetailsRef = useRef<HTMLDetailsElement>(null);
  const problemRef = useRef<HTMLParagraphElement>(null);
  const [showRecipient, setShowRecipient] = useState(false);
  const [invalidFocus, setInvalidFocus] = useState<keyof AddressValues | null>(null);
  const [detailsOpen, setDetailsOpen] = useState(Boolean(address?.line2 || address?.postalCode || address?.reference));
  const [problem, setProblem] = useState<string | null>(recovery.error ?? (recovery.key ? "Hay una dirección pendiente de confirmar. Consulta el resultado antes de crear otra." : null));
  const countries = useCountries();
  const initialPhoneCountry = parsePhoneNumberFromString(address?.phone ?? "")?.country
    ?? (address?.countryCode && isSupportedCountry(address.countryCode) ? address.countryCode : "EC");
  const [phoneCountry, setPhoneCountry] = useState<CountryCode>(initialPhoneCountry as CountryCode);
  const profile = useQuery({ queryKey: profileQueryKey, queryFn: ({ signal }) => getProfile(signal), staleTime: 60_000, meta: { authRequired: true } });
  useEffect(() => { if (focusOnMount) headingRef.current?.focus({ preventScroll: true }); }, [focusOnMount]);
  const {
    register,
    handleSubmit,
    watch,
    setError,
    setFocus,
    setValue,
    formState: { errors, isSubmitting, isDirty },
  } = useForm<AddressValues>({
    resolver: zodResolver(addressSchema),
    defaultValues: {
      alias: address?.alias ?? (firstAddress ? "Casa" : ""),
      line1: address?.line1 ?? "",
      line2: address?.line2 ?? "",
      city: address?.city ?? "",
      province: address?.province ?? "",
      countryCode: address?.countryCode ?? "EC",
      postalCode: address?.postalCode ?? "",
      reference: address?.reference ?? "",
      phone: address?.phone ?? "",
      makePrimary: address?.primary ?? firstAddress,
    },
  });
  // The problem is reported above the fields: bring it into view when the form has been scrolled past it.
  useEffect(() => { if (problem) problemRef.current?.scrollIntoView?.({ block: "nearest" }); }, [problem]);
  const countryCode = watch("countryCode") as CountryCode;
  const busy = isSubmitting || resolving;
  useLayoutEffect(() => {
    if (!invalidFocus || busy || disabled || !scope.isCurrent()) return;
    const control = document.getElementById(`address-${invalidFocus}`);
    if (!control || (control instanceof HTMLInputElement && control.disabled)) return;
    if (invalidFocus === "phone" || invalidFocus === "countryCode") control.focus();
    else setFocus(invalidFocus);
    setInvalidFocus(null);
  }, [invalidFocus, busy, disabled, scope, setFocus, showRecipient, detailsOpen]);
  useEffect(() => { onStateChange?.({ dirty: isDirty, busy }); }, [onStateChange, isDirty, busy]);
  const phone = watch("phone");

  useEffect(() => {
    function recover() {
      if (address) return;
      try {
        const key = readPendingAttempt("address", actor);
        if (key && !keyRef.current) { keyRef.current = key; setPendingKey(key); setProblem("Hay una dirección pendiente de confirmar. Consulta el resultado antes de crear otra."); }
      } catch (error) { setProblem((error as Error).message); }
    }
    window.addEventListener("storage", recover);
    return () => window.removeEventListener("storage", recover);
  }, [actor, address]);

  async function consultResult() {
    if (lock.current || externallyDisabled || !keyRef.current || !scope.isCurrent()) return;
    lock.current = true; setResolving(true);
    const key = keyRef.current;
    try {
      const result = await resolveAddress(key);
      if (!scope.isCurrent()) return;
      if (result.state === "PENDING") { setProblem("La dirección sigue pendiente de confirmar. Consulta el resultado en unos momentos; no hace falta volver a guardarla."); return; }
      clearPendingAttempt("address", actor, key);
      keyRef.current = null; setPendingKey(null);
      if (result.state === "CREATED") { await onSaved(result.addressId); return; }
      setProblem("Confirmamos que este intento no guardó ninguna dirección y lo cerramos. Puedes revisar los datos y guardarla de nuevo.");
    } catch (error) {
      if (!scope.isCurrent()) return;
      if (error instanceof ApiRequestError && error.status === 401) onSessionExpired();
      else setProblem("Todavía no pudimos confirmar si se guardó la dirección. Comprueba tu conexión y consulta el resultado otra vez.");
    } finally { lock.current = false; setResolving(false); }
  }

  // Rendered outside the checkout <form>, so it submits through its own handler.
  const save = handleSubmit(async (values) => {
    if (lock.current || disabled || !scope.isCurrent()) return;
    const phoneProblem=phoneError(values.phone,true);
    if (phoneProblem) {
      setError("phone", { message: phoneProblem }, { shouldFocus: true });
      requestAnimationFrame(() => document.getElementById("address-phone")?.focus());
      return;
    }
    if (!countries.data?.some((country) => country.code === values.countryCode)) {
      setError("countryCode", { message: "Elige un país de la lista." }, { shouldFocus: true });
      return;
    }
    const recipient=normalizePersonName(values.recipient ?? address?.recipient ?? [profile.data?.firstNames,profile.data?.lastNames].filter(Boolean).join(" "));
    const recipientProblem=recipientError(recipient);
    if(recipientProblem) {
      setShowRecipient(true); setValue("recipient",recipient);
      setError("recipient",{type:"validate",message:recipientProblem});
      requestAnimationFrame(() => setFocus("recipient")); return;
    }
    lock.current = true;
    setProblem(null);
    try {
      const body = {
        alias: values.alias,
        recipient,
        line1: values.line1,
        countryCode: values.countryCode.toUpperCase(),
        city: values.city,
        province: values.province,
        phone: normalizePhonePresentation(values.phone),
        line2: values.line2 || null,
        postalCode: values.postalCode || null,
        reference: values.reference || null,
      };
      if (!address) {
        const existing = readPendingAttempt("address", actor);
        if (existing) { keyRef.current = existing; setPendingKey(existing); setProblem("Consulta el resultado de la dirección pendiente antes de crear otra."); return; }
        keyRef.current = await beginPendingAttempt("address", actor);
        scope.assertCurrent();
        setPendingKey(keyRef.current);
      }
      const addressId = address?.addressId ?? (await createAddress({ ...body, makePrimary: values.makePrimary }, keyRef.current!)).addressId;
      if (!scope.isCurrent()) return;
      if (!address && keyRef.current) {
        clearPendingAttempt("address", actor, keyRef.current);
        keyRef.current = null; setPendingKey(null);
      }
      if (address) await updateAddress(addressId, body);
      if (!scope.isCurrent()) return;
      await onSaved(addressId);
    } catch (error) {
      if (!scope.isCurrent()) return;
      if (error instanceof ApiRequestError && error.status === 401) {
        onSessionExpired();
      } else if (error instanceof ApiRequestError && error.status < 500) {
        if (!address && keyRef.current && error.code !== "P1010") {
          clearPendingAttempt("address", actor, keyRef.current);
          keyRef.current = null; setPendingKey(null);
        }
        const wireFields=(["recipient","alias","line1","line2","city","province","countryCode","postalCode","reference","phone"] as const);
        const invalidFields=wireFields.filter((field) => {
          const message=fieldErrorMessages(error,field);
          if(message) setError(field,{type:"server",message});
          return Boolean(message);
        });
        if(invalidFields.length) {
          if(invalidFields.includes("recipient")) { setShowRecipient(true); setValue("recipient",recipient); }
          if(optionalFields.some((field) => invalidFields.includes(field.name))) {
            if(optionalDetailsRef.current) optionalDetailsRef.current.open=true;
            setDetailsOpen(true);
          }
          setInvalidFocus(invalidFields[0]);
          return;
        }
        if (error.status === 404 || error.status === 409) await onUncertain();
        if (!scope.isCurrent()) return;
        setProblem(`${error.title}. ${error.detail}`);
      } else {
        // Retain the persisted key; only the exact attempt resolver can confirm absence.
        await onUncertain();
        if (!scope.isCurrent()) return;
        setProblem(error instanceof AddressOutcomeUnknown || keyRef.current
          ? "No pudimos confirmar si se guardó la dirección. Consulta el resultado antes de crear otra."
          : "No pudimos confirmar si se guardaron los cambios. Revisa la lista de direcciones antes de volver a enviarlos.");
      }
    } finally {
      lock.current = false;
    }
  }, (invalid) => {
    const hiddenInvalid = optionalFields.find((field) => invalid[field.name]);
    const details = optionalDetailsRef.current;
    if (!hiddenInvalid || !details || details.open) return;
    // Open synchronously before RHF's focus attempt; repeat focus after rendering
    // so the error description is available and the field can be scrolled into view.
    details.open = true;
    setDetailsOpen(true);
    requestAnimationFrame(() => setFocus(hiddenInvalid.name));
  });

  return (
    <form
      className="address-form"
      onSubmit={save}
      noValidate
      role="group"
      aria-labelledby="address-form-heading"
    >
      <h3 ref={headingRef} tabIndex={-1} id="address-form-heading" data-autofocus={focusOnMount || undefined}>{address ? `Editar ${address.alias}` : "Nueva dirección"}</h3>
      {problem && <p
        ref={problemRef}
        className="purchase-notice purchase-notice--error"
        role="alert"
      >{problem}</p>}
      {showRecipient && <Field controlId="address-recipient" label="Quién recibe el pedido">
        <input id="address-recipient" type="text" disabled={disabled} aria-invalid={Boolean(errors.recipient) || undefined}
          aria-describedby={errors.recipient ? "address-recipient-error" : undefined} {...register("recipient")} />
        {errors.recipient && <FieldMessage id="address-recipient-error" tone="error">{errors.recipient.message}</FieldMessage>}
      </Field>}
      <div className="address-form-grid">
        {fields.map((field) => {
          const error = errors[field.name]?.message;
          const id = `address-${field.name}`;
          return (
            <Field
              key={field.name}
              controlId={id}
              className={field.name === "line1" || field.name === "reference" ? "address-field--wide" : undefined}
              label={<>{field.label}{field.optional && <span className="field-optional"> (opcional)</span>}</>}
            >
              <input
                id={id}
                type="text"
                inputMode={field.inputMode}
                autoComplete={field.autoComplete}
                aria-invalid={Boolean(error) || undefined}
                aria-describedby={error ? `${id}-error` : undefined}
                disabled={disabled}
                {...register(field.name)}
              />
              {error && <FieldMessage id={`${id}-error`} tone="error">{error}</FieldMessage>}
            </Field>
          );
        })}
        <div className="form-field">
          <CountryPicker id="address-countryCode" label="País de entrega" className="delivery-country-trigger" countries={countries.data ?? []} value={countryCode} onChange={(code) => {
            setValue("countryCode", code, { shouldDirty: true, shouldValidate: true });
            if (isSupportedCountry(code)) setPhoneCountry(code as CountryCode);
          }} disabled={disabled || countries.isPending || countries.isError} invalid={Boolean(errors.countryCode)} describedBy={errors.countryCode ? "address-country-error" : undefined} />
          {countries.isError && <FieldMessage tone="error">No pudimos consultar los países. Actualiza la página para continuar.</FieldMessage>}
          {errors.countryCode && <FieldMessage id="address-country-error" tone="error">{errors.countryCode.message}</FieldMessage>}
        </div>
        <Field controlId="address-phone" className="address-field--wide" label="Teléfono de contacto">
          <InternationalPhoneField
            id="address-phone"
            label="Teléfono de contacto"
            countries={countries.data ?? []}
            countryCode={phoneCountry}
            value={phone || undefined}
            onCountryChange={(code) => setPhoneCountry(code as CountryCode)}
            onChange={(value) => setValue("phone", value ?? "", { shouldDirty: true, shouldValidate: true })}
            disabled={disabled || countries.isPending || countries.isError}
            invalid={Boolean(errors.phone)}
            describedBy={errors.phone ? "address-phone-error" : undefined}
          />
          {errors.phone && <FieldMessage id="address-phone-error" tone="error">{errors.phone.message}</FieldMessage>}
        </Field>
      </div>
      <details ref={optionalDetailsRef} className="address-optional-details" open={detailsOpen}
        onToggle={(event) => setDetailsOpen(event.currentTarget.open)}>
        <summary>Agregar detalles de entrega <span>(opcional)</span></summary>
        <div className="address-form-grid">
          {optionalFields.map((field) => {
            const id = `address-${field.name}`;
            const error = errors[field.name]?.message;
            return <Field key={field.name} controlId={id} label={field.label}>
              <input id={id} type="text" autoComplete={field.autoComplete} aria-invalid={Boolean(error) || undefined} aria-describedby={error ? `${id}-error` : undefined} disabled={disabled} {...register(field.name)} />
              {error && <FieldMessage id={`${id}-error`} tone="error">{error}</FieldMessage>}
            </Field>;
          })}
        </div>
      </details>
      {!firstAddress && !address && (
        <label className="checkbox-choice">
          <input type="checkbox" disabled={disabled} {...register("makePrimary")} />
          <span>Usar como dirección principal</span>
        </label>
      )}
      <div className="purchase-actions">
        <Button
          variant="primary"
          type={pendingKey ? "button" : "submit"}
          onClick={pendingKey ? () => void consultResult() : undefined}
          disabled={pendingKey ? externallyDisabled || resolving || isSubmitting : disabled || countries.isPending || countries.isError || (!address && !profile.data)}
          aria-disabled={(pendingKey ? externallyDisabled || resolving || isSubmitting : disabled || isSubmitting || countries.isPending || countries.isError || (!address && !profile.data)) || undefined}
          aria-busy={isSubmitting || resolving || undefined}
        >
          <TransactionButtonLabel
            state={isSubmitting || resolving ? "pending" : "idle"}
            idle={pendingKey ? "Consultar resultado" : "Guardar dirección"}
            pending={resolving ? "Consultando…" : "Guardando…"}
            success="Guardada"
          />
        </Button>
        {onCancel && <Button variant="text" type="button" disabled={Boolean(pendingKey) || isSubmitting} onClick={onCancel}>Cancelar</Button>}
      </div>
    </form>
  );
}
