import { MaterialSymbol } from "@/shared/ui/MaterialSymbol";
import { zodResolver } from "@hookform/resolvers/zod";
import { motion, useReducedMotion } from "motion/react";
import { useEffect, useRef, useState } from "react";
import { Controller, useForm } from "react-hook-form";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "react-router-dom";
import { z } from "zod";
import { Button, ButtonLink } from "@/components/ui/button";
import { useSession } from "@/app/session";
import { formatUsd } from "@/features/catalog/formatters";
import { getCartDetail, type CartDetail } from "@/shared/api/cart";
import { addressesQueryKey, listAddresses, type CustomerAddress } from "@/shared/api/customer";
import { ApiRequestError } from "@/shared/api/errors";
import {
  CheckoutOutcomeUnknown,
  isNewerOrderId,
  listRecentOrders,
  submitCheckout,
  type CheckoutResult,
} from "@/shared/api/orders";
import { FieldMessage } from "@/shared/ui/Field";
import { TransactionButtonLabel } from "@/shared/ui/TransactionButtonLabel";
import { useTransferDetails } from "@/shared/api/reference";
import { AmericanExpressLogoIcon } from "react-svg-credit-card-payment-icons/americanexpress";
import { DinersClubLogoIcon } from "react-svg-credit-card-payment-icons/dinersclub";
import { MastercardLogoIcon } from "react-svg-credit-card-payment-icons/mastercard";
import { VisaLogoIcon } from "react-svg-credit-card-payment-icons/visa";
import { AddressForm } from "./AddressForm";
import { cartQueryKey, cartUnitCount, useCustomerCart } from "./cartQuery";
import { ReadFailure } from "./CartPage";
import { CustomerOnly, PurchasePage } from "./PurchaseChrome";
import { detectCardBrand, formatCardNumber, isLuhnValid, normalizeCardNumber, unitsLabel, type CardBrand } from "./purchaseText";
import { StockStatus } from "@/features/catalog/StockStatus";
import { availabilityConflictMessage } from "@/features/catalog/stockStatusModel";
import surface from "@/features/catalog/availabilitySurface.module.css";
import { TransferFacts } from "./TransferFacts";

const checkoutSchema = z.object({
  addressId: z.string({ error: "Elige una dirección de entrega." }).min(1, "Elige una dirección de entrega."),
  paymentMethod: z.enum(["CARD", "TRANSFER"], { error: "Elige un método de pago." }),
  cardNumber: z.string(),
  expiration: z.string(),
  cvv: z.string(),
  cardholder: z.string(),
}).superRefine((values, context) => {
  if (values.paymentMethod !== "CARD") return;
  const digits = normalizeCardNumber(values.cardNumber);
  if (!digits) {
    context.addIssue({ code: "custom", path: ["cardNumber"], message: "Escribe el número de tu tarjeta." });
  } else if (!/^[0-9]{12,19}$/.test(digits)) {
    context.addIssue({ code: "custom", path: ["cardNumber"], message: "El número de tarjeta debe tener entre 12 y 19 dígitos." });
  } else if (!isLuhnValid(digits)) {
    context.addIssue({ code: "custom", path: ["cardNumber"], message: "Este número de tarjeta no es válido. Revisa los dígitos." });
  }
  if (!isValidCardExpiry(values.expiration)) {
    context.addIssue({ code: "custom", path: ["expiration"], message: "Escribe la fecha de caducidad en formato MM/AA." });
  } else if (!isCardExpiryCurrent(values.expiration)) {
    context.addIssue({ code: "custom", path: ["expiration"], message: "La fecha de caducidad de la tarjeta ya venció." });
  }
  const cvvLength = detectCardBrand(values.cardNumber) === "amex" ? 4 : 3;
  if (!new RegExp(`^\\d{${cvvLength}}$`).test(values.cvv)) context.addIssue({ code: "custom", path: ["cvv"], message: `El código de seguridad debe tener ${cvvLength} dígitos.` });
  if (!values.cardholder.trim()) context.addIssue({ code: "custom", path: ["cardholder"], message: "Escribe el nombre del titular de la tarjeta." });
});

type CheckoutValues = z.input<typeof checkoutSchema>;
type Phase = "idle" | "checking" | "submitting" | "unknown" | "reconciling";
type Problem = { title: string; detail: string; action?: "cart" };
const supportedCardBrands: CardBrand[] = ["visa", "mastercard", "amex", "diners"];

export function CheckoutPage() {
  return (
    <PurchasePage title="Finalizar compra" compact>
      <CustomerOnly intent="/checkout" task="finalizar tu compra">
        <CheckoutContent />
      </CustomerOnly>
    </PurchasePage>
  );
}

function CheckoutContent() {
  const { clear: clearSession } = useSession();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const cartQuery = useCustomerCart(true);
  const addressesQuery = useQuery({
    queryKey: addressesQueryKey,
    queryFn: ({ signal }) => listAddresses(signal),
    meta: { authRequired: true },
    retry: (count, error) => !(error instanceof ApiRequestError && error.status < 500) && count < 1,
  });
  const submitLock = useRef(false);
  const baselineOrderId = useRef<string | null>(null);
  const cardNumberServerError = useRef<string | null>(null);
  const problemRef = useRef<HTMLDivElement>(null);
  const [phase, setPhase] = useState<Phase>("idle");
  const [problem, setProblem] = useState<Problem | null>(null);
  const [addingAddress, setAddingAddress] = useState(false);
  const [changingAddress, setChangingAddress] = useState(false);
  const [addressNotice, setAddressNotice] = useState<string | null>(null);

  const {
    register,
    control,
    handleSubmit,
    watch,
    setValue,
    setError,
    clearErrors,
    getValues,
    resetField,
    formState: { errors },
  } = useForm<CheckoutValues>({
    resolver: zodResolver(checkoutSchema),
    defaultValues: { addressId: "", paymentMethod: undefined, cardNumber: "", expiration: "", cvv: "", cardholder: "" },
    // Focus is placed explicitly: the address choice may have no input to focus yet.
    shouldFocusError: false,
  });
  const cardNumberRegistration = register("cardNumber");
  const cvvRegistration = register("cvv");
  const reduceMotion = useReducedMotion();
  const paymentMethod = watch("paymentMethod");
  const cardNumber = watch("cardNumber");
  const cardBrand = detectCardBrand(cardNumber);
  const transferDetails = useTransferDetails(paymentMethod === "TRANSFER");
  const addressId = watch("addressId");
  const addresses = addressesQuery.data;

  useEffect(() => {
    if (!addresses) return;
    const current = getValues("addressId");
    if (current && addresses.some((address) => address.addressId === current)) return;
    const preferred = addresses.find((address) => address.primary) ?? addresses[0];
    setValue("addressId", preferred?.addressId ?? "");
  }, [addresses, getValues, setValue]);

  useEffect(() => {
    // The card number is transient: switching away from CARD discards it.
    if (paymentMethod !== "CARD") {
      resetField("cardNumber", { defaultValue: "" });
      resetField("expiration", { defaultValue: "" });
      resetField("cvv", { defaultValue: "" });
      resetField("cardholder", { defaultValue: "" });
    }
  }, [paymentMethod, resetField]);

  useEffect(() => {
    if (problem) problemRef.current?.focus();
  }, [problem]);

  const reconcile = useMutation({
    mutationFn: () => listRecentOrders(5),
    retry: false,
    onSuccess: async (orders) => {
      const created = orders.find((order) => isNewerOrderId(order.orderId, baselineOrderId.current));
      if (created) {
        await queryClient.invalidateQueries({ queryKey: cartQueryKey });
        navigate(`/orders/${created.orderId}`, { replace: true });
        return;
      }
      await cartQuery.refetch();
      setPhase("idle");
      setProblem({
        title: "No se creó ningún pedido.",
        detail: "Consultamos tus pedidos y no encontramos uno nuevo. Revisa tu carrito y vuelve a confirmar cuando quieras.",
      });
    },
    onError: (error: Error) => {
      if (error instanceof ApiRequestError && error.status === 401) {
        clearSession("expired");
        return;
      }
      setPhase("unknown");
    },
  });

  function focusFirstInvalid(invalid: Partial<Record<keyof CheckoutValues, unknown>>) {
    const target = invalid.addressId
      ? document.querySelector<HTMLElement>('input[name="addressId"]') ?? document.getElementById("address-line1")
      : invalid.paymentMethod
      ? document.querySelector<HTMLElement>('input[name="paymentMethod"]')
      : invalid.cardNumber
      ? document.getElementById("checkout-card-number")
      : invalid.expiration ? document.getElementById("checkout-expiration")
      : invalid.cvv ? document.getElementById("checkout-cvv")
      : invalid.cardholder ? document.getElementById("checkout-cardholder")
      : null;
    target?.focus();
  }

  const submit = handleSubmit(async (values) => {
    if (submitLock.current || phase !== "idle" || addressesQuery.isPending || addressesQuery.isError || addressesQuery.isFetching || (values.paymentMethod === "TRANSFER" && !transferDetails.data)) return;
    const displayedCart = cartQuery.data;
    if (!displayedCart) return;
    submitLock.current = true;
    cardNumberServerError.current = null;
    setProblem(null);
    setPhase("checking");

    try {
      // Safe reads before the non-idempotent command: confirm the cart the customer reviewed
      // and remember the newest existing order so an unknown outcome can be reconciled.
      let fresh: CartDetail;
      try {
        const [cart, orders] = await Promise.all([getCartDetail(), listRecentOrders(1)]);
        fresh = cart;
        baselineOrderId.current = orders[0]?.orderId ?? null;
      } catch (error) {
        if (error instanceof ApiRequestError && error.status === 401) {
          clearSession("expired");
          return;
        }
        setPhase("idle");
        setProblem({
          title: "No enviamos tu pedido.",
          detail: "No pudimos confirmar el estado de tu carrito. Comprueba tu conexión e inténtalo otra vez.",
        });
        return;
      }

      queryClient.setQueryData(cartQueryKey, fresh);
      if (fresh.items.length === 0) {
        setPhase("idle");
        setProblem({ title: "Tu carrito está vacío.", detail: "No enviamos ningún pedido. Agrega un libro desde el catálogo." });
        return;
      }
      if (cartSignature(fresh) !== cartSignature(displayedCart)) {
        setPhase("idle");
        setProblem({
          title: "Tu carrito cambió.",
          detail: "Los precios, cantidades o la disponibilidad se actualizaron desde que abriste esta página. Revisa el nuevo resumen y confirma otra vez.",
        });
        return;
      }
      if (fresh.items.some((item) => !item.available)) {
        setPhase("idle");
        setProblem({
          title: "Hay libros no disponibles en tu carrito.",
          detail: "Ajusta o quita esos libros antes de finalizar la compra.",
          action: "cart",
        });
        return;
      }

      const transactionStartedAt = Date.now();
      setPhase("submitting");
      let result: CheckoutResult;
      try {
        result = await submitCheckout({
          addressId: values.addressId,
          paymentMethod: values.paymentMethod,
          cardNumber: values.paymentMethod === "CARD" ? normalizeCardNumber(values.cardNumber) : undefined,
        });
      } catch (error) {
        await holdTransactionFeedback(transactionStartedAt, reduceMotion);
        await handleCheckoutError(error);
        return;
      }

      await holdTransactionFeedback(transactionStartedAt, reduceMotion);
      await queryClient.invalidateQueries({ queryKey: cartQueryKey });
      navigate(`/orders/${result.orderId}`, { replace: true });
    } finally {
      // Never keep the card number after an attempt, whatever the outcome.
      resetField("cardNumber", { defaultValue: "" });
      resetField("cvv", { defaultValue: "" });
      if (cardNumberServerError.current) {
        setError("cardNumber", { type: "server", message: cardNumberServerError.current });
        cardNumberServerError.current = null;
        requestAnimationFrame(() => document.getElementById("checkout-card-number")?.focus());
      }
      submitLock.current = false;
    }
  }, focusFirstInvalid);

  async function handleCheckoutError(error: unknown) {
    if (error instanceof CheckoutOutcomeUnknown || !(error instanceof ApiRequestError)) {
      setPhase("unknown");
      return;
    }
    if (error.status === 401) {
      clearSession("expired");
      return;
    }

    setPhase("idle");
    const code = error.code;
    // Canonical SQLSTATE wire codes; see API amendment v1.0.3.
    if (availabilityConflictMessage(code)) {
      await cartQuery.refetch();
      setProblem({
        title: "La disponibilidad cambió y no se creó el pedido.",
        detail: "Actualizamos tu carrito. Revisa los libros marcados antes de volver a intentarlo.",
        action: "cart",
      });
    } else if (code === "P4002" || code === "P4001") {
      await cartQuery.refetch();
      setProblem({ title: "Tu carrito ya no tiene libros para comprar.", detail: "No se creó ningún pedido." });
    } else if (code === "P5004") {
      await addressesQuery.refetch();
      setChangingAddress(true);
      setError("addressId", { message: "Esa dirección ya no está disponible. Elige otra o agrega una nueva." }, { shouldFocus: true });
    } else if (code === "INVALID_CARD_NUMBER") {
      cardNumberServerError.current = `Número de tarjeta: ${error.detail} Vuelve a escribirlo.`;
      setError("cardNumber", { type: "server", message: cardNumberServerError.current });
    } else if (code === "P5007") {
      setProblem({
        title: "No se creó el pedido.",
        detail: "Ocurrió un problema temporal al registrar el pago. Puedes volver a confirmar la compra.",
      });
    } else if (error.status === 403) {
      setProblem({ title: "Tu cuenta no puede finalizar compras.", detail: error.detail });
    } else {
      setProblem({ title: error.title, detail: `${error.detail} No se creó ningún pedido.` });
    }
  }

  const cart = cartQuery.data;
  const busy = phase === "checking" || phase === "submitting";

  if (cartQuery.isPending) {
    return (
      <>
        <CheckoutHeading />
        <p className="purchase-loading" role="status">Consultando tu carrito…</p>
      </>
    );
  }

  if (!cart) {
    return (
      <>
        <CheckoutHeading />
        <ReadFailure onRetry={() => void cartQuery.refetch()} retrying={cartQuery.isFetching} />
      </>
    );
  }

  if (cart.items.length === 0 && phase === "idle" && !problem) {
    return (
      <>
        <CheckoutHeading />
        <section className="empty-state purchase-empty" aria-labelledby="checkout-empty-heading">
          <div className="empty-rule" aria-hidden="true" />
          <h2 id="checkout-empty-heading">Tu carrito está vacío.</h2>
          <p>Para finalizar una compra necesitas al menos un libro en el carrito.</p>
          <ButtonLink variant="primary" to="/catalog">Ir al catálogo</ButtonLink>
        </section>
      </>
    );
  }

  const unavailable = cart.items.some((item) => !item.available);
  const selectedAddress = addresses?.find((address) => address.addressId === addressId);
  // Missing choices are not blocked here: submitting runs validation and names each one.
  const submitBlocked = busy || phase === "unknown" || phase === "reconciling" || unavailable
    || cart.items.length === 0 || addressesQuery.isPending || addressesQuery.isError || addressesQuery.isFetching
    || (paymentMethod === "TRANSFER" && !transferDetails.data);

  return (
    <>
      <CheckoutHeading />

      {problem && (
        <div className="purchase-problem" role="alert" tabIndex={-1} ref={problemRef}>
          <h2>{problem.title}</h2>
          <p>{problem.detail}</p>
          {problem.action === "cart" && <Link to="/cart">Revisar el carrito</Link>}
        </div>
      )}

      {(phase === "unknown" || phase === "reconciling") && (
        <UnknownOutcome
          reconciling={reconcile.isPending}
          failed={reconcile.isError}
          onReconcile={() => {
            if (reconcile.isPending) return;
            setPhase("reconciling");
            reconcile.mutate();
          }}
        />
      )}

      <div className="purchase-layout purchase-layout--checkout">
        <div className="checkout-steps">
          <section className="checkout-section" aria-labelledby="checkout-address-heading">
            <h2 id="checkout-address-heading">Dirección de entrega</h2>
            {addressesQuery.isPending ? (
              <p className="purchase-loading" role="status">Consultando tus direcciones…</p>
            ) : !addresses ? (
              <ReadFailure
                title="No pudimos consultar tus direcciones."
                onRetry={() => void addressesQuery.refetch()}
                retrying={addressesQuery.isFetching}
              />
            ) : (
              <>
                {addressesQuery.isError && <p className="stale-data-note" role="status">No pudimos actualizar tus direcciones. Se muestra la última consulta disponible. <Button variant="text" type="button" onClick={() => void addressesQuery.refetch()}>Actualizar</Button></p>}
                {addressNotice && <p className="purchase-notice purchase-notice--success" role="status">{addressNotice}</p>}
                {selectedAddress && !changingAddress && !addingAddress && <div className="checkout-selected-address">
                  <MaterialSymbol name="location_on" aria-hidden="true" size={21} />
                  <div><strong>{selectedAddress.alias}{selectedAddress.primary && <span className="choice-tag">Principal</span>}</strong><p>{selectedAddress.line1}{selectedAddress.line2 ? `, ${selectedAddress.line2}` : ""} · {selectedAddress.city}, {selectedAddress.province}</p><span>{selectedAddress.phone}</span></div>
                </div>}
                {addresses.length > 0 && changingAddress && !addingAddress && (
                  <fieldset
                    className="choice-list"
                    aria-describedby={errors.addressId ? "address-error" : undefined}
                    aria-invalid={Boolean(errors.addressId) || undefined}
                  >
                    <legend className="visually-hidden">Elige dónde recibir tu pedido</legend>
                    {addresses.map((address) => (
                      <AddressChoice key={address.addressId} address={address} disabled={busy || addressesQuery.isError || addressesQuery.isFetching} onSelect={() => setChangingAddress(false)} {...register("addressId")} />
                    ))}
                  </fieldset>
                )}
                {addresses.length === 0 && !addingAddress && (
                  <p className="checkout-hint">Aún no tienes direcciones guardadas. Agrega una para recibir tu pedido.</p>
                )}
                {errors.addressId && (
                  <FieldMessage id="address-error" tone="error">
                    {addresses.length === 0 ? "Guarda una dirección de entrega antes de realizar el pedido." : errors.addressId.message}
                  </FieldMessage>
                )}

                {addingAddress || addresses.length === 0 ? (
                  <AddressForm
                    firstAddress={addresses.length === 0}
                    disabled={addressesQuery.isError || addressesQuery.isFetching}
                    onCancel={addresses.length > 0 ? () => setAddingAddress(false) : undefined}
                    onSaved={async (addressId) => {
                      const refreshed = await addressesQuery.refetch();
                      setAddingAddress(false);
                      setChangingAddress(false);
                      if (refreshed.data?.some((address) => address.addressId === addressId)) {
                        setValue("addressId", addressId, { shouldValidate: true });
                      }
                      setAddressNotice("Guardamos la dirección y la elegimos para este pedido.");
                    }}
                    onUncertain={async () => {
                      await addressesQuery.refetch();
                    }}
                    onSessionExpired={() => clearSession("expired")}
                  />
                ) : <div className="checkout-address-actions">
                  {selectedAddress && <Button variant="secondary" type="button" onClick={() => setChangingAddress((value) => !value)}>{changingAddress ? "Listo" : "Cambiar"}</Button>}
                  <Button variant="secondary" type="button" onClick={() => { setAddressNotice(null); setChangingAddress(false); setAddingAddress(true); }}>Agregar dirección</Button>
                </div>}
              </>
            )}
          </section>

          <form className="checkout-form" onSubmit={submit} noValidate aria-labelledby="checkout-payment-heading">
            <section className="checkout-section" aria-labelledby="checkout-payment-heading">
              <h2 id="checkout-payment-heading">Método de pago</h2>
              <fieldset
                className="payment-methods"
                aria-describedby={errors.paymentMethod ? "payment-method-error" : undefined}
                aria-invalid={Boolean(errors.paymentMethod) || undefined}
              >
                <legend>Método de pago</legend>
                <label className="payment-method-option">
                  <input className="visually-hidden" type="radio" value="CARD" disabled={busy} {...register("paymentMethod")} />
                  <span className="payment-method-icon"><MaterialSymbol name="credit_card" aria-hidden="true" size={19} /></span>
                  <span className="payment-method-copy"><strong>Tarjeta</strong><span>Crédito o débito</span></span>
                  <span className="payment-method-selected"><MaterialSymbol name="check" aria-hidden="true" size={15} /></span>
                </label>
                <label className="payment-method-option">
                  <input className="visually-hidden" type="radio" value="TRANSFER" disabled={busy} {...register("paymentMethod")} />
                  <span className="payment-method-icon"><MaterialSymbol name="account_balance" aria-hidden="true" size={19} /></span>
                  <span className="payment-method-copy"><strong>Transferencia</strong><span>Con referencia de pedido</span></span>
                  <span className="payment-method-selected"><MaterialSymbol name="check" aria-hidden="true" size={15} /></span>
                </label>
              </fieldset>
              {errors.paymentMethod && (
                <FieldMessage id="payment-method-error" tone="error">{errors.paymentMethod.message}</FieldMessage>
              )}

              {paymentMethod === "CARD" && (
                <div className="checkout-card-fields">
                  <div className="card-security-header">
                    <div className="card-security-title">
                      <MaterialSymbol name="lock" aria-hidden="true" size={17} />
                      <span>Proceso de compra seguro</span>
                    </div>
                    <ul className="card-brand-list" aria-label="Tarjetas aceptadas">
                      {supportedCardBrands.map((brand) => (
                        <li key={brand}><CardBrandMark brand={brand} accepted /></li>
                      ))}
                    </ul>
                  </div>
                  <div className="form-field checkout-card">
                    <label htmlFor="checkout-card-number">Número de tarjeta</label>
                    <div className="card-number-control">
                      <input
                        id="checkout-card-number"
                        type="text"
                        inputMode="numeric"
                        autoComplete="cc-number"
                        placeholder="0000 0000 0000 0000"
                        spellCheck={false}
                        maxLength={23}
                        disabled={busy}
                        aria-invalid={Boolean(errors.cardNumber) || undefined}
                        aria-describedby={errors.cardNumber ? "card-number-error" : undefined}
                        {...cardNumberRegistration}
                        onChange={(event) => {
                          const input = event.currentTarget;
                          const previousDigits = normalizeCardNumber(getValues("cardNumber"));
                          const nextDigits = normalizeCardNumber(input.value);
                          const appendedToIncompleteNumber = nextDigits.startsWith(previousDigits)
                            && nextDigits.length > previousDigits.length;
                          const moveForward = isCompleteValidCardNumber(input.value)
                            && (caretIsAfterLastDigit(input) || appendedToIncompleteNumber);
                          const digitsBeforeCaret = input.value.slice(0, input.selectionStart ?? input.value.length).replace(/\D/g, "").length;
                          input.value = formatCardNumber(input.value);
                          void cardNumberRegistration.onChange(event);
                          if (errors.cardNumber) clearErrors("cardNumber");
                          const caret = positionAfterDigits(input.value, digitsBeforeCaret);
                          if (moveForward) requestAnimationFrame(() => document.getElementById("checkout-expiration")?.focus());
                          else input.setSelectionRange(caret, caret);
                        }}
                      />
                      {cardBrand && <CardBrandMark brand={cardBrand} />}
                    </div>
                  {errors.cardNumber && <FieldMessage id="card-number-error" tone="error">{errors.cardNumber.message}</FieldMessage>}
                  </div>
                  <div className="form-field">
                    <label htmlFor="checkout-expiration">Caducidad (MM/AA)</label>
                    <Controller
                      control={control}
                      name="expiration"
                      render={({ field }) => (
                        <input
                          id="checkout-expiration"
                          ref={field.ref}
                          name={field.name}
                          type="text"
                          inputMode="numeric"
                          autoComplete="cc-exp"
                          maxLength={7}
                          value={field.value}
                          disabled={busy}
                          aria-invalid={Boolean(errors.expiration) || undefined}
                          aria-describedby={errors.expiration ? "expiration-error" : undefined}
                          onBlur={field.onBlur}
                          onChange={(event) => {
                            const input = event.currentTarget;
                            const previousDigits = getValues("expiration").replace(/\D/g, "");
                            const nextDigits = input.value.replace(/\D/g, "");
                            const appendedToIncompleteExpiry = nextDigits.startsWith(previousDigits)
                              && nextDigits.length > previousDigits.length;
                            const moveForward = (caretIsAfterLastDigit(input) || appendedToIncompleteExpiry)
                              && nextDigits.length === 4
                              && isCardExpiryCurrent(input.value);
                            const digitsBeforeCaret = input.value.slice(0, input.selectionStart ?? input.value.length).replace(/\D/g, "").length;
                            const formatted = formatCardExpiry(input.value);
                            field.onChange(formatted);
                            const caret = positionAfterDigits(formatted, digitsBeforeCaret);
                            if (errors.expiration) clearErrors("expiration");
                            requestAnimationFrame(() => {
                              if (moveForward) document.getElementById("checkout-cvv")?.focus();
                              else input.setSelectionRange(caret, caret);
                            });
                          }}
                        />
                      )}
                    />
                    {errors.expiration && <FieldMessage id="expiration-error" tone="error">{errors.expiration.message}</FieldMessage>}
                  </div>
                  <div className="form-field">
                    <label htmlFor="checkout-cvv">Código de seguridad</label>
                    <input
                      id="checkout-cvv"
                      type="password"
                      inputMode="numeric"
                      autoComplete="cc-csc"
                      maxLength={cardBrand === "amex" ? 4 : 3}
                      disabled={busy}
                      aria-invalid={Boolean(errors.cvv) || undefined}
                      aria-describedby={errors.cvv ? "cvv-error" : undefined}
                      {...cvvRegistration}
                      onChange={(event) => {
                        const input = event.currentTarget;
                        const length = cardBrand === "amex" ? 4 : 3;
                        const moveForward = caretIsAfterLastDigit(input) && new RegExp(`^\\d{${length}}$`).test(input.value);
                        const caret = input.selectionStart ?? input.value.length;
                        input.value = input.value.replace(/\D/g, "").slice(0, length);
                        void cvvRegistration.onChange(event);
                        if (errors.cvv) clearErrors("cvv");
                        if (moveForward) requestAnimationFrame(() => document.getElementById("checkout-cardholder")?.focus());
                        else input.setSelectionRange(Math.min(caret, input.value.length), Math.min(caret, input.value.length));
                      }}
                    />
                    {errors.cvv && <FieldMessage id="cvv-error" tone="error">{errors.cvv.message}</FieldMessage>}
                  </div>
                  <div className="form-field checkout-cardholder"><label htmlFor="checkout-cardholder">Nombre en la tarjeta</label><input id="checkout-cardholder" autoComplete="cc-name" maxLength={120} disabled={busy} aria-invalid={Boolean(errors.cardholder) || undefined} aria-describedby={errors.cardholder ? "cardholder-error" : undefined} {...register("cardholder")} />{errors.cardholder && <FieldMessage id="cardholder-error" tone="error">{errors.cardholder.message}</FieldMessage>}</div>
                </div>
              )}
              {paymentMethod === "TRANSFER" && (
                transferDetails.isPending ? <p className="purchase-loading" role="status">Consultando datos bancarios…</p> : transferDetails.isError || !transferDetails.data ? <ReadFailure title="No pudimos consultar los datos bancarios." onRetry={() => void transferDetails.refetch()} retrying={transferDetails.isFetching} /> : <div className="transfer-instructions"><p>Al confirmar tu pedido recibirás una referencia para identificar la transferencia.</p><TransferFacts details={transferDetails.data} amount={cart.totalCurrent} /></div>
              )}
            </section>

            <CheckoutSummaryDisclosure cart={cart} />

            <div className="checkout-submit">
              {busy && (
                <motion.p
                  className="purchase-loading"
                  role="status"
                  initial={reduceMotion ? false : { opacity: 0, y: 3 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={reduceMotion ? { duration: 0 } : { duration: 0.16, ease: [0.16, 1, 0.3, 1] }}
                >
                  {phase === "checking" ? "Confirmando tu carrito…" : "Procesando tu pago…"}
                </motion.p>
              )}
              {unavailable && (
                <p className="purchase-summary-blocker" role="status">
                  Hay libros no disponibles. <Link to="/cart">Ajusta tu carrito</Link> para continuar.
                </p>
              )}
              <Button
                variant="primary"
                type="submit"
                className="purchase-primary"
                aria-label={busy ? "Procesando compra" : `Pagar ${formatUsd(cart.totalCurrent)}`}
                aria-disabled={submitBlocked || undefined}
                aria-busy={busy || undefined}
                onClick={(event) => {
                  if (submitBlocked) event.preventDefault();
                }}
              >
                <TransactionButtonLabel
                  state={busy ? "pending" : "idle"}
                  idle={`Pagar ${formatUsd(cart.totalCurrent)}`}
                  pending="Procesando…"
                  success="Pedido creado"
                  reserve={`Pagar ${formatUsd(cart.totalCurrent)}`}
                />
              </Button>
            </div>
          </form>
        </div>

        <CheckoutSummary cart={cart} />
      </div>
    </>
  );
}

function CheckoutHeading() {
  return (
    <header className="purchase-heading">
      <Link className="purchase-back" to="/cart"><MaterialSymbol name="arrow_back" aria-hidden="true" size={16} /><span>Volver al carrito</span></Link>
      <h1>Finalizar compra</h1>
      <p>Elige dónde recibir tu pedido y cómo pagarlo.</p>
    </header>
  );
}

function CheckoutSummary({ cart }: { cart: CartDetail }) {
  return (
    <aside className="purchase-summary checkout-summary" aria-labelledby="checkout-summary-heading">
      <h2 id="checkout-summary-heading">Tu pedido</h2>
      <CheckoutSummaryBody cart={cart} />
    </aside>
  );
}

function CheckoutSummaryDisclosure({ cart }: { cart: CartDetail }) {
  return (
    <details className="checkout-summary-disclosure">
      <summary>
        <span>Tu pedido · {unitsLabel(cartUnitCount(cart.items))}</span>
        <strong>{formatUsd(cart.totalCurrent)}</strong>
        <MaterialSymbol name="expand_more" aria-hidden="true" size={18} className="disclosure-chevron" />
      </summary>
      <CheckoutSummaryBody cart={cart} />
    </details>
  );
}

function CheckoutSummaryBody({ cart }: { cart: CartDetail }) {
  return (
    <>
      <ul className={`summary-lines ${surface.surface}`}>
        {cart.items.map((item) => (
          <li key={item.cartItemId}>
            <span className="summary-line-title">{item.title}</span>
            <span className="summary-line-meta">
              {unitsLabel(item.quantity)} × {formatUsd(item.currentPrice)}
            </span>
            {!item.available && (
              <StockStatus available={item.available} unavailabilityReason={item.unavailabilityReason} size="compact" className={surface.summaryStatus} />
            )}
            <span className="summary-line-subtotal">{formatUsd(item.currentSubtotal)}</span>
          </li>
        ))}
      </ul>
      <dl>
        <div><dt>Unidades</dt><dd>{cartUnitCount(cart.items)}</dd></div>
        <div className="purchase-total"><dt>Total</dt><dd>{formatUsd(cart.totalCurrent)}</dd></div>
      </dl>
      <p className="purchase-summary-note">Precios actuales; el total final se confirma al crear el pedido.</p>
    </>
  );
}

function positionAfterDigits(value: string, digitCount: number) {
  if (digitCount === 0) return 0;
  let seen = 0;
  for (let index = 0; index < value.length; index += 1) {
    if (/\d/.test(value[index])) seen += 1;
    if (seen === digitCount) return index + 1;
  }
  return value.length;
}

function formatCardExpiry(value: string) {
  const digits = value.replace(/\D/g, "").slice(0, 4);
  if (digits.length < 2) return digits;
  if (digits.length === 2) return `${digits} /`;
  return `${digits.slice(0, 2)} / ${digits.slice(2)}`;
}

function caretIsAfterLastDigit(input: HTMLInputElement) {
  const caret = input.selectionStart;
  return caret === input.selectionEnd
    && input.value.slice(0, caret ?? 0).replace(/\D/g, "").length === input.value.replace(/\D/g, "").length;
}

function isCompleteValidCardNumber(value: string) {
  const digits = normalizeCardNumber(value);
  const brand = detectCardBrand(digits);
  const lengths: Record<CardBrand, number[]> = {
    visa: [13, 16, 19],
    mastercard: [16],
    amex: [15],
    diners: [14],
  };
  return brand !== null && lengths[brand].includes(digits.length) && isLuhnValid(digits);
}

function isValidCardExpiry(value: string) {
  return /^(0[1-9]|1[0-2])\s*\/\s*\d{2}$/.test(value);
}

function isCardExpiryCurrent(value: string) {
  const match = /^(0[1-9]|1[0-2])\s*\/\s*(\d{2})$/.exec(value);
  if (!match) return false;
  const month = Number(match[1]);
  const year = Number(match[2]);
  const now = new Date();
  return 2000 + year > now.getFullYear()
    || (2000 + year === now.getFullYear() && month >= now.getMonth() + 1);
}

async function holdTransactionFeedback(startedAt: number, reduceMotion: boolean | null) {
  const minimumVisibleMs = reduceMotion ? 320 : 520;
  const remainingMs = minimumVisibleMs - (Date.now() - startedAt);
  if (remainingMs > 0) await new Promise<void>((resolve) => window.setTimeout(resolve, remainingMs));
}

function CardBrandMark({ brand, accepted = false }: { brand: CardBrand; accepted?: boolean }) {
  const names: Record<CardBrand, string> = {
    visa: "Visa", mastercard: "Mastercard", amex: "American Express", diners: "Diners Club",
  };
  const logoProps = { "aria-hidden": true as const, focusable: false as const, width: accepted ? 48 : 42, height: accepted ? 28 : 25 };
  const logo = brand === "visa"
    ? <VisaLogoIcon {...logoProps} />
    : brand === "mastercard"
    ? <MastercardLogoIcon {...logoProps} />
    : brand === "amex"
    ? <AmericanExpressLogoIcon {...logoProps} />
    : <DinersClubLogoIcon {...logoProps} />;
  return <span className={`card-brand-mark${accepted ? " card-brand-mark--accepted" : ""}`} role="img" aria-label={accepted ? names[brand] : `${names[brand]} detectada`}>
    {logo}
  </span>;
}

function UnknownOutcome({ reconciling, failed, onReconcile }: {
  reconciling: boolean;
  failed: boolean;
  onReconcile: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => ref.current?.focus(), []);

  return (
    <div className="purchase-problem purchase-problem--unknown" role="alert" tabIndex={-1} ref={ref}>
      <h2>No pudimos confirmar si se creó tu pedido.</h2>
      <p>
        Es posible que se haya registrado. Para no duplicarlo, no lo volvimos a enviar. Consulta tus pedidos antes de intentarlo otra vez.
      </p>
      {failed && !reconciling && (
        <p className="purchase-problem-detail">Todavía no pudimos consultar tus pedidos. Comprueba tu conexión.</p>
      )}
      <Button variant="secondary" type="button" onClick={onReconcile} aria-disabled={reconciling || undefined} aria-busy={reconciling || undefined}>
        {reconciling ? "Consultando tus pedidos…" : "Consultar mis pedidos"}
      </Button>
    </div>
  );
}

function AddressChoice({ address, disabled, onSelect, ...field }: {
  address: CustomerAddress;
  disabled: boolean;
  onSelect: () => void;
} & ReturnType<ReturnType<typeof useForm<CheckoutValues>>["register"]>) {
  const lines = [
    address.line1,
    address.line2,
    [address.city, address.province].filter(Boolean).join(", "),
  ].filter(Boolean);

  return (
    <label className="choice">
      <input type="radio" value={address.addressId} disabled={disabled} {...field} onChange={(event) => { void field.onChange(event); onSelect(); }} />
      <span className="choice-copy">
        <strong><MaterialSymbol name="location_on" aria-hidden="true" size={17} />{address.alias}{address.primary && <span className="choice-tag">Principal</span>}</strong>
        {lines.map((line) => <span key={line}>{line}</span>)}
        <span>{address.phone}</span>
      </span>
    </label>
  );
}

function cartSignature(cart: CartDetail) {
  return JSON.stringify([
    cart.totalCurrent,
    cart.items.map((item) => [item.cartItemId, item.quantity, item.currentPrice, item.available]),
  ]);
}
