import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { useFormState, useWatch, type Control, type FieldErrors, type UseFormClearErrors, type UseFormGetValues, type UseFormRegister, type UseFormSetValue, type UseFormTrigger } from "react-hook-form";
import type { BillingRecipient, CheckoutBillingInput } from "@/shared/api/billing";
import type { CustomerAddress } from "@/shared/api/customer";
import { Button } from "@/components/ui/button";
import { ChoicePicker } from "@/shared/ui/ChoicePicker";
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
/**
 * Takes the customer to "Entregar en": scrolled clear of the sticky purchase header (measured, it compacts on
 * scroll) and focused on its change action, so one more press opens the saved addresses.
 */
function goToDelivery() {
  const section = document.getElementById("checkout-destination");
  if (!section) return;
  const header = document.querySelector<HTMLElement>("[data-purchase-header]");
  const clearance = (header && getComputedStyle(header).position !== "static" ? header.getBoundingClientRect().height : 0) + 16;
  const reduced = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
  window.scrollTo({ top: Math.max(0, section.getBoundingClientRect().top + window.scrollY - clearance), behavior: reduced ? "auto" : "smooth" });
  // With the saved addresses already open, the chosen one; otherwise the action that opens them.
  const target = section.querySelector<HTMLElement>('input[name="addressId"]:checked') ?? document.getElementById("checkout-change-address") ?? section;
  target.focus({ preventScroll: true, focusVisible: true } as FocusOptions);
}
/** Enough to recognise a saved address: its street and city, never the whole record. */
function shortAddress(address: Pick<CustomerAddress, "line1" | "city">) {
  return [address.line1, address.city].filter(Boolean).join(", ");
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
  // Who the invoice is for. Each recipient keeps what was typed for it while the customer compares the two.
  const recipient: BillingRecipient = useWatch({ control, name: "billingRecipient" }) ?? "ACCOUNT";
  const other = recipient === "OTHER";
  // The account holder's invoice carries the profile's name, like its number: a field only when the profile has none
  // or the server refused it. Another recipient's name is typed while editing and reads as a line once accepted.
  const nameOpen = Boolean(buyerNameError) || (other ? editing || !buyerNameValue.trim() : !profilePending && !buyerNameValue.trim());

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
      setValue("buyerName", accountName || draft?.name || "");
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

  // One compact choice: the delivery (only once there is a valid one — never offered, let alone preselected, before),
  // each other saved address by its alias, and "Otra dirección", the only one that asks for fields.
  const sourceOptions: { value: string; label: string }[] = [
    ...(billableDelivery ? [{ value: "delivery", label: "Igual que la entrega" }] : []),
    ...(billableAddresses ?? []).filter(address => address.addressId !== billableDelivery?.addressId)
      .map(address => ({ value: `saved:${address.addressId}`, label: address.alias || "Dirección guardada" })),
    { value: "other", label: "Otra dirección" },
  ];
  const sourceValue = effective.kind === "saved" ? `saved:${effective.addressId}` : effective.kind;
  // Waiting for the delivery address there is nothing to choose yet; with only "Otra dirección" its fields say it all.
  const sourcePickable = !awaitingDelivery && sourceOptions.length > 1;
  const addressFieldsOpen = otherAddress && (editing || !resolved);
  const optionalFields = [{ name: "line2", label: "Complemento (opcional)", max: 200, autoComplete: "address-line2" }, { name: "postalCode", label: "Código postal (opcional)", max: 20, autoComplete: "postal-code" }] as const;
  const requiredFields = [{ name: "line1", label: "Dirección", max: 200, autoComplete: "address-line1" }] as const;
  const [optionalLine2 = "", optionalPostal = ""] = useWatch({ control, name: ["billingAddress.line2", "billingAddress.postalCode"] }) as (string | null | undefined)[];
  const optionalFilled = Boolean(optionalLine2?.trim() || optionalPostal?.trim());
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

      {/* Who it is for: one two-way switch, asked only once the customer opens the details; the account holder by default.
          Only the chosen side's details follow it. */}
      {editing && <fieldset className={classes.recipientSwitch}>
        <legend className={classes.billingLegend}>Facturar a</legend>
        <div className={classes.recipientOptions}>
          {([["ACCOUNT", "Para mí"], ["OTHER", "Otra persona o empresa"]] as const).map(([value, label]) =>
            <label key={value} className={classes.recipientOption}>
              <input type="radio" name="billing-recipient" value={value} checked={recipient === value} onChange={() => chooseRecipient(value)} />
              <span>{label}</span>
            </label>)}
        </div>
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
            aria-describedby={buyerNameError ? "billing-buyer-error" : undefined} />}
        {buyerNameError && <FieldMessage id="billing-buyer-error" tone="error">{buyerNameError}</FieldMessage>}
      </div> : <div className={classes.billingRow}>
        <span className={classes.billingLabel}>A nombre de</span>
        <span className={classes.billingValue}>{buyerNameValue}</span>
        {other && !editing && <span className={classes.billingNote}>Otra persona o empresa · solo esta factura</span>}
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
              ? <span className={classes.billingFix} role="alert">No es válida. <Link to="/account/identity">Corrígela</Link> para poder comprar.</span>
              : editing && <span className={classes.billingNote}>Tu nombre y {kind(registeredNumber) === "RUC" ? "tu RUC" : "tu cédula"} se corrigen en <Link to="/account">Mi perfil</Link>.</span>}
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
          <span id="billing-cedula-save" className="field-help">{other ? "Solo para esta factura." : "Se guardará en tu perfil."}</span>
        </div>}

      {/* Where the invoice goes: the delivery address by default; a choice only when asked for. */}
      {editing ? sourcePickable && <div className={classes.sourcePick}>
        <span className={classes.billingLegend} aria-hidden="true">Dirección de facturación</span>
        <ChoicePicker label="Dirección de facturación" value={sourceValue} options={sourceOptions}
          onChange={next => setChosen(next === "delivery" ? { kind: "delivery" } : next === "other" ? { kind: "other" } : { kind: "saved", addressId: next.slice(6) })} />
        {/* A saved address is recognised by its street and city: one line, never the whole record. */}
        {effective.kind === "saved" && resolved && <span className={classes.billingShort}>{shortAddress(resolved)}</span>}
      </div> : addressesPending && !resolved && !otherAddress ? <p className={classes.status} role="status">Consultando tus direcciones…</p>
        // Before there is a delivery address the invoice has nothing to say about one: no row until it exists.
        : resolved && <div className={classes.billingRow}>
          <span className={classes.billingLabel}>Dirección de facturación</span>
          {effective.kind === "delivery"
            // Reused, not retyped: "Entregar en" already shows the address, so it is not repeated here.
            ? <span className={classes.billingReuse}>
              <span className={classes.billingChip}><MaterialSymbol name="local_shipping" aria-hidden="true" size={16} />Igual que la entrega</span>
              {/* Changing where it is delivered is the delivery's decision, not the invoice's: go there instead of duplicating it. */}
              <button type="button" className={classes.billingJump} onClick={goToDelivery}>
                <span>Cambiar entrega</span><MaterialSymbol name="chevron_right" aria-hidden="true" size={18} />
              </button>
            </span>
            : <>
              <span className={classes.billingValue}>{resolved.alias || "Dirección guardada"}</span>
              <span className={classes.billingShort}>{shortAddress(resolved)}</span>
            </>}
        </div>}

      {addressFieldsOpen && <fieldset className={classes.billingFields}>
        <legend className={editing && sourcePickable ? "visually-hidden" : classes.billingLegend}>Dirección de facturación</legend>
        {requiredFields.map(field)}
        <ProvinceCityFields idPrefix="billing" provinceId={billingProvinceId} cityId={billingCityId} disabled={disabled}
          provinceError={errors.billingAddress?.provinceId?.message} cityError={errors.billingAddress?.cityId?.message}
          onChange={(next) => {
            setValue("billingAddress.provinceId", next.provinceId, { shouldDirty: true });
            setValue("billingAddress.cityId", next.cityId, { shouldDirty: true });
            clearErrors(next.cityId ? ["billingAddress.provinceId", "billingAddress.cityId"] : "billingAddress.provinceId");
          }} />
        {/* Complement and postal code are optional: one disclosure that opens and closes them. Collapsed by default;
            closing keeps what was typed (the form keeps unmounted values) and the label says something is there. */}
        <button type="button" className={classes.optionalToggle} aria-expanded={showOptional} aria-controls="billing-optional"
          onClick={() => {
            setShowOptional(!showOptional);
            if (!showOptional) requestAnimationFrame(() => document.getElementById("billing-line2")?.focus());
          }}>
          <span>{showOptional ? "Ocultar datos opcionales" : optionalFilled ? "Mostrar datos opcionales" : "Añadir datos opcionales"}</span>
          <MaterialSymbol name={showOptional ? "expand_less" : "expand_more"} aria-hidden="true" size={20} />
        </button>
        {showOptional && <div id="billing-optional" className={classes.optionalFields}>{optionalFields.map(field)}</div>}
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
