import { zodResolver } from "@hookform/resolvers/zod";
import { useEffect, useRef, useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { isSupportedCountry, parsePhoneNumberFromString, type CountryCode } from "libphonenumber-js/min";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { createAddress, getProfile, profileQueryKey, updateAddress, type CustomerAddress } from "@/shared/api/customer";
import { ApiRequestError } from "@/shared/api/errors";
import { useCountries } from "@/shared/api/reference";
import { Field, FieldMessage } from "@/shared/ui/Field";
import { CountryPicker } from "@/shared/ui/CountryPicker";
import { InternationalPhoneField, isValidPhoneNumber } from "@/shared/ui/InternationalPhoneField";
import { TransactionButtonLabel } from "@/shared/ui/TransactionButtonLabel";

const required = (label: string, max: number) => z.string().trim()
  .min(1, `Escribe ${label}.`)
  .max(max, `Usa como máximo ${max} caracteres.`);
const optional = (max: number) => z.string().trim().max(max, `Usa como máximo ${max} caracteres.`);

// Mirrors AddressRequest in the OpenAPI contract; PostgreSQL remains the authority.
const addressSchema = z.object({
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

const fields: { name: Exclude<keyof AddressValues, "makePrimary" | "countryCode" | "phone">; label: string; optional?: boolean; autoComplete?: string; inputMode?: "tel" | "text" }[] = [
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
}: {
  firstAddress: boolean;
  onSaved: (addressId: string) => Promise<void> | void;
  onCancel?: () => void;
  onUncertain: () => Promise<void> | void;
  onSessionExpired: () => void;
  address?: CustomerAddress;
  focusOnMount?: boolean;
  disabled?: boolean;
}) {
  const lock = useRef(false);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const [problem, setProblem] = useState<string | null>(null);
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
    setValue,
    formState: { errors, isSubmitting },
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
  const countryCode = watch("countryCode") as CountryCode;
  const phone = watch("phone");

  // Rendered outside the checkout <form>, so it submits through its own handler.
  const save = handleSubmit(async (values) => {
    if (lock.current || disabled) return;
    if (!isValidPhoneNumber(values.phone)) {
      setError("phone", { message: "Escribe un número válido para el país elegido." }, { shouldFocus: true });
      requestAnimationFrame(() => document.getElementById("address-phone")?.focus());
      return;
    }
    if (!countries.data?.some((country) => country.code === values.countryCode)) {
      setError("countryCode", { message: "Elige un país de la lista." }, { shouldFocus: true });
      return;
    }
    const recipient = address?.recipient ?? [profile.data?.firstNames, profile.data?.lastNames].filter(Boolean).join(" ").trim();
    if (!recipient) { setProblem("No pudimos consultar tu nombre. Actualiza la página e inténtalo otra vez."); return; }
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
        phone: values.phone,
        line2: values.line2 || null,
        postalCode: values.postalCode || null,
        reference: values.reference || null,
      };
      const addressId = address?.addressId ?? (await createAddress({ ...body, makePrimary: values.makePrimary })).addressId;
      if (address) await updateAddress(addressId, body);
      await onSaved(addressId);
    } catch (error) {
      if (error instanceof ApiRequestError && error.status === 401) {
        onSessionExpired();
      } else if (error instanceof ApiRequestError && error.status < 500) {
        if (error.status === 404 || error.status === 409) await onUncertain();
        setProblem(`${error.title}. ${error.detail}`);
      } else {
        // POST is not idempotent: re-read addresses instead of saving again.
        await onUncertain();
        setProblem("No pudimos confirmar si se guardaron los cambios. Revisa la lista de direcciones antes de volver a enviarlos.");
      }
    } finally {
      lock.current = false;
    }
  });

  return (
    <form
      className="address-form"
      onSubmit={save}
      noValidate
      role="group"
      aria-labelledby="address-form-heading"
    >
      <h3 ref={headingRef} tabIndex={-1} id="address-form-heading">{address ? `Editar ${address.alias}` : "Nueva dirección"}</h3>
      {problem && <p
        className="purchase-notice purchase-notice--error"
        role="alert"
      >{problem}</p>}
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
      <details className="address-optional-details" open={Boolean(address?.line2 || address?.postalCode || address?.reference)}>
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
          type="submit"
          disabled={disabled || countries.isPending || countries.isError || (!address && !profile.data)}
          aria-disabled={disabled || isSubmitting || countries.isPending || countries.isError || (!address && !profile.data) || undefined}
          aria-busy={isSubmitting || undefined}
        >
          <TransactionButtonLabel
            state={isSubmitting ? "pending" : "idle"}
            idle="Guardar dirección"
            pending="Guardando…"
            success="Guardada"
          />
        </Button>
        {onCancel && <Button variant="text" type="button" onClick={onCancel}>Cancelar</Button>}
      </div>
    </form>
  );
}
