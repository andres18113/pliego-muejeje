import { useState } from "react";
import type { FieldErrors, UseFormRegister } from "react-hook-form";
import type { CheckoutBilling } from "@/shared/api/billing";
import { EcuadorianCedulaInput } from "@/shared/ui/EcuadorianCedulaInput";
import { PersonNameInput } from "@/shared/ui/PersonNameInput";
import { FieldMessage } from "@/shared/ui/Field";

export function BillingIdentityForm({register, errors, disabled}: {register:UseFormRegister<CheckoutBilling>;errors:FieldErrors<CheckoutBilling>;disabled:boolean}) {
  const [nameRejection, setNameRejection] = useState<string | null>(null);
  const buyerName = register("buyerName");
  const buyerNameError = nameRejection ?? errors.buyerName?.message;
  const addressFields = [{name:"line1",label:"Dirección de facturación",max:200},{name:"line2",label:"Complemento de facturación (opcional)",max:200},{name:"city",label:"Ciudad de facturación",max:100},{name:"province",label:"Provincia de facturación",max:100},{name:"postalCode",label:"Código postal de facturación (opcional)",max:20}] as const;
  return <fieldset disabled={disabled} aria-describedby="billing-purpose" style={{border:0,padding:0,margin:"0 0 2rem",minWidth:0}}>
    <legend><h2>Datos para la factura</h2></legend>
    <p id="billing-purpose">Confirma los datos del comprador. La dirección de facturación es independiente de la entrega, incluso para retiro y libros digitales.</p>
    <div className="form-field">
      <label htmlFor="billing-buyer">Nombre para la factura</label>
      <PersonNameInput id="billing-buyer" {...buyerName} onInputRejected={setNameRejection}
        onChange={event => { setNameRejection(null); void buyerName.onChange(event); }}
        aria-invalid={Boolean(buyerNameError) || undefined}
        aria-describedby={buyerNameError ? "billing-buyer-error" : undefined} />
      {buyerNameError && <FieldMessage id="billing-buyer-error" tone="error">{buyerNameError}</FieldMessage>}
    </div>
    <input type="hidden" {...register("billingIdentity.type")}/>
    <div className="form-field"><label htmlFor="billing-cedula">Cédula</label><EcuadorianCedulaInput id="billing-cedula" {...register("billingIdentity.number")} aria-invalid={Boolean(errors.billingIdentity?.number) || undefined} aria-describedby={errors.billingIdentity?.number ? "billing-cedula-error" : "billing-cedula-help"}/>{errors.billingIdentity?.number ? <FieldMessage id="billing-cedula-error" tone="error">{errors.billingIdentity.number.message}</FieldMessage> : <FieldMessage id="billing-cedula-help" tone="help">Formato y dígito verificador; no acredita titularidad.</FieldMessage>}</div>
    {addressFields.map(field => {
      const error=errors.billingAddress?.[field.name];
      return <div className="form-field" key={field.name}><label htmlFor={`billing-${field.name}`}>{field.label}</label><input id={`billing-${field.name}`} {...register(`billingAddress.${field.name}`)} maxLength={field.max} aria-invalid={Boolean(error) || undefined} aria-describedby={error ? `billing-${field.name}-error` : undefined}/>{error && <FieldMessage id={`billing-${field.name}-error`} tone="error">{error.message}</FieldMessage>}</div>;
    })}
    <input type="hidden" {...register("billingAddress.countryCode")}/>
    <p>País de facturación: Ecuador</p>
    <p>SIMULACIÓN ACADÉMICA — SIN VALIDEZ TRIBUTARIA</p>
  </fieldset>;
}
