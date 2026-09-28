import { z } from "zod";
import { apiClient } from "./client";
import { toApiRequestError } from "./errors";

const moneySchema = z.string().regex(/^\d+\.\d{2}$/);

export type PaymentMethod = "CARD" | "TRANSFER";
export interface CheckoutCommand {
  addressId: string;
  paymentMethod: PaymentMethod;
  /** Transient; sent only for CARD and never stored by the client. */
  cardNumber?: string;
}

const checkoutResultSchema = z.object({
  orderId: z.string().min(1),
  orderState: z.string().min(1),
  paymentState: z.string().min(1),
  total: moneySchema,
  paymentReference: z.string().nullable().optional(),
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

export async function submitCheckout(command: CheckoutCommand): Promise<CheckoutResult> {
  const body = command.paymentMethod === "CARD"
    ? { ...command, simulationOutcome: "APPROVED" }
    : { addressId: command.addressId, paymentMethod: command.paymentMethod, simulationOutcome: "APPROVED" };

  const result = await apiClient.POST("/api/v1/checkout", { body }).catch(() => {
    throw new CheckoutOutcomeUnknown();
  });

  const { data, error, response } = result;
  if (response.status === 201) {
    const parsed = checkoutResultSchema.safeParse(data);
    if (!parsed.success) throw new CheckoutOutcomeUnknown();
    return parsed.data;
  }

  // 5xx other than P5007 (reference collision, fully rolled back) may have committed.
  if (response.status >= 500 && !hasCode(error, "P5007")) {
    throw new CheckoutOutcomeUnknown();
  }

  throw toApiRequestError(
    response.status,
    error,
    "No pudimos crear el pedido",
    "Revisa los datos e inténtalo otra vez.",
  );
}

const orderSummarySchema = z.object({
  orderId: z.string().min(1),
  createdAt: z.string().optional(),
  orderState: z.string(),
  total: moneySchema,
  paymentState: z.string().nullable().optional(),
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

const orderDetailSchema = z.object({
  orderId: z.string().min(1),
  orderState: z.string(),
  subtotal: moneySchema.optional(),
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
    newState: z.string().min(1),
    at: z.string().min(1),
  })),
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
