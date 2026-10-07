import { z } from "zod";
import { apiClient } from "./client";
import { toApiRequestError } from "./errors";
import { fulfillmentSchema } from "./pickup";

const moneySchema = z.string().regex(/^\d+\.\d{2}$/);

/** Immutable purchase snapshot; legacy orders have unknown originals/savings, represented by null or absence. */
const orderPricingFields = {
  originalSubtotal: moneySchema.nullish(),
  savingsTotal: moneySchema.nullish(),
  currentSubtotal: moneySchema.optional(),
  pricingSnapshotAvailable: z.boolean().optional(),
};

export type HomeDeliveryState = "PREPARING" | "IN_TRANSIT" | "OUT_FOR_DELIVERY" | "DELIVERED";
/** Legacy and terminal shipment values are still valid historical projections. */
export type KnownShipmentState = HomeDeliveryState | "PENDING" | "SHIPPED" | "CANCELLED";
const availableActionsSchema = z.object({ cancel: z.boolean(), changeShippingAddress: z.boolean(),
  canCancel: z.boolean().optional(), cancellationDeadline: z.string().nullable().optional(),
  lifecycleState: z.string().optional(), libraryAccessState: z.string().optional() });
export type OrderAvailableActions = z.infer<typeof availableActionsSchema>;

export type PaymentMethod = "CARD" | "TRANSFER";
export type CheckoutCommand = {
  paymentMethod: PaymentMethod;
  /** Transient; sent only for CARD and never stored by the client. */
  cardNumber?: string;
  expectedCartId?: string;
  expectedQuoteFingerprint?: string;
} & (
  | { fulfillmentMethod?: "HOME_DELIVERY"; addressId: string; pickupLocationId?: never }
  | { fulfillmentMethod: "STORE_PICKUP"; pickupLocationId: string; addressId?: never }
  | { fulfillmentMethod: "DIGITAL_ONLY"; addressId?: never; pickupLocationId?: never }
);

const checkoutResultSchema = z.object({
  ...orderPricingFields,
  orderId: z.string().min(1),
  orderState: z.string().min(1),
  paymentState: z.string().min(1),
  total: moneySchema,
  paymentReference: z.string().nullable().optional(),
  fulfillment: fulfillmentSchema.nullish(),
  subtotal: moneySchema.nullish(),
  taxRate: z.string().nullish(),
  taxAmount: moneySchema.nullish(),
  shippingAmount: moneySchema.nullish(),
});

export type CheckoutResult = z.infer<typeof checkoutResultSchema>;

/**
 * Transport failures and unexpected responses become `CheckoutOutcomeUnknown`: the order
 * may exist, so callers must read orders before offering another attempt.
 */
export class CheckoutOutcomeUnknown extends Error {
  constructor() {
    super("No pudimos confirmar el resultado de la compra.");
    this.name = "CheckoutOutcomeUnknown";
  }
}

export async function submitCheckout(command: CheckoutCommand, key: string): Promise<CheckoutResult> {
  const destination = command.fulfillmentMethod === "DIGITAL_ONLY"
    ? { fulfillmentMethod: "DIGITAL_ONLY" as const }
    : command.fulfillmentMethod === "STORE_PICKUP"
    ? { fulfillmentMethod: command.fulfillmentMethod, pickupLocationId: command.pickupLocationId }
    : { addressId: command.addressId, fulfillmentMethod: "HOME_DELIVERY" as const };
  const body = {
    ...destination, expectedCartId: command.expectedCartId, expectedQuoteFingerprint: command.expectedQuoteFingerprint, paymentMethod: command.paymentMethod,
    simulationOutcome: "APPROVED",
    ...(command.paymentMethod === "CARD" ? { cardNumber: command.cardNumber } : {}),
  };

  const result = await apiClient.POST("/api/v1/checkout", { body, params: { header: { "Idempotency-Key": key } } }).catch(() => {
    throw new CheckoutOutcomeUnknown();
  });

  const { data, error, response } = result;
  if (response.status === 201) {
    const parsed = checkoutResultSchema.safeParse(data);
    if (!parsed.success) throw new CheckoutOutcomeUnknown();
    return parsed.data;
  }

  // 5xx other than P5007 (reference collision, fully rolled back) may have committed.
  if (!isConfirmedCheckoutRejection(error)) {
    throw new CheckoutOutcomeUnknown();
  }

  throw toApiRequestError(
    response.status,
    error,
    "No pudimos crear el pedido",
    "Revisa los datos e inténtalo otra vez.",
  );
}

/** Only errors emitted before execution or after a verified rollback prove rejection. */
function isConfirmedCheckoutRejection(problem: unknown) {
  const codes = ["VALIDATION_ERROR", "MALFORMED_JSON", "INVALID_CARD_NUMBER", "AUTH_REQUIRED", "AUTH_INVALID_TOKEN",
    "AUTH_INVALID_SESSION", "ACCESS_DENIED", "P1001", "P1002", "P1003", "P1004", "P1005", "P2042", "P2043",
    "P3001", "P3002", "P4001", "P4002", "P4005", "P5004", "P5005", "P5006", "P5007", "P5010", "P5011", "P5012", "P5013", "P1011"];
  return codes.some((code) => hasCode(problem, code));
}

export async function resolveCheckout(key: string) {
  const { data, error, response } = await apiClient.POST("/api/v1/checkout/attempts/{key}/resolve", {
    params: { path: { key } },
  });
  if (!response.ok) throw toApiRequestError(response.status, error, "Aún no pudimos consultar el resultado", "Comprueba tu conexión. La compra sigue sin resolverse.");
  const parsed = z.discriminatedUnion("state", [
    z.object({ state: z.literal("PENDING"), order: z.null() }),
    z.object({ state: z.literal("NOT_CREATED"), order: z.null() }),
    z.object({ state: z.literal("CREATED"), order: checkoutResultSchema }),
  ]).safeParse(data);
  if (!parsed.success) throw new CheckoutOutcomeUnknown();
  return parsed.data;
}

/*
 * Post-purchase projections (API amendment v1.0.8). Each state is server-authoritative and
 * independent: the commercial purchase, the payment, the physical shipment and the documents are
 * never derived from one another here. Fields stay optional so an older server still parses; the
 * UI then shows less, never guesses.
 */
const nullableText = z.string().nullable().optional().transform((value) => value ?? null);

const orderItemSummarySchema = z.object({
  orderItemId: z.string().min(1),
  title: z.string(),
  format: z.string().nullable().catch(null),
  quantity: z.number().int().positive(),
});

const orderSummarySchema = z.object({
  ...orderPricingFields,
  orderId: z.string().min(1),
  createdAt: z.string().optional(),
  orderState: z.string(),
  total: moneySchema,
  paymentState: z.string().nullable().optional(),
  purchaseState: nullableText,
  fulfillmentMethod: nullableText,
  shipmentState: nullableText,
  estimatedDeliveryFrom: nullableText,
  estimatedDeliveryTo: nullableText,
  itemCount: z.number().int().nonnegative().nullable().optional().transform((value) => value ?? null),
  unitCount: z.number().int().nonnegative().nullable().optional().transform((value) => value ?? null),
  itemSummary: z.array(orderItemSummarySchema).optional().default([]),
  invoiceState: nullableText,
  invoicePdfAvailable: z.boolean().optional().default(false),
  invoiceXmlAvailable: z.boolean().optional().default(false),
  /** Paid breakdown supplied by order snapshots; older list responses may omit it. */
  subtotal: moneySchema.nullish(),
  taxRate: z.string().nullish(),
  taxAmount: moneySchema.nullish(),
  shippingAmount: moneySchema.nullish(),
  availableActions: availableActionsSchema.nullish(),
});

export type OrderSummary = z.infer<typeof orderSummarySchema>;
const orderPageSchema = z.object({
  items: z.array(orderSummarySchema),
  page: z.number().int().nonnegative(),
  pageSize: z.number().int().positive(),
  totalCount: z.string().regex(/^\d+$/),
});
export type OrderPage = z.infer<typeof orderPageSchema>;

export async function listOrders(page: number, pageSize = 10, signal?: AbortSignal): Promise<OrderPage> {
  const { data, error, response } = await apiClient.GET("/api/v1/orders", {
    params: { query: { page, pageSize } }, signal,
  });
  if (!response.ok) throw toApiRequestError(response.status, error, "No pudimos consultar tus pedidos", "Comprueba tu conexión e inténtalo otra vez.");
  const parsed = orderPageSchema.safeParse(data);
  if (!parsed.success) throw toApiRequestError(502, {}, "No pudimos consultar tus pedidos", "La respuesta del servidor está incompleta. Inténtalo otra vez.");
  return parsed.data;
}

export async function listRecentOrders(pageSize = 5, signal?: AbortSignal) {
  const { data, error, response } = await apiClient.GET("/api/v1/orders", {
    params: { query: { page: 0, pageSize } },
    signal,
  });
  if (!response.ok) {
    throw toApiRequestError(response.status, error, "No pudimos consultar tus pedidos", "Comprueba tu conexión e inténtalo otra vez.");
  }
  const parsed = z.object({ items: z.array(orderSummarySchema) }).safeParse(data);
  if (!parsed.success) {
    throw toApiRequestError(502, {}, "No pudimos consultar tus pedidos", "La respuesta del servidor está incompleta. Inténtalo otra vez.");
  }
  return parsed.data.items;
}

const shipmentEventSchema = z.object({
  eventId: z.string().min(1),
  type: z.string(),
  origin: z.string().nullable().catch(null),
  previousState: nullableText,
  newState: nullableText,
  carrier: nullableText,
  trackingCode: nullableText,
  trackingUrl: nullableText,
  at: z.string().min(1),
});

const shipmentSchema = z.object({
  shipmentId: z.string().min(1),
  state: z.string().min(1),
  carrier: nullableText,
  trackingCode: nullableText,
  trackingUrl: nullableText,
  estimatedDeliveryFrom: nullableText,
  estimatedDeliveryTo: nullableText,
  createdAt: nullableText,
  preparingAt: nullableText,
  shippedAt: nullableText,
  outForDeliveryAt: nullableText,
  deliveredAt: nullableText,
  canceledAt: nullableText,
  history: z.array(shipmentEventSchema).optional().default([]),
});

const invoiceSchema = z.object({
  invoiceId: z.string().min(1),
  documentNumber: z.string(),
  state: z.string(),
  buyerName: z.string(),
  identityType: z.string(),
  identityNumber: z.string(),
  buyerEmail: nullableText,
  currency: z.string(),
  subtotal: moneySchema,
  taxTotal: moneySchema,
  total: moneySchema,
  issuedAt: z.string(),
  billingAddress: z.object({
    line1: z.string(),
    line2: nullableText,
    city: z.string(),
    province: z.string(),
    countryCode: z.string(),
    postalCode: nullableText,
  }).nullable().catch(null),
  items: z.array(z.object({
    invoiceItemId: z.string().min(1),
    orderItemId: z.string().nullable().catch(null),
    description: z.string(),
    quantity: z.number().int(),
    unitPrice: moneySchema,
    taxTreatment: z.string(),
    taxRate: nullableText,
    taxAmount: moneySchema,
    total: moneySchema,
  })).optional().default([]),
  electronicIssuance: z.object({
    provider: nullableText,
    state: z.string(),
    externalReference: nullableText,
    submittedAt: nullableText,
    authorizedAt: nullableText,
  }).nullable().optional().transform((value) => value ?? null),
  pdfAvailable: z.boolean().optional().default(false),
  xmlAvailable: z.boolean().optional().default(false),
});

const creditNoteSchema = z.object({
  creditNoteId: z.string().min(1),
  invoiceId: z.string().min(1),
  documentNumber: z.string(),
  state: z.string(),
  reason: z.string(),
  subtotal: moneySchema,
  taxTotal: moneySchema,
  total: moneySchema,
  issuedAt: z.string(),
});

export type OrderShipment = z.infer<typeof shipmentSchema>;
export type OrderInvoice = z.infer<typeof invoiceSchema>;
export type OrderCreditNote = z.infer<typeof creditNoteSchema>;

const orderDetailSchema = z.object({
  ...orderPricingFields,
  orderId: z.string().min(1),
  orderState: z.string(),
  subtotal: moneySchema.optional(),
  taxRate: z.string().nullish(),
  taxAmount: moneySchema.nullish(),
  shippingAmount: moneySchema.nullish(),
  total: moneySchema,
  createdAt: z.string().optional(),
  items: z.array(z.object({
    orderItemId: z.string().min(1),
    editionId: z.string().optional(),
    title: z.string(),
    authors: z.string().nullable().catch(""),
    publisher: z.string().nullable().catch(""),
    format: z.string().nullable().catch(null),
    unitPrice: moneySchema,
    quantity: z.number().int().positive(),
    subtotal: moneySchema,
    originalPrice: moneySchema.nullish(),
    unitSavings: moneySchema.nullish(),
    originalSubtotal: moneySchema.nullish(),
    lineSavings: moneySchema.nullish(),
    pricingSnapshotAvailable: z.boolean().optional(),
    requiresPhysicalFulfillment: z.boolean(),
  })),
  address: z.object({
    recipient: z.string(),
    line1: z.string(),
    line2: z.string().nullable().catch(null),
    city: z.string(),
    province: z.string(),
    countryCode: z.string(),
    postalCode: z.string().nullable().catch(null),
    reference: z.string().nullable().catch(null),
    phone: z.string(),
  }).nullable().catch(null),
  payment: z.object({
    method: z.string(),
    state: z.string(),
    amount: moneySchema,
    reference: z.string().nullable().catch(null),
  }).nullable().catch(null),
  stateHistory: z.array(z.object({
    historyId: z.string().min(1),
    actorUserId: z.string().nullish().catch(null),
    newState: z.string().min(1),
    at: z.string().min(1),
  })),
  purchaseState: nullableText,
  fulfillment: fulfillmentSchema.nullish().transform((value) => value ?? null),
  shipment: shipmentSchema.nullable().optional().transform((value) => value ?? null),
  invoice: invoiceSchema.nullable().optional().transform((value) => value ?? null),
  creditNotes: z.array(creditNoteSchema).optional().default([]),
  /** Advisory server snapshot; commands revalidate. Absent means no action is offered. */
  availableActions: availableActionsSchema.nullable().optional()
    .transform((value) => value ?? { cancel: false, changeShippingAddress: false }),
});

export type OrderDetail = z.infer<typeof orderDetailSchema>;

export async function getOrder(orderId: string, signal?: AbortSignal): Promise<OrderDetail> {
  const { data, error, response } = await apiClient.GET("/api/v1/orders/{orderId}", {
    params: { path: { orderId: orderId as unknown as number } },
    signal,
  });
  if (!response.ok) {
    throw toApiRequestError(response.status, error, "No pudimos consultar el pedido", "Comprueba tu conexión e inténtalo otra vez.");
  }
  const parsed = orderDetailSchema.safeParse(data);
  if (!parsed.success) {
    throw toApiRequestError(502, {}, "No pudimos consultar el pedido", "La respuesta del servidor está incompleta. Inténtalo otra vez.");
  }
  return parsed.data;
}

export class CancellationOutcomeUnknown extends Error {
  constructor() {
    super("No pudimos confirmar si el pedido se canceló.");
    this.name = "CancellationOutcomeUnknown";
  }
}

export async function cancelOrder(orderId: string) {
  const result = await apiClient.POST("/api/v1/orders/{orderId}/cancel", {
    params: { path: { orderId: orderId as unknown as number } },
  }).catch(() => { throw new CancellationOutcomeUnknown(); });
  if (result.response.ok) return result.data;
  if (result.response.status >= 500) throw new CancellationOutcomeUnknown();
  throw toApiRequestError(result.response.status, result.error, "No pudimos cancelar el pedido", "Consulta el estado actual del pedido.");
}

export function isNewerOrderId(candidate: string, baseline: string | null) {
  if (baseline === null) return true;
  try {
    return BigInt(candidate) > BigInt(baseline);
  } catch {
    return false;
  }
}

function hasCode(problem: unknown, code: string) {
  return typeof problem === "object" && problem !== null && "code" in problem && problem.code === code;
}
