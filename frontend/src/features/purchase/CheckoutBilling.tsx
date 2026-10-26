import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { useFormState, useWatch, type Control, type FieldErrors, type UseFormClearErrors, type UseFormGetValues, type UseFormRegister, type UseFormSetValue, type UseFormTrigger } from "react-hook-form";
import type { BillingRecipient, CheckoutBillingInput } from "@/shared/api/billing";
import type { CustomerAddress } from "@/shared/api/customer";
import { Button } from "@/components/ui/button";
import { EcuadorianCedulaInput } from "@/shared/ui/EcuadorianCedulaInput";
import { IdentificationStatus, identificationInvalid } from "@/shared/ui/IdentificationStatus";
import { PersonNameInput } from "@/shared/ui/PersonNameInput";
import { FieldMessage } from "@/shared/ui/Field";
import { MaterialSymbol } from "@/shared/ui/MaterialSymbol";
import { ProvinceCityFields } from "@/shared/ui/ProvinceCityFields";
import { identificationError, identificationType, isValidIdentification, normalizeIdentification } from "@/shared/validation/identification";
import classes from "./purchaseFlow.module.css";

/** Where the invoice address comes from. Only "other" asks the customer to type an address. */
export type BillingSource = { kind: "delivery" } | { kind: "saved"; addressId: string } | { kind: "other" };
type BillingAddressValues = CheckoutBillingInput["billingAddress"];
const emptyAddress: BillingAddressValues = { line1: "", line2: "", provinceId: "", cityId: "", countryCode: "EC", postalCode: "" };

/** An address the invoice can reuse: its city is in the catalog (ADR 0044). An older unmatched one is never offered. */
export function isBillable(address: CustomerAddress | null | undefined): address is CustomerAddress {
  return Boolean(address && address.provinceId && address.cityId && !address.cityNeedsReview);
}
function fromSaved(address: CustomerAddress): BillingAddressValues {
  return { line1: address.line1, line2: address.line2 ?? "", provinceId: address.provinceId ?? "", cityId: address.cityId ?? "", countryCode: "EC", postalCode: address.postalCode ?? "" };
}
function addressLines(address: Pick<CustomerAddress, "line1" | "line2" | "city" | "province">) {
  return [[address.line1, address.line2].filter(Boolean).join(", "), [address.city, address.province].filter(Boolean).join(", ")].filter(Boolean);
}

/**
 * The invoice is resolved from what PLIEGO already knows; the customer types only what is missing.
 * - Default source: the delivery address for home delivery; otherwise the primary saved address; with neither,
 *   a short address form (street, then province and city from the INEC catalog; complement and postal code on
 *   request). An older saved address whose city is not in the catalog is never reused for the invoice.
 * - The cédula or RUC is the profile's. Without one, its single field is shown inline and the purchase saves it
 *   to the profile — said where it is typed, never silent. The buyer name starts as the profile's; changing it
 *   affects this invoice only.
 * - "Otra persona o empresa" (ADR 0043) keeps name and number together as one recipient for this invoice only:
 *   the account's identification is neither used nor changed, and nothing is saved to the profile.
 * Once resolved the decision reads as plain lines, like "Entregar en", with one way to change it.
 */
export function useBillingSource(savedAddresses: CustomerAddress[] | undefined, delivery: CustomerAddress | null, delivering: boolean) {
  const [chosen, setChosen] = useState<BillingSource>({ kind: "delivery" });
  // Only catalog addresses can be reused; a delivery to an older unmatched address bills to another one.
  const addresses = savedAddresses?.filter(isBillable);
  const deliveryAddress = isBillable(delivery) ? delivery : null;
  const homeDelivery = delivering && (!delivery || deliveryAddress !== null);
  const primary = addresses?.find(address => address.primary) ?? addresses?.[0] ?? null;
  // A source that no longer applies (pickup instead of delivery, a removed address) falls back without being forgotten.
  const effective: BillingSource =
    // For home delivery the invoice waits for the delivery address instead of asking for a second one.
    chosen.kind === "delivery" ? (deliveryAddress || homeDelivery ? chosen : primary ? { kind: "saved", addressId: primary.addressId } : { kind: "other" })
    : chosen.kind === "saved" ? (addresses?.some(address => address.addressId === chosen.addressId) ? chosen : deliveryAddress ? { kind: "delivery" } : primary ? { kind: "saved", addressId: primary.addressId } : { kind: "other" })
    : chosen;
  const resolved = effective.kind === "delivery" ? deliveryAddress
    : effective.kind === "saved" ? addresses?.find(address => address.addressId === effective.addressId) ?? null : null;
  /** Home delivery with no delivery address yet: the invoice will use it once it exists. */
  const awaitingDelivery = effective.kind === "delivery" && !deliveryAddress;
  return { chosen, setChosen, effective, resolved, awaitingDelivery };
}

export function CheckoutBilling({ register, control, errors, setValue, getValues, trigger, clearErrors, accountName, disabled, registeredNumber, identityPending, profilePending, addresses, addressesPending, deliveryAddress, source, openRequest }: {
  register: UseFormRegister<CheckoutBillingInput>;
  control: Control<CheckoutBillingInput>;
  errors: FieldErrors<CheckoutBillingInput>;
  setValue: UseFormSetValue<CheckoutBillingInput>;
  getValues: UseFormGetValues<CheckoutBillingInput>;
  trigger: UseFormTrigger<CheckoutBillingInput>;
  clearErrors: UseFormClearErrors<CheckoutBillingInput>;
  /** The profile's full name: the account holder's invoice name when switching back from another recipient. */
  accountName: string;
  disabled: boolean;
  registeredNumber: string | null;
  identityPending: boolean;
  profilePending: boolean;
  addresses: CustomerAddress[] | undefined;
  addressesPending: boolean;
  deliveryAddress: CustomerAddress | null;
  source: ReturnType<typeof useBillingSource>;
  /** Incremented by the page when a submit finds an invoice field to fix: the details open to show it. */
  openRequest: number;
}) {
  const [editing, setEditing] = useState(false);
  const [showOptional, setShowOptional] = useState(false);
  const draft = useRef<BillingAddressValues>(emptyAddress);
  const { effective, resolved, setChosen, awaitingDelivery } = source;
  const billableAddresses = addresses?.filter(isBillable);
  const billableDelivery = isBillable(deliveryAddress) ? deliveryAddress : null;
  const otherAddress = effective.kind === "other";

  // Keep the form's invoice address equal to the chosen source; a typed "other" address survives switching away.
  const resolvedKey = resolved ? `${resolved.addressId}:${resolved.line1}:${resolved.cityId}` : "other";
  const lastKind = useRef(effective.kind);
  useEffect(() => {
    if (lastKind.current === "other" && !otherAddress) draft.current = getValues("billingAddress");
    lastKind.current = effective.kind;
    if (resolved) setValue("billingAddress", fromSaved(resolved));
    else setValue("billingAddress", draft.current);
  }, [resolvedKey, otherAddress, effective.kind, resolved, setValue, getValues]);

  useEffect(() => { if (openRequest) setEditing(true); }, [openRequest]);
  const hasAddressError = Boolean(errors.billingAddress);
  useEffect(() => { if (hasAddressError && otherAddress) setShowOptional(current => current || Boolean(errors.billingAddress?.line2 || errors.billingAddress?.postalCode)); }, [hasAddressError, otherAddress, errors.billingAddress?.line2, errors.billingAddress?.postalCode]);

  // Identification: the profile's, fixed here; or one field, judged live, saved to the profile with the purchase.
  const number = useWatch({ control, name: "billingIdentity.number" }) ?? "";
  const buyerNameValue = useWatch({ control, name: "buyerName" }) ?? "";
  const { submitCount, touchedFields } = useFormState({ control });
  const [typing, setTyping] = useState(false);
  const [numberRejection, setNumberRejection] = useState<string | null>(null);
  useEffect(() => setTyping(false), [submitCount]);
  const numberField = register("billingIdentity.number");
  const serverError = errors.billingIdentity?.number?.type === "server" ? errors.billingIdentity.number.message : null;
  const judged = !typing && (Boolean(touchedFields.billingIdentity?.number) || submitCount > 0);
  const numberError = numberRejection ?? serverError ?? (judged ? identificationError(number) : null);
  const registeredInvalid = registeredNumber !== null && !isValidIdentification(identificationType(registeredNumber), registeredNumber);
  const kind = (value: string) => normalizeIdentification(value).length === 13 ? "RUC" : "Cédula";

  const [nameRejection, setNameRejection] = useState<string | null>(null);
  const buyerName = register("buyerName");
  const buyerNameError = nameRejection ?? errors.buyerName?.message;
  const nameOpen = editing || Boolean(buyerNameError) || (!profilePending && !buyerNameValue.trim());

  // Who the invoice is for. Each recipient keeps what was typed for it while the customer compares the two.
  const recipient: BillingRecipient = useWatch({ control, name: "billingRecipient" }) ?? "ACCOUNT";
  const other = recipient === "OTHER";
  const drafts = useRef<Record<BillingRecipient, { name: string; number: string } | null>>({ ACCOUNT: null, OTHER: null });
  function chooseRecipient(next: BillingRecipient) {
    if (next === recipient) return;
    drafts.current[recipient] = { name: getValues("buyerName"), number: getValues("billingIdentity.number") };
    const draft = drafts.current[next];
    setValue("billingRecipient", next);
    if (next === "OTHER") {
      setValue("buyerName", draft?.name ?? "", { shouldDirty: true });
      setValue("billingIdentity.number", draft?.number ?? "");
    } else {
      // The account holder's number is the profile's whenever there is one.
      setValue("buyerName", draft?.name || accountName);
      setValue("billingIdentity.number", registeredNumber ?? draft?.number ?? "");
    }
    setNameRejection(null);
    setNumberRejection(null);
    setTyping(false);
    clearErrors(["buyerName", "billingIdentity.number"]);
  }
  /** Another recipient's number reads as a line once typed and valid; its field returns while editing or wrong. */
  const otherNumberOpen = editing || Boolean(numberError) || !number.trim();

  async function done() {
    const fields = ["buyerName", ...(other ? ["billingIdentity.number"] as const : []), ...(otherAddress ? ["billingAddress.line1", "billingAddress.line2", "billingAddress.provinceId", "billingAddress.cityId", "billingAddress.postalCode"] as const : [])] as const;
    if (!(await trigger(fields as unknown as Parameters<typeof trigger>[0]))) {
      document.querySelector<HTMLElement>('#checkout-billing [aria-invalid="true"]')?.focus();
      return;
    }
    setEditing(false);
    requestAnimationFrame(() => document.getElementById("checkout-change-billing")?.focus());
  }

  const sourceOptions: { value: string; label: string; lines: string[] }[] = [
    ...(billableDelivery || awaitingDelivery ? [{ value: "delivery", label: "Misma dirección de entrega", lines: billableDelivery ? addressLines(billableDelivery) : [] }] : []),
    ...(billableAddresses ?? []).filter(address => address.addressId !== billableDelivery?.addressId)
      .map(address => ({ value: `saved:${address.addressId}`, label: address.alias, lines: addressLines(address) })),
    { value: "other", label: "Otra dirección", lines: [] },
  ];
  const sourceValue = effective.kind === "saved" ? `saved:${effective.addressId}` : effective.kind;
  const addressFieldsOpen = otherAddress && (editing || !resolved);
  const optionalFields = [{ name: "line2", label: "Complemento (opcional)", max: 200, autoComplete: "address-line2" }, { name: "postalCode", label: "Código postal (opcional)", max: 20, autoComplete: "postal-code" }] as const;
  const requiredFields = [{ name: "line1", label: "Dirección", max: 200, autoComplete: "address-line1" }] as const;
  const billingProvinceId = useWatch({ control, name: "billingAddress.provinceId" }) ?? "";
  const billingCityId = useWatch({ control, name: "billingAddress.cityId" }) ?? "";
  const field = (item: (typeof requiredFields)[number] | (typeof optionalFields)[number]) => {
    const error = errors.billingAddress?.[item.name];
    return <div className={`form-field ${item.name === "line1" || item.name === "line2" ? classes.wide : ""}`} key={item.name}>
      <label htmlFor={`billing-${item.name}`}>{item.label}</label>
      <input id={`billing-${item.name}`} {...register(`billingAddress.${item.name}`)} maxLength={item.max} autoComplete={`billing ${item.autoComplete}`}
        aria-invalid={Boolean(error) || undefined} aria-describedby={error ? `billing-${item.name}-error` : undefined} />
      {error && <FieldMessage id={`billing-${item.name}-error`} tone="error">{error.message}</FieldMessage>}
    </div>;
  };

  return <section id="checkout-billing" className={`${classes.panel} ${classes.fieldError} ${classes.billing}`} aria-labelledby="checkout-billing-heading">
    <fieldset disabled={disabled} className={classes.billingSet}>
      <div className={classes.panelHead}>
        <h2 id="checkout-billing-heading">Factura</h2>
        {!editing && <button type="button" id="checkout-change-billing" className={classes.linkAction} onClick={() => {
          setEditing(true);
          // The button leaves with the summary: focus moves into the details it opened, starting with who it is for.
          requestAnimationFrame(() => document.querySelector<HTMLElement>('#checkout-billing input[name="billing-recipient"]:checked')?.focus());
        }}>Cambiar datos de factura</button>}
      </div>

      {/* Who it is for: asked only once the customer opens the details; the account holder by default. */}
      {editing && <fieldset className={`${classes.choices} ${classes.billingChoices}`}>
        <legend className={classes.billingLegend}>La factura es para</legend>
        {([["ACCOUNT", "Para mí", "Con tu cédula o RUC del perfil."], ["OTHER", "Otra persona o empresa", "Solo esta factura; tu perfil no cambia."]] as const).map(([value, label, line]) =>
          <label key={value} className={classes.choice}>
            <input type="radio" name="billing-recipient" value={value} checked={recipient === value} onChange={() => chooseRecipient(value)} />
            <span className={classes.choiceCopy}><strong>{label}</strong><span>{line}</span></span>
          </label>)}
      </fieldset>}

      {/* Who the invoice is for: plain lines once known, a field only for what is missing. */}
      {profilePending && !nameOpen && !other ? <p className={classes.status} role="status">Consultando tus datos…</p> : nameOpen ? <div className="form-field">
        <label htmlFor="billing-buyer">{other ? "Nombre o razón social" : "Nombre para la factura"}</label>
        {other
          // A company name keeps its digits and punctuation; the account holder's stays a person's name.
          ? <input id="billing-buyer" type="text" autoComplete="off" maxLength={240} {...buyerName}
            aria-invalid={Boolean(buyerNameError) || undefined} aria-describedby={buyerNameError ? "billing-buyer-error" : undefined} />
          : <PersonNameInput id="billing-buyer" autoComplete="name" {...buyerName} onInputRejected={setNameRejection}
            onChange={event => { setNameRejection(null); void buyerName.onChange(event); }}
            aria-invalid={Boolean(buyerNameError) || undefined}
            aria-describedby={buyerNameError ? "billing-buyer-error" : "billing-buyer-help"} />}
        {buyerNameError ? <FieldMessage id="billing-buyer-error" tone="error">{buyerNameError}</FieldMessage>
          : !other && <FieldMessage id="billing-buyer-help" tone="help">Solo para esta factura; tu perfil no cambia.</FieldMessage>}
      </div> : <div className={classes.billingRow}>
        <span className={classes.billingLabel}>A nombre de</span>
        <span className={classes.billingValue}>{buyerNameValue}</span>
        {other && <span className={classes.billingNote}>Otra persona o empresa · solo esta factura</span>}
      </div>}

      {identityPending && !other ? <p className={classes.status} role="status">Consultando tu identificación…</p>
        : other && !otherNumberOpen ? <div className={classes.billingRow}>
          <span className={classes.billingLabel}>{kind(number)}</span>
          <span className={classes.billingValue}>{normalizeIdentification(number)}</span>
        </div>
        : !other && registeredNumber !== null ? <>
          <input type="hidden" {...numberField} />
          <div className={classes.billingRow}>
            <span className={classes.billingLabel}>{kind(registeredNumber)}</span>
            <span className={classes.billingValue}>{registeredNumber}</span>
            {registeredInvalid
              ? <span className={classes.billingFix} role="alert">No es válida. <Link to="/account">Corrígela en Mi perfil</Link> para poder comprar.</span>
              : editing && <span className={classes.billingNote}>Se corrige en <Link to="/account">Mi perfil</Link>.</span>}
          </div>
        </>
        : <div className="form-field">
          <label htmlFor="billing-cedula">Cédula o RUC</label>
          <EcuadorianCedulaInput id="billing-cedula" {...numberField} aria-required="true"
            onInputRejected={setNumberRejection}
            onChange={event => { setTyping(true); setNumberRejection(null); void numberField.onChange(event); }}
            onBlur={event => { setTyping(false); void numberField.onBlur(event); }}
            aria-invalid={identificationInvalid(number, numberError) || undefined}
            aria-describedby="billing-cedula-status billing-cedula-save" />
          <IdentificationStatus id="billing-cedula-status" value={number} error={numberError} />
          <span id="billing-cedula-save" className="field-help">{other ? "Solo para esta factura; no se guarda en tu perfil." : "La guardaremos en tu perfil para tus próximas compras."}</span>
        </div>}

      {/* Where the invoice goes: the delivery address by default; a choice only when asked for. */}
      {editing ? <fieldset className={`${classes.choices} ${classes.billingChoices}`}>
        <legend className={classes.billingLegend}>Dirección de facturación</legend>
        {sourceOptions.map(option => <label key={option.value} className={classes.choice}>
          <input type="radio" name="billing-source" value={option.value} checked={sourceValue === option.value}
            onChange={() => setChosen(option.value === "delivery" ? { kind: "delivery" } : option.value === "other" ? { kind: "other" } : { kind: "saved", addressId: option.value.slice(6) })} />
          <span className={classes.choiceCopy}>
            <strong>{option.label}</strong>
            {option.lines.map(line => <span key={line}>{line}</span>)}
          </span>
        </label>)}
      </fieldset> : addressesPending && !resolved && !otherAddress ? <p className={classes.status} role="status">Consultando tus direcciones…</p>
        : (awaitingDelivery || resolved) && <div className={classes.billingRow}>
          <span className={classes.billingLabel}>Dirección de facturación</span>
          {effective.kind === "delivery"
            // Reused, not retyped: one chip says so at a glance; the short address says which one.
            ? <span className={classes.billingValue}>
              <span className={classes.billingChip}><MaterialSymbol name="local_shipping" aria-hidden="true" size={16} />Igual que la entrega</span>
              <span className={classes.billingShort}>{resolved ? [resolved.line1, resolved.city].filter(Boolean).join(", ") : "Elige primero dónde entregar."}</span>
            </span>
            : resolved && <span className={classes.billingValue}>
              <span className={classes.billingChip}><MaterialSymbol name="home" aria-hidden="true" size={16} />{resolved.alias || "Dirección guardada"}</span>
              <span className={classes.billingShort}>{[resolved.line1, resolved.city].filter(Boolean).join(", ")}</span>
            </span>}
        </div>}

      {addressFieldsOpen && <fieldset className={classes.billingFields}>
        <legend className={editing ? "visually-hidden" : classes.billingLegend}>Dirección de facturación</legend>
        {requiredFields.map(field)}
        <ProvinceCityFields idPrefix="billing" provinceId={billingProvinceId} cityId={billingCityId} disabled={disabled}
          provinceError={errors.billingAddress?.provinceId?.message} cityError={errors.billingAddress?.cityId?.message}
          onChange={(next) => {
            setValue("billingAddress.provinceId", next.provinceId, { shouldDirty: true });
            setValue("billingAddress.cityId", next.cityId, { shouldDirty: true });
            clearErrors(next.cityId ? ["billingAddress.provinceId", "billingAddress.cityId"] : "billingAddress.provinceId");
          }} />
        {showOptional ? optionalFields.map(field)
          : <button type="button" className={`${classes.linkAction} ${classes.wide}`} onClick={() => { setShowOptional(true); requestAnimationFrame(() => document.getElementById("billing-line2")?.focus()); }}>Añadir complemento o código postal</button>}
      </fieldset>}

      {editing && <div className={classes.billingDone}>
        <Button type="button" variant="secondary" onClick={() => void done()}>Usar estos datos</Button>
      </div>}
      <input type="hidden" {...register("billingAddress.countryCode")} />
      <input type="hidden" {...register("billingIdentity.type")} />
      <input type="hidden" {...register("billingRecipient")} />
    </fieldset>
  </section>;
}
