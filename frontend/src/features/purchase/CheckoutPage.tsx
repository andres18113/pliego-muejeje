import { useAvailabilityFocus } from "@/features/catalog/useAvailabilityFocus";
import { MaterialSymbol } from "@/shared/ui/MaterialSymbol";
import { zodResolver } from "@hookform/resolvers/zod";
import { Modal } from "@mantine/core";
import { useMediaQuery } from "@mantine/hooks";
import { motion, useReducedMotion } from "motion/react";
import { useEffect, useRef, useState } from "react";
import { Controller, useForm } from "react-hook-form";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "react-router-dom";
import { z } from "zod";
import { Button, ButtonLink } from "@/components/ui/button";
import { useSession } from "@/app/session";
import { BookCover } from "@/features/catalog/BookCover";
import { formatEdition, formatUsd } from "@/features/catalog/formatters";
import { getCartDetail, type CartDetail } from "@/shared/api/cart";
import { addressesQueryKey, listAddresses, type CustomerAddress } from "@/shared/api/customer";
import { ApiRequestError, fieldErrorMessages } from "@/shared/api/errors";
import {
  CheckoutOutcomeUnknown,
  resolveCheckout,
  submitCheckout,
  type CheckoutResult,
} from "@/shared/api/orders";
import { beginPendingAttempt, clearPendingAttempt, readPendingAttempt } from "@/shared/api/attemptStorage";
import { FieldMessage } from "@/shared/ui/Field";
import { TransactionButtonLabel } from "@/shared/ui/TransactionButtonLabel";
import { useTransferDetails } from "@/shared/api/reference";
import { AmericanExpressLogoIcon } from "react-svg-credit-card-payment-icons/americanexpress";
import { DinersClubLogoIcon } from "react-svg-credit-card-payment-icons/dinersclub";
import { MastercardLogoIcon } from "react-svg-credit-card-payment-icons/mastercard";
import { VisaLogoIcon } from "react-svg-credit-card-payment-icons/visa";
import { AddressEditorDialog } from "@/features/account/AddressEditorDialog";
import { cartQueryKey, useCustomerCart } from "./cartQuery";
import { ReadFailure } from "./CartPage";
import { CustomerOnly, PurchasePage } from "./PurchaseChrome";
import { fulfillmentMethodLabel, type CheckoutFulfillmentMethod, checkoutFulfillmentMethods } from "./fulfillment";
import { deliveryDateRangeLabel, ivaLabel } from "./purchaseText";
import { PurchaseFlow, PurchaseLayout, PurchaseSummary } from "./PurchaseFlow";
import classes from "./purchaseFlow.module.css";
import { detectCardBrand, formatCardNumber, isLuhnValid, normalizeCardNumber, unitsLabel, type CardBrand } from "./purchaseText";
import { StockStatus } from "@/features/catalog/StockStatus";
import { availabilityConflictMessage, resolveStockStatus } from "@/features/catalog/stockStatusModel";
import surface from "@/features/catalog/availabilitySurface.module.css";
import { TransferFacts } from "./TransferFacts";
import { listPickupLocations, pickupLocationsQueryKey } from "@/shared/api/pickup";
import { FulfillmentTabs } from "./FulfillmentTabs";
import { PickupLocationPicker } from "./PickupLocationPicker";
import pickupClasses from "./pickup.module.css";
import { CardSecurityCodeHelp } from "./CardSecurityCodeHelp";

const checkoutSchema = z.object({
  fulfillmentMethod: z.enum(checkoutFulfillmentMethods),
  addressId: z.string(),
  pickupLocationId: z.string(),
  paymentMethod: z.enum(["CARD", "TRANSFER"], { error: "Elige un método de pago." }),
  cardNumber: z.string(),
  expiration: z.string(),
  cvv: z.string(),
  cardholder: z.string(),
}).superRefine((values, context) => {
  if (values.fulfillmentMethod === "HOME_DELIVERY" && !values.addressId) {
    context.addIssue({ code: "custom", path: ["addressId"], message: "Elige una dirección de entrega." });
  }
  if (values.fulfillmentMethod === "STORE_PICKUP" && !values.pickupLocationId) {
    context.addIssue({ code: "custom", path: ["pickupLocationId"], message: "Elige un punto de retiro." });
  }
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
const cardBrandNames: Record<CardBrand, string> = { visa: "Visa", mastercard: "Mastercard", amex: "American Express", diners: "Diners Club" };
const cardFieldOrder = ["cardNumber", "expiration", "cvv", "cardholder"] as const;
const cardFieldIds = { cardNumber: "checkout-card-number", expiration: "checkout-expiration", cvv: "checkout-cvv", cardholder: "checkout-cardholder" } as const;
type CardFieldId = (typeof cardFieldIds)[keyof typeof cardFieldIds];

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
  const { session, clear: clearSession } = useSession();
  const actor = session!.user.userId;
  const [recovery] = useState(() => {
    try { return { key: readPendingAttempt("checkout", actor), error: null }; }
    catch (error) { return { key: null, error: (error as Error).message }; }
  });
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const cartQuery = useCustomerCart(true);
  const stockFocus = useAvailabilityFocus(!cartQuery.data?.items.some(item => !resolveStockStatus(item).canAddToCart), () => document.getElementById("checkout-stock-blocker"));
  const addressesQuery = useQuery({
    queryKey: addressesQueryKey,
    queryFn: ({ signal }) => listAddresses(signal),
    enabled: cartQuery.data?.requiresPhysicalFulfillment === true,
    meta: { authRequired: true },
    retry: (count, error) => !(error instanceof ApiRequestError && error.status < 500) && count < 1,
  });
  const submitLock = useRef(false);
  const pendingKey = useRef<string | null>(recovery.key);
  const cardNumberServerError = useRef<string | null>(null);
  const problemRef = useRef<HTMLDivElement>(null);
  const [phase, setPhase] = useState<Phase>(recovery.key ? "unknown" : "idle");
  const [problem, setProblem] = useState<Problem | null>(recovery.error ? { title: "No enviamos tu pedido.", detail: recovery.error } : null);
  const [addressEditor, setAddressEditor] = useState({ opened: false, opening: 0 });
  const addressTrigger = useRef<HTMLElement | null>(null);
  const [choosingPayment, setChoosingPayment] = useState(false);
  // Card details live only in this form: they are confirmed in the dialog, sent once and then discarded.
  const [cardDialog, setCardDialog] = useState(false);
  const [cvvHelpOpened, setCvvHelpOpened] = useState(false);
  const cvvHelpTrigger = useRef<HTMLButtonElement>(null);
  const [cardConfirmed, setCardConfirmed] = useState(false);
  const [cardWasCleared, setCardWasCleared] = useState(false);
  const [cardAutofocus, setCardAutofocus] = useState<CardFieldId>("checkout-card-number");
  const cardTrigger = useRef<HTMLElement | null>(null);
  const cardRestore = useRef<{ method: CheckoutValues["paymentMethod"] | undefined; values: [string, string, string, string] | null }>({ method: undefined, values: null });
  const phone = useMediaQuery("(max-width: 599px)") ?? false;
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
    getFieldState,
    trigger,
    resetField,
    formState: { errors },
  } = useForm<CheckoutValues>({
    resolver: zodResolver(checkoutSchema),
    defaultValues: { fulfillmentMethod: "HOME_DELIVERY", addressId: "", pickupLocationId: "", paymentMethod: undefined, cardNumber: "", expiration: "", cvv: "", cardholder: "" },
    // Focus is placed explicitly: the address choice may have no input to focus yet.
    shouldFocusError: false,
  });
  const cardNumberRegistration = register("cardNumber");
  const cvvRegistration = register("cvv");
  const reduceMotion = useReducedMotion();
  const paymentMethod = watch("paymentMethod");
  const methodSettled = (paymentMethod === "CARD" && cardConfirmed) || paymentMethod === "TRANSFER";
  const paymentReady = methodSettled && !cardDialog;
  const cardNumber = watch("cardNumber");
  const cardBrand = detectCardBrand(cardNumber);
  const transferDetails = useTransferDetails(paymentMethod === "TRANSFER");
  const addressId = watch("addressId");
  const addresses = addressesQuery.data;
  const fulfillmentMethod = watch("fulfillmentMethod");
  // Presentation follows the current cart; checkout still enforces eligibility in PostgreSQL.
  const digitalOnly = cartQuery.data?.requiresPhysicalFulfillment === false;
  useEffect(() => {
    if (digitalOnly && fulfillmentMethod !== "DIGITAL_ONLY") setValue("fulfillmentMethod", "DIGITAL_ONLY");
    else if (!digitalOnly && fulfillmentMethod === "DIGITAL_ONLY") setValue("fulfillmentMethod", "HOME_DELIVERY");
  }, [digitalOnly, fulfillmentMethod, setValue]);
  const pickupLocationId = watch("pickupLocationId");
  const pickupQuery = useQuery({
    queryKey: pickupLocationsQueryKey,
    queryFn: ({ signal }) => listPickupLocations(signal),
    enabled: fulfillmentMethod === "STORE_PICKUP",
    retry: false,
  });
  const selectedPickup = pickupQuery.data?.find(location => location.id === pickupLocationId);
  useEffect(() => {
    if (pickupQuery.isError || !pickupQuery.data || !pickupLocationId || selectedPickup) return;
    setValue("pickupLocationId", "");
    setError("pickupLocationId", { message: "Ese punto ya no está disponible. Elige otro punto o Entrega." });
  }, [pickupQuery.data, pickupQuery.isError, pickupLocationId, selectedPickup, setError, setValue]);

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

  useEffect(() => {
    function recover() {
      if (submitLock.current) return;
      try {
        const key = readPendingAttempt("checkout", actor);
        if (key && !pendingKey.current) { pendingKey.current = key; setPhase("unknown"); }
      } catch (error) { setProblem({ title: "No podemos iniciar otra compra.", detail: (error as Error).message }); }
    }
    window.addEventListener("storage", recover);
    return () => window.removeEventListener("storage", recover);
  }, [actor]);

  const reconcile = useMutation({
    mutationFn: (key: string) => resolveCheckout(key),
    retry: false,
    onSuccess: async (result, key) => {
      if (pendingKey.current !== key) return;
      if (result.state === "PENDING") { setPhase("unknown"); return; }
      try { clearPendingAttempt("checkout", actor, key); }
      catch (error) { setPhase("unknown"); setProblem({ title: "El resultado está confirmado.", detail: (error as Error).message }); return; }
      pendingKey.current = null;
      if (result.state === "CREATED") {
        await queryClient.invalidateQueries({ queryKey: cartQueryKey });
        await queryClient.invalidateQueries({ queryKey: ["customer-library"] });
        navigate(`/orders/${result.order.orderId}`, { replace: true, state: { purchased: true } });
        return;
      }
      await cartQuery.refetch();
      setPhase("idle");
      setProblem({ title: "No se creó ningún pedido.", detail: "El servidor confirmó que este intento no creó un pedido y lo cerró. Revisa tu carrito antes de iniciar una nueva compra simulada." });
    },
    onError: (error: Error, key) => {
      if (pendingKey.current !== key) return;
      if (error instanceof ApiRequestError && error.status === 401) { clearSession("expired"); return; }
      setPhase("unknown");
    },
  });

  function focusFirstInvalid(invalid: Partial<Record<keyof CheckoutValues, unknown>>) {
    if (invalid.pickupLocationId) {
      (document.querySelector<HTMLElement>('input[name="pickupLocationId"]') ?? document.getElementById("checkout-change-pickup"))?.focus();
    } else if (invalid.addressId) {
      (document.querySelector<HTMLElement>('input[name="addressId"]') ?? document.getElementById("checkout-add-address") ?? document.getElementById("checkout-change-address"))?.focus();
    } else if (invalid.paymentMethod) {
      setChoosingPayment(true);
      requestAnimationFrame(() => document.querySelector<HTMLElement>('[data-purchase="payment-method"]')?.focus());
    } else {
      const field = cardFieldOrder.find((name) => invalid[name]);
      if (field) openCardDialog(cardFieldIds[field]);
    }
  }

  function returnFocusTo(element: HTMLElement | null, fallbackId: string) {
    requestAnimationFrame(() => (element?.isConnected ? element : document.getElementById(fallbackId))?.focus({ preventScroll: true }));
  }

  function openAddressEditor(trigger: HTMLElement) {
    addressTrigger.current = trigger;
    setAddressNotice(null);
    setAddressEditor((state) => ({ opened: true, opening: state.opening + 1 }));
  }

  /** Opens the card dialog on `focus`; an already confirmed card can be put back if the customer cancels. */
  function openCardDialog(focus: CardFieldId = "checkout-card-number", trigger?: HTMLElement) {
    if (cardDialog) { document.getElementById(focus)?.focus(); return; }
    cardTrigger.current = trigger ?? null;
    cardRestore.current = {
      method: getValues("paymentMethod"),
      values: cardConfirmed ? getValues(["cardNumber", "expiration", "cvv", "cardholder"]) : null,
    };
    if (getValues("paymentMethod") !== "CARD") setValue("paymentMethod", "CARD");
    clearErrors("paymentMethod");
    setCardAutofocus(focus);
    setCardDialog(true);
  }

  function cancelCard() {
    setCvvHelpOpened(false);
    const { method, values } = cardRestore.current;
    if (values) {
      cardFieldOrder.forEach((name, index) => setValue(name, values[index]));
      clearErrors([...cardFieldOrder]);
    } else {
      cardFieldOrder.forEach((name) => resetField(name, { defaultValue: "" }));
      if (method === "TRANSFER") setValue("paymentMethod", "TRANSFER");
      else if (!method) resetField("paymentMethod");
    }
    setCardDialog(false);
    returnFocusTo(cardTrigger.current, "checkout-change-payment");
  }

  async function confirmCard() {
    if (!(await trigger([...cardFieldOrder]))) {
      const first = cardFieldOrder.find((name) => getFieldState(name).invalid);
      if (first) document.getElementById(cardFieldIds[first])?.focus();
      return;
    }
    setCardConfirmed(true);
    setCvvHelpOpened(false);
    setCardWasCleared(false);
    setChoosingPayment(false);
    setCardDialog(false);
    returnFocusTo(null, "checkout-change-payment");
  }

  function chooseTransfer() {
    setValue("paymentMethod", "TRANSFER", { shouldValidate: true });
    setCardConfirmed(false);
    setCardWasCleared(false);
    setChoosingPayment(false);
    returnFocusTo(null, "checkout-change-payment");
  }

  const submit = handleSubmit(async (values) => {
    const destinationUnavailable = values.fulfillmentMethod === "DIGITAL_ONLY" ? false : values.fulfillmentMethod === "HOME_DELIVERY"
      ? addressesQuery.isPending || addressesQuery.isError || addressesQuery.isFetching
      : pickupQuery.isPending || pickupQuery.isError || pickupQuery.isFetching || !selectedPickup;
    if (recovery.error || submitLock.current || phase !== "idle" || destinationUnavailable || !paymentReady || (values.paymentMethod === "TRANSFER" && !transferDetails.data)) return;
    const displayedCart = cartQuery.data;
    if (!displayedCart) return;
    submitLock.current = true;
    cardNumberServerError.current = null;
    setProblem(null);
    setPhase("checking");

    try {
      // Revalidate the cart before recording an actor-scoped attempt and sending the command.
      let fresh: CartDetail;
      try {
        fresh = await getCartDetail();
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
      if (fresh.items.some((item) => !resolveStockStatus(item).canAddToCart)) {
        setPhase("idle");
        setProblem({
          title: "Hay libros no disponibles en tu carrito.",
          detail: "Ajusta o quita esos libros antes de finalizar la compra.",
          action: "cart",
        });
        return;
      }

      try {
        const existing = readPendingAttempt("checkout", actor);
        if (existing) { pendingKey.current = existing; setPhase("unknown"); return; }
        pendingKey.current = await beginPendingAttempt("checkout", actor);
      } catch (error) {
        setPhase("idle");
        setProblem({ title: "No enviamos tu pedido.", detail: (error as Error).message });
        return;
      }
      const transactionKey = pendingKey.current!;
      const transactionStartedAt = Date.now();
      setPhase("submitting");
      let result: CheckoutResult;
      try {
        result = await submitCheckout({
          ...(values.fulfillmentMethod === "DIGITAL_ONLY"
            ? { fulfillmentMethod: "DIGITAL_ONLY" } as const
            : values.fulfillmentMethod === "STORE_PICKUP"
            ? { fulfillmentMethod: "STORE_PICKUP", pickupLocationId: values.pickupLocationId } as const
            : { addressId: values.addressId }),
          expectedCartId: fresh.cartId!,
          paymentMethod: values.paymentMethod,
          cardNumber: values.paymentMethod === "CARD" ? normalizeCardNumber(values.cardNumber) : undefined,
        }, transactionKey);
      } catch (error) {
        await holdTransactionFeedback(transactionStartedAt, reduceMotion);
        await handleCheckoutError(error, transactionKey);
        return;
      }

      await holdTransactionFeedback(transactionStartedAt, reduceMotion);
      try { clearPendingAttempt("checkout", actor, transactionKey); }
      catch { setPhase("unknown"); return; }
      pendingKey.current = null;
      await queryClient.invalidateQueries({ queryKey: cartQueryKey });
        await queryClient.invalidateQueries({ queryKey: ["customer-library"] });
      navigate(`/orders/${result.orderId}`, { replace: true, state: { purchased: true } });
    } finally {
      // Never keep the card number after an attempt, whatever the outcome.
      resetField("cardNumber", { defaultValue: "" });
      resetField("cvv", { defaultValue: "" });
      if (values.paymentMethod === "CARD") { setCardConfirmed(false); setCardWasCleared(true); }
      if (cardNumberServerError.current) {
        setError("cardNumber", { type: "server", message: cardNumberServerError.current });
        cardNumberServerError.current = null;
        openCardDialog("checkout-card-number");
      }
      submitLock.current = false;
    }
  }, focusFirstInvalid);

  async function handleCheckoutError(error: unknown, key: string) {
    if (pendingKey.current !== key) return;
    if (error instanceof CheckoutOutcomeUnknown || !(error instanceof ApiRequestError)) {
      setPhase("unknown");
      return;
    }
    if (error.status === 401) {
      clearSession("expired");
      return;
    }

    try { clearPendingAttempt("checkout", actor, key); }
    catch { setPhase("unknown"); return; }
    pendingKey.current = null;
    setPhase("idle");
    const code = error.code;
    const fields=(["addressId","pickupLocationId","fulfillmentMethod","paymentMethod","cardNumber"] as const).filter((field) => {
      const message=fieldErrorMessages(error,field);
      if(message) {
        setError(field,{type:"server",message});
        if(field==="addressId") setChangingAddress(true);
        if(field==="cardNumber") cardNumberServerError.current=message;
      }
      return Boolean(message);
    });
    if(fields.length) { requestAnimationFrame(() => focusFirstInvalid({[fields[0]]:true})); return; }
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
    } else if (code === "P5010" || code === "P5011") {
      setValue("pickupLocationId", "");
      await pickupQuery.refetch();
      setError("pickupLocationId", { type: "server", message: error.detail });
      setProblem({ title: error.title, detail: `${error.detail} No se creó ningún pedido. Elige otro punto o Entrega.` });
    } else if (code === "P5012") {
      setProblem({ title: error.title, detail: `${error.detail} No se creó ningún pedido. Puedes elegir Entrega.` });
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
      <PurchaseFlow stage="checkout">
        <CheckoutHeading />
        <p className={classes.status} role="status">Consultando tu carrito…</p>
      </PurchaseFlow>
    );
  }

  if (!cart) {
    return (
      <PurchaseFlow stage="checkout">
        <CheckoutHeading />
        <ReadFailure onRetry={() => void cartQuery.refetch()} retrying={cartQuery.isFetching} />
      </PurchaseFlow>
    );
  }

  if (cart.items.length === 0 && phase === "idle" && !problem) {
    return (
      <PurchaseFlow stage="checkout">
        <section className={classes.empty} aria-labelledby="checkout-empty-heading">
          <MaterialSymbol name="shopping_cart" size={34} />
          <h1 id="checkout-empty-heading">Tu carrito está vacío.</h1>
          <p>Para finalizar una compra necesitas al menos un libro en el carrito.</p>
          <ButtonLink variant="primary" to="/catalog">Ir al catálogo</ButtonLink>
        </section>
      </PurchaseFlow>
    );
  }

  const unavailable = cart.items.some((item) => !resolveStockStatus(item).canAddToCart);
  // Match the primary selection effect during its first render, avoiding a transient chooser.
  const selectedAddress = addresses?.find((address) => address.addressId === addressId)
    ?? addresses?.find(address => address.primary) ?? addresses?.[0];
  // The customer must settle payment first; submitting still validates the destination and current data.
  const submitBlocked = Boolean(recovery.error) || busy || phase === "unknown" || phase === "reconciling" || unavailable
    || !paymentReady
    || cart.items.length === 0
    || (fulfillmentMethod === "DIGITAL_ONLY" ? false : fulfillmentMethod === "HOME_DELIVERY"
      ? addressesQuery.isPending || addressesQuery.isError || addressesQuery.isFetching
      : pickupQuery.isPending || pickupQuery.isError || pickupQuery.isFetching || pickupQuery.data?.length === 0)
    || (paymentMethod === "TRANSFER" && !transferDetails.data);

  const submitLabel = "Hacer pedido";
  // The window is the server's (cart API); without it Checkout states no estimate.
  const deliveryWindow = deliveryDateRangeLabel(cart.estimatedDeliveryFrom, cart.estimatedDeliveryTo);
  // The choice is open until a method is complete, while the customer is changing it, or when the server refused it.
  const showPaymentOptions = !methodSettled || choosingPayment || Boolean(errors.paymentMethod);

  return (
    <PurchaseFlow stage="checkout">
      <CheckoutHeading />

      {problem && (
        <div className={classes.problem} role="alert" tabIndex={-1} ref={problemRef}>
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
            reconcile.mutate(pendingKey.current!);
          }}
        />
      )}

      <PurchaseLayout summary={
        <PurchaseSummary
          headingId="checkout-summary-heading"
          title={<><span className={classes.checkoutSummaryLine}>Resumen</span>{" "}<span className={classes.checkoutSummaryLine}>del pedido</span></>}
          lines={cart.items.map((item) => ({
            key: item.cartItemId,
            title: item.title,
            meta: [item.format ? formatEdition(item.format) : null, `${unitsLabel(item.quantity)} × ${formatUsd(item.currentPrice)}`].filter(Boolean).join(" · "),
            amount: formatUsd(item.currentSubtotal),
            extra: !resolveStockStatus(item).canAddToCart
              ? <StockStatus available={item.available} unavailabilityReason={item.unavailabilityReason} size="compact" className={surface.summaryStatus} />
              : undefined,
          }))}
          totals={[
            ...(cart.subtotal ? [{ label: "Subtotal", value: formatUsd(cart.subtotal) }] : []),
            ...(cart.taxAmount ? [{ label: ivaLabel(cart.taxRate), value: formatUsd(cart.taxAmount) }] : []),
            ...(cart.shippingAmount ? [{ label: "Gastos de envío", value: formatUsd(cart.shippingAmount) }] : []),
            { label: "Total", value: formatUsd(cart.total ?? cart.totalCurrent), total: true },
          ]}
        >
          {busy && (
            <motion.p
              className={classes.status}
              role="status"
              initial={reduceMotion ? false : { opacity: 0, y: 3 }}
              animate={{ opacity: 1, y: 0 }}
              transition={reduceMotion ? { duration: 0 } : { duration: 0.16, ease: [0.16, 1, 0.3, 1] }}
            >
              {phase === "checking" ? "Confirmando tu carrito…" : "Creando tu pedido simulado…"}
            </motion.p>
          )}
          {unavailable && (
            <p id="checkout-stock-blocker" tabIndex={-1} className={classes.blocker} role="status">
              Hay libros no disponibles. <Link to="/cart">Ajusta tu carrito</Link> para continuar.
            </p>
          )}
          <Button
            className={classes.checkoutAction}
            variant="primary"
            type="submit"
            form="checkout-form"
            aria-label={busy ? "Procesando compra" : submitLabel}
            disabled={unavailable || !paymentReady}
            {...stockFocus}
            aria-describedby={unavailable ? "checkout-stock-blocker" : undefined}
            aria-disabled={submitBlocked || undefined}
            aria-busy={busy || undefined}
            onClick={(event) => {
              if (submitBlocked) event.preventDefault();
            }}
          >
            <TransactionButtonLabel state={busy ? "pending" : "idle"} idle={submitLabel} pending="Procesando…" success="Pedido creado" reserve={submitLabel} />
          </Button>
        </PurchaseSummary>
      }>
          {!digitalOnly && <>
          <FulfillmentTabs pickupAvailable={!digitalOnly} value={fulfillmentMethod} disabled={phase !== "idle" || Boolean(recovery.error)} onChange={(method: CheckoutFulfillmentMethod) => {
            setValue("fulfillmentMethod", method);
            clearErrors(["addressId", "pickupLocationId", "fulfillmentMethod"]);
          }} />
          <section id="checkout-destination" role="tabpanel" tabIndex={0} className={`${classes.panel} ${classes.fieldError} ${classes.checkoutDestination} ${pickupClasses.destination}`} aria-labelledby={`fulfillment-tab-${fulfillmentMethod}`} data-fulfillment={fulfillmentMethod}>
            {fulfillmentMethod === "STORE_PICKUP" ? <>
              <PickupLocationPicker query={pickupQuery} value={pickupLocationId} disabled={phase !== "idle"} error={errors.pickupLocationId?.message}
                onChange={id => { setValue("pickupLocationId", id, { shouldValidate: true }); }}>
              <ul className={classes.shipmentItems} aria-label="Libros para retirar">
                {cart.items.filter(item => item.requiresPhysicalFulfillment).map(item => <li key={item.cartItemId}>
                  <span className={classes.shipmentCover}><BookCover url={item.coverUrl} license={null} attribution={null} title={item.title} size="compact" decorative /></span>
                  <strong>{item.title}</strong>
                </li>)}
              </ul>
              </PickupLocationPicker>
            </> : <>
            <div className={classes.panelHead}>
              <h2 id="checkout-address-heading">Entregar en</h2>
              {selectedAddress && addresses && addresses.length > 0 && (
                <button type="button" id="checkout-change-address" className={classes.linkAction} aria-expanded={changingAddress} onClick={() => setChangingAddress((value) => !value)}>
                  {changingAddress ? "Cerrar" : "Cambiar dirección"}
                </button>
              )}
            </div>
            {addressesQuery.isPending ? (
              <p className={classes.status} role="status">Consultando tus direcciones…</p>
            ) : !addresses ? (
              <ReadFailure
                title="No pudimos consultar tus direcciones."
                onRetry={() => void addressesQuery.refetch()}
                retrying={addressesQuery.isFetching}
              />
            ) : (
              <>
                {addressesQuery.isError && <p className="stale-data-note" role="status">No pudimos actualizar tus direcciones. Se muestra la última consulta disponible. <Button variant="text" type="button" onClick={() => void addressesQuery.refetch()}>Actualizar</Button></p>}
                {addressNotice && <p className={classes.notice} role="status">{addressNotice}</p>}
                {selectedAddress && !changingAddress && (
                  <address className={classes.deliverTo} data-purchase="selected-address">
                    <strong>{selectedAddress.recipient}</strong>
                    <span>{selectedAddress.line1}{selectedAddress.line2 ? `, ${selectedAddress.line2}` : ""}</span>
                    <span>{[selectedAddress.city, selectedAddress.province].filter(Boolean).join(", ")}</span>
                    <span>{selectedAddress.phone}</span>
                  </address>
                )}
                {addresses.length > 0 && (changingAddress || !selectedAddress) && (
                  <>
                    <fieldset
                      className={classes.choices}
                      aria-describedby={errors.addressId ? "address-error" : undefined}
                      aria-invalid={Boolean(errors.addressId) || undefined}
                    >
                      <legend className="visually-hidden">Elige dónde recibir tu pedido</legend>
                      {addresses.map((address) => (
                        <AddressChoice key={address.addressId} address={address} disabled={busy || addressesQuery.isError || addressesQuery.isFetching} onSelect={() => {
                          setChangingAddress(false);
                          requestAnimationFrame(() => document.getElementById("checkout-change-address")?.focus());
                        }} {...register("addressId")} />
                      ))}
                    </fieldset>
                    <button type="button" className={classes.addRow} disabled={busy} onClick={(event) => openAddressEditor(event.currentTarget)}>
                      <MaterialSymbol name="add" aria-hidden="true" size={24} /><span>Añadir nueva dirección</span>
                    </button>
                    <p className={classes.helper}>Puedes editar o eliminar tus direcciones en <Link to="/account/addresses">Direcciones</Link>.</p>
                  </>
                )}
                {addresses.length === 0 && (
                  <>
                    <p className={classes.hint}>Aún no tienes una dirección guardada. Añade una para recibir tu pedido.</p>
                    <button type="button" id="checkout-add-address" className={classes.addRow} disabled={busy} aria-describedby={errors.addressId ? "address-error" : undefined} onClick={(event) => openAddressEditor(event.currentTarget)}>
                      <MaterialSymbol name="add" aria-hidden="true" size={24} /><span>Añadir dirección</span>
                    </button>
                  </>
                )}
                {errors.addressId && (
                  <FieldMessage id="address-error" tone="error">
                    {addresses.length === 0 ? "Guarda una dirección de entrega antes de realizar el pedido." : errors.addressId.message}
                  </FieldMessage>
                )}
                {selectedAddress && !changingAddress && (
                  <div className={classes.shipment}>
                    <p className={classes.panelRule}>{fulfillmentMethodLabel(fulfillmentMethod)}</p>
                    {deliveryWindow && <p className={classes.shipmentWindow}>Entrega {deliveryWindow}</p>}
                    <ul className={classes.shipmentItems} aria-label="Libros de esta entrega">
                      {cart.items.filter(item => item.requiresPhysicalFulfillment).map((item) => (
                        <li key={item.cartItemId}>
                          <span className={classes.shipmentCover}><BookCover url={item.coverUrl} license={null} attribution={null} title={item.title} size="compact" decorative /></span>
                          <strong>{item.title}</strong>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </>
            )}
            </>}
          </section>
          </>}
          {digitalOnly && <p role="note">Esta compra digital no requiere entrega ni retiro. La titularidad se confirma en Mi biblioteca después del pago aprobado.</p>}

          <form id="checkout-form" className={`${classes.panel} ${classes.fieldError} ${classes.checkoutPayment}`} onSubmit={submit} noValidate aria-labelledby="checkout-payment-heading">
            <div className={classes.panelHead}>
              <h2 id="checkout-payment-heading">Pago</h2>
              {methodSettled && (
                <button type="button" id="checkout-change-payment" className={classes.linkAction} aria-expanded={showPaymentOptions} disabled={busy} onClick={() => setChoosingPayment((value) => !value)}>
                  {showPaymentOptions ? "Cerrar" : "Cambiar método de pago"}
                </button>
              )}
            </div>
            {showPaymentOptions ? (
              <>
                <p className={classes.panelSub} id="checkout-payment-prompt">Pagar el importe total</p>
                <div
                  role="group"
                  aria-label="Método de pago"
                  className={classes.options}
                  aria-describedby={errors.paymentMethod ? "payment-method-error" : undefined}
                >
                  <button type="button" className={classes.option} data-purchase="payment-method" aria-haspopup="dialog" aria-pressed={paymentMethod === "CARD" && cardConfirmed} disabled={busy} onClick={(event) => openCardDialog("checkout-card-number", event.currentTarget)}>
                    <span className={classes.methodIcon}><MaterialSymbol name="credit_card" aria-hidden="true" size={28} /></span>
                    <span className={classes.optionName}>Tarjeta de crédito o débito</span>
                    <MaterialSymbol name="chevron_right" aria-hidden="true" size={22} />
                  </button>
                  <button type="button" className={classes.option} data-purchase="payment-method" aria-pressed={paymentMethod === "TRANSFER"} disabled={busy} onClick={chooseTransfer}>
                    <span className={classes.methodIcon}><MaterialSymbol name="account_balance" aria-hidden="true" size={28} /></span>
                    <span className={classes.optionName}>Transferencia bancaria</span>
                  </button>
                </div>
                {paymentMethod === "CARD" && !cardConfirmed && !cardDialog && cardWasCleared && (
                  <p className={classes.helper} role="status">No conservamos los datos de la tarjeta entre intentos. Vuelve a escribirlos para pagar con tarjeta.</p>
                )}
              </>
            ) : paymentMethod === "CARD" ? (
              <div className={classes.chosen} data-purchase="chosen-payment">
                {cardBrand ? <CardBrandMark brand={cardBrand} accepted /> : <span className={classes.methodIcon}><MaterialSymbol name="credit_card" aria-hidden="true" size={22} /></span>}
                <span className={classes.chosenCopy}><strong>{cardBrand ? cardBrandNames[cardBrand] : "Tarjeta"}-{normalizeCardNumber(cardNumber).slice(-4)}</strong></span>
                <p className={classes.moreOptions}>
                  <span aria-hidden="true"><MaterialSymbol name="credit_card" size={20} /><MaterialSymbol name="account_balance" size={20} /></span>
                  Financiación y más opciones disponibles
                </p>
              </div>
            ) : (
              <>
                <div className={classes.chosen} data-purchase="chosen-payment">
                  <span className={classes.methodIcon}><MaterialSymbol name="account_balance" aria-hidden="true" size={22} /></span>
                  <span className={classes.chosenCopy}><strong>Transferencia bancaria</strong></span>
                </div>
                {transferDetails.isPending ? <p className={classes.status} role="status">Consultando datos bancarios…</p> : transferDetails.isError || !transferDetails.data ? <ReadFailure title="No pudimos consultar los datos bancarios." onRetry={() => void transferDetails.refetch()} retrying={transferDetails.isFetching} /> : <div className={classes.transfer} data-purchase="transfer"><TransferFacts details={transferDetails.data} amount={cart.totalCurrent} /></div>}
              </>
            )}
            {errors.paymentMethod && (
              <FieldMessage id="payment-method-error" tone="error">{errors.paymentMethod.message}</FieldMessage>
            )}
          </form>
      </PurchaseLayout>

      <AddressEditorDialog
        opened={addressEditor.opened}
        opening={addressEditor.opening}
        firstAddress={(addresses?.length ?? 0) === 0}
        disabled={addressesQuery.isError || addressesQuery.isFetching}
        onClose={() => { setAddressEditor((state) => ({ ...state, opened: false })); returnFocusTo(addressTrigger.current, "checkout-change-address"); }}
        onSaved={async (savedId) => {
          const refreshed = await addressesQuery.refetch();
          setAddressEditor((state) => ({ ...state, opened: false }));
          setChangingAddress(false);
          if (refreshed.data?.some((address) => address.addressId === savedId)) {
            setValue("addressId", savedId, { shouldValidate: true });
          }
          setAddressNotice("Guardamos la dirección y la elegimos para este pedido.");
          returnFocusTo(null, "checkout-change-address");
        }}
        onUncertain={async () => { await addressesQuery.refetch(); }}
        onSessionExpired={() => clearSession("expired")}
      />

      <Modal.Root opened={cardDialog} onClose={cancelCard} centered={!phone} fullScreen={phone} size={540} returnFocus={false}
        closeOnEscape={!cvvHelpOpened} closeOnClickOutside={!cvvHelpOpened} trapFocus={!cvvHelpOpened}
        classNames={{ content: `storefront-panel ${classes.flow} ${classes.cardDialog}`, header: classes.dialogHeader, title: classes.dialogTitle, body: classes.dialogBody, close: classes.dialogClose }}
        transitionProps={{ transition: phone ? "slide-up" : "pop", duration: reduceMotion ? 0 : 200, timingFunction: "cubic-bezier(.32, .94, .6, 1)" }}>
        <Modal.Overlay backgroundOpacity={0.28} color="#252740" />
        <Modal.Content inert={cvvHelpOpened || undefined}>
          <Modal.Header role="presentation">
            <Modal.Title>Tarjeta de crédito o débito</Modal.Title>
            <Modal.CloseButton aria-label="Cerrar sin usar la tarjeta" />
          </Modal.Header>
          <Modal.Body>
            <form noValidate aria-label="Datos de la tarjeta" onSubmit={(event) => { event.preventDefault(); void confirmCard(); }}>
                <div className={classes.cardFields}>
                    <ul className={classes.brands} aria-label="Tarjetas de prueba compatibles">
                      {supportedCardBrands.map((brand) => (
                        <li key={brand}><CardBrandMark brand={brand} accepted /></li>
                      ))}
                    </ul>
                  <div className={`form-field ${classes.wide}`}>
                    <label htmlFor="checkout-card-number">Número de tarjeta</label>
                    <div className={classes.cardNumber}>
                      <input
                        id="checkout-card-number"
                        data-autofocus={cardAutofocus === "checkout-card-number" || undefined}
                        type="text"
                        inputMode="numeric"
                        autoComplete="off"
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
                    <label htmlFor="checkout-expiration" className={classes.securityPeerLabel}>Caducidad (MM/AA)</label>
                    <Controller
                      control={control}
                      name="expiration"
                      render={({ field }) => (
                        <input
                          id="checkout-expiration"
                          data-autofocus={cardAutofocus === "checkout-expiration" || undefined}
                          ref={field.ref}
                          name={field.name}
                          type="text"
                          inputMode="numeric"
                          autoComplete="off"
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
                    <CardSecurityCodeHelp controlId={cardFieldIds.cvv} brand={cardBrand} opened={cvvHelpOpened}
                      onChange={setCvvHelpOpened} triggerRef={cvvHelpTrigger} disabled={busy || !cardDialog} reducedMotion={Boolean(reduceMotion)} />
                    <input
                      id="checkout-cvv"
                      data-autofocus={cardAutofocus === "checkout-cvv" || undefined}
                      type="password"
                      inputMode="numeric"
                      autoComplete="off"
                      maxLength={cardBrand === "amex" ? 4 : 3}
                      disabled={busy}
                      aria-invalid={Boolean(errors.cvv) || undefined}
                      aria-describedby={errors.cvv ? "cvv-help cvv-error" : "cvv-help"}
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
                    <span id="cvv-help" className="visually-hidden">{cardBrand === "amex" ? "4 dígitos en el frente." : "3 dígitos al reverso."}</span>
                  </div>
                  <div className={`form-field ${classes.wide}`}><label htmlFor="checkout-cardholder">Nombre en la tarjeta</label><input id="checkout-cardholder" data-autofocus={cardAutofocus === "checkout-cardholder" || undefined} autoComplete="off" maxLength={120} disabled={busy} aria-invalid={Boolean(errors.cardholder) || undefined} aria-describedby={errors.cardholder ? "cardholder-error" : undefined} {...register("cardholder")} />{errors.cardholder && <FieldMessage id="cardholder-error" tone="error">{errors.cardholder.message}</FieldMessage>}</div>
                </div>
              <div className={classes.dialogActions}>
                <Button variant="primary" type="submit">Usar esta tarjeta</Button>
                <Button variant="text" type="button" onClick={cancelCard}>Cancelar</Button>
              </div>
            </form>
          </Modal.Body>
        </Modal.Content>
      </Modal.Root>
    </PurchaseFlow>
  );
}

/** The purchase header names the place ("Pago (n artículos)"); the page keeps its heading for assistive technology. */
function CheckoutHeading() {
  return <h1 className="visually-hidden">Finalizar compra</h1>;
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
  const names = cardBrandNames;
  const logoProps = { "aria-hidden": true as const, focusable: false as const, width: accepted ? 48 : 42, height: accepted ? 28 : 25 };
  const logo = brand === "visa"
    ? <VisaLogoIcon {...logoProps} />
    : brand === "mastercard"
    ? <MastercardLogoIcon {...logoProps} />
    : brand === "amex"
    ? <AmericanExpressLogoIcon {...logoProps} />
    : <DinersClubLogoIcon {...logoProps} />;
  return <span className={classes.brand} data-accepted={accepted ? "" : undefined} role="img" aria-label={accepted ? names[brand] : `${names[brand]} detectada`}>
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
    <div className={classes.problem} data-kind="unknown" role="alert" tabIndex={-1} ref={ref}>
      <h2>No pudimos confirmar si se creó tu pedido.</h2>
      <p>
        El resultado sigue pendiente. Es posible que el pedido se haya registrado o que la operación siga en curso. Consulta este intento; podrás iniciar otra compra cuando el servidor confirme el resultado.
      </p>
      {failed && !reconciling && (
        <p className={classes.problemDetail}>Todavía no pudimos consultar tus pedidos. Comprueba tu conexión.</p>
      )}
      <Button variant="secondary" type="button" onClick={onReconcile} aria-disabled={reconciling || undefined} aria-busy={reconciling || undefined}>
        {reconciling ? "Consultando resultado…" : "Consultar resultado"}
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
    <label className={classes.choice}>
      <input type="radio" value={address.addressId} disabled={disabled} {...field} onChange={(event) => { void field.onChange(event); onSelect(); }} />
      <span className={classes.choiceCopy}>
        <strong>{address.alias}</strong>
        {lines.map((line) => <span key={line}>{line}</span>)}
        <span>{address.phone}</span>
      </span>
    </label>
  );
}

function cartSignature(cart: CartDetail) {
  return JSON.stringify([
    cart.totalCurrent,
    cart.requiresPhysicalFulfillment,
    cart.items.map((item) => [item.cartItemId, item.quantity, item.currentPrice, item.available, item.format]),
  ]);
}
