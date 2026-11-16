import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  collectAdminPickup, getAdminPickup, listAdminPickups, lookupAdminPickup, verifyAdminPickupCode,
  type AdminPickupDetail, type AdminPickupView,
} from "@/shared/api/adminPickups";
import { cancelAdminOrder } from "@/shared/api/adminOrders";
import {
  decideAdminBillingIdentityCorrection, listAdminBillingIdentityCorrections,
  type AdminBillingIdentityCorrection, type AdminBillingIdentityCorrectionDecisionRequest,
} from "@/shared/api/adminBillingIdentityCorrections";
import type { CorrectionStatus, PickupState } from "./adminModels";

export type AdminPickup = AdminPickupView;
export type AdminPickupOrder = AdminPickupDetail;
export type AdminCorrection = AdminBillingIdentityCorrection;

const pickupsKey = ["admin-pickups"] as const;
const correctionsKey = ["admin-identity-corrections"] as const;

/** Server pages, always read fresh: the counter and the review queue change under other admins' hands. */
export function useAdminPickups(criteria: { state?: PickupState; q?: string; page: number; pageSize?: number }) {
  return useQuery({
    queryKey: [...pickupsKey, criteria.state ?? null, criteria.q ?? null, criteria.page, criteria.pageSize ?? 20],
    queryFn: ({ signal }) => listAdminPickups({ state: criteria.state, q: criteria.q, page: criteria.page, pageSize: criteria.pageSize ?? 20 }, signal),
    meta: { authRequired: true }, staleTime: 0, refetchOnMount: "always", retry: false,
  });
}

/** The code is posted, never put in a URL or a query key, and never cached. */
export function useLookupPickup() {
  return useMutation({ meta: { authRequired: true }, mutationFn: (code: string) => lookupAdminPickup(code) });
}

export function useCollectPickup() {
  const queryClient = useQueryClient();
  return useMutation({
    meta: { authRequired: true },
    mutationFn: ({ orderId, pickupCode }: { orderId: string; pickupCode: string }) => collectAdminPickup(orderId, { pickupCode, identityVerified: true }),
    onSettled: (_data, _error, variables) => Promise.all([
      queryClient.invalidateQueries({ queryKey: pickupsKey }),
      queryClient.invalidateQueries({ queryKey: ["admin-pickup", variables.orderId] }),
    ]),
  });
}

export function useAdminCorrections(criteria: { status?: CorrectionStatus; page: number; pageSize?: number }) {
  return useQuery({
    queryKey: [...correctionsKey, criteria.status ?? null, criteria.page, criteria.pageSize ?? 20],
    queryFn: ({ signal }) => listAdminBillingIdentityCorrections({ status: criteria.status, page: criteria.page, pageSize: criteria.pageSize ?? 20 }, signal),
    meta: { authRequired: true }, staleTime: 0, refetchOnMount: "always", retry: false,
  });
}

export function useDecideCorrection() {
  const queryClient = useQueryClient();
  return useMutation({
    meta: { authRequired: true },
    mutationFn: ({ id, ...command }: { id: string } & AdminBillingIdentityCorrectionDecisionRequest) => decideAdminBillingIdentityCorrection(id, command),
    // Decided or refused (another admin first), the list is read again so it shows what is true now.
    onSettled: () => queryClient.invalidateQueries({ queryKey: correctionsKey }),
  });
}

const pickupKey = (orderId: string) => ["admin-pickup", orderId] as const;

/** One pickup order for the counter (ADR 0047): details, customer and state, never its code. */
export function useAdminPickup(orderId: string, enabled = true) {
  return useQuery({
    queryKey: pickupKey(orderId),
    queryFn: ({ signal }) => getAdminPickup(orderId, signal),
    enabled, meta: { authRequired: true }, staleTime: 0, refetchOnMount: "always", retry: false,
  });
}

/** Checks the customer's code against this order only; the server changes nothing. */
export function useVerifyPickupCode(orderId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    meta: { authRequired: true },
    mutationFn: (code: string) => verifyAdminPickupCode(orderId, code),
    onSuccess: (detail) => queryClient.setQueryData(pickupKey(orderId), detail),
  });
}

/** The existing admin cancel command; offered only when the server's own rules allow it. */
export function useCancelPickupOrder(orderId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    meta: { authRequired: true },
    mutationFn: () => cancelAdminOrder(orderId),
    onSettled: () => Promise.all([
      queryClient.invalidateQueries({ queryKey: pickupKey(orderId) }),
      queryClient.invalidateQueries({ queryKey: pickupsKey }),
    ]),
  });
}

/**
 * A code verified at the counter travels to the order's page in memory only — never in the URL, history state or
 * storage — keyed by the admin and the order, and is used once.
 */
const verifiedCodes = new Map<string, string>();
export function rememberVerifiedCode(adminId: string, orderId: string, code: string) {
  verifiedCodes.set(`${adminId}:${orderId}`, code);
}
export function peekVerifiedCode(adminId: string, orderId: string) {
  return verifiedCodes.get(`${adminId}:${orderId}`) ?? null;
}
export function forgetVerifiedCode(adminId: string, orderId: string) {
  verifiedCodes.delete(`${adminId}:${orderId}`);
}
