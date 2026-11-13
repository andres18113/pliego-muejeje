import { z } from "zod";
import { apiClient } from "./client";
import { toApiRequestError } from "./errors";

/** Matches AdminOrderResponses.Cancellation, including string BIGINT IDs. */
export const adminOrderCancellationSchema = z.object({
  orderId: z.string().min(1), previousState: z.string().min(1), orderState: z.string().min(1),
  paymentState: z.string().min(1), restoredUnits: z.number().int().nonnegative(),
});
export type AdminOrderCancellation = z.infer<typeof adminOrderCancellationSchema>;

export async function cancelAdminOrder(orderId: string): Promise<AdminOrderCancellation> {
  const { data, error, response } = await apiClient.POST("/api/v1/admin/orders/{orderId}/cancel", {
    params: { path: { orderId: orderId as unknown as number } }, cache: "no-store",
  });
  if (!response.ok) throw toApiRequestError(response.status, error, "No pudimos cancelar el pedido", "Consulta el estado actual del pedido antes de volver a intentarlo.");
  const parsed = adminOrderCancellationSchema.safeParse(data);
  if (!parsed.success) throw toApiRequestError(502, {}, "No pudimos confirmar la cancelación", "La respuesta del servidor está incompleta. Consulta el estado actual del pedido.");
  return parsed.data;
}
