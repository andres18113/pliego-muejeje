import { useCallback, useEffect, useRef, useState } from "react";
import { useMutation, useQueryClient, type QueryKey } from "@tanstack/react-query";
import { useLocation, useNavigate } from "react-router-dom";
import { authLocation } from "@/features/auth/authLocation";
import { deferredAuthState, readCatalogIntent, stripCatalogIntent, type CatalogIntent } from "@/features/favorites/favoriteIntent";
import { addCustomerFavorite, removeCustomerFavorite } from "@/shared/api/favorites";
import { ApiRequestError } from "@/shared/api/errors";
import { addEditionToCart, getActiveCart } from "@/shared/api/cart";
import { useSession } from "@/app/session";
import { availabilityConflictMessage } from "./stockStatusModel";
import type { BookCardFeedback, FavoriteControl, CartControl } from "./bookCardModel";

type FeedbackSink = (value: BookCardFeedback | null) => void;
export interface FavoriteControllerProps { editionId: string; isFavorite: boolean; ready: boolean; queryKey: QueryKey; returnHref: string; onFeedback: FeedbackSink }

export function useFavoriteControl({ editionId, isFavorite, ready, queryKey, returnHref, onFeedback }: FavoriteControllerProps): FavoriteControl {
  const location = useLocation();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { session, clear } = useSession();
  const customer = session?.user.role === "CUSTOMER";
  const [shownFavorite, setShownFavorite] = useState(isFavorite);
  const lastFavoriteProp = useRef(isFavorite);
  const setFeedback = useCallback((value: { message: string; error: boolean } | null) => onFeedback(value ? { kind: value.error ? "error" : "success", message: value.message } : null), [onFeedback]);
  const lock = useRef(false);
  const handledIntent = useRef(false);
  const mutation = useMutation({
    mutationFn: (next: boolean) => next ? addCustomerFavorite(editionId) : removeCustomerFavorite(editionId),
    retry: false,
  });

  useEffect(() => {
    if (lastFavoriteProp.current !== isFavorite) {
      lastFavoriteProp.current = isFavorite;
      setShownFavorite(isFavorite);
    }
  }, [isFavorite]);

  const goToSignIn = useCallback((intent: CatalogIntent) => {
    navigate(authLocation("/sign-in", returnHref), {
      state: deferredAuthState(location.state, intent),
    });
  }, [location.state, navigate, returnHref]);

  const saveFavorite = useCallback(async (next: boolean) => {
    if (lock.current || mutation.isPending) return;
    if (!session) {
      goToSignIn({ kind: "favorite", editionId });
      return;
    }
    if (session.user.role !== "CUSTOMER") {
      setFeedback({ message: "Los favoritos están disponibles para cuentas de cliente.", error: true });
      return;
    }

    lock.current = true;
    setFeedback(null);
    setShownFavorite(next);
    try {
      await mutation.mutateAsync(next);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey }),
        queryClient.invalidateQueries({ queryKey: ["customer-favorites", session.user.userId] }),
      ]);
      setFeedback({ message: next ? "Agregado a favoritos." : "Quitado de favoritos.", error: false });
    } catch (error) {
      setShownFavorite(isFavorite);
      if (error instanceof ApiRequestError && error.status === 401) {
        clear("expired");
        goToSignIn({ kind: "favorite", editionId });
      }
      setFeedback({
        message: error instanceof ApiRequestError && error.code === "P2041"
          ? "Esta edición ya no está disponible en el catálogo."
          : error instanceof ApiRequestError
            ? `${error.title}. ${error.detail}`
            : "No pudimos actualizar tus favoritos. Comprueba tu conexión e inténtalo otra vez.",
        error: true,
      });
    } finally {
      lock.current = false;
    }
  }, [clear, editionId, goToSignIn, isFavorite, mutation, queryClient, queryKey, session, setFeedback]);

  const locationIntent = readCatalogIntent(location.state);
  useEffect(() => {
    if (!customer || !ready || locationIntent?.kind !== "favorite" || locationIntent.editionId !== editionId
        || handledIntent.current) return;
    handledIntent.current = true;
    navigate(`${location.pathname}${location.search}${location.hash}`, {
      replace: true,
      state: stripCatalogIntent(location.state),
    });
    void saveFavorite(true);
  }, [customer, editionId, location.hash, location.pathname, location.search, location.state, locationIntent, navigate, ready, saveFavorite]);

  if (session?.user.role === "ADMIN") return { state: "restricted", reason: "Acciones disponibles para cuentas de cliente." };
  if (customer && !ready) return { state: "unconfirmed", reason: "Favoritos sin confirmar." };
  if (mutation.isPending) return { state: "pending", selected: shownFavorite };
  return { state: "ready", selected: shownFavorite, onPress: () => void saveFavorite(!shownFavorite) };
}

class CartAddOutcomeUnknown extends Error {}
export function useCartControl({ editionId, available, returnHref, onFeedback }: { editionId: string; available: boolean; returnHref: string; onFeedback: FeedbackSink }): CartControl {
  const location = useLocation();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { session, clear } = useSession();
  const [addedPulse, setAddedPulse] = useState(false);
  const setFeedback = useCallback((value: { message: string; error: boolean } | null) => onFeedback(value ? { kind: value.error ? "error" : "success", message: value.message } : null), [onFeedback]);
  const [uncertain, setUncertain] = useState(false);
  const [blockedReason, setBlockedReason] = useState<string | null>(null);
  const lock = useRef(false);
  const pulseTimer = useRef<number | null>(null);
  const handledIntent = useRef(false);
  const mutation = useMutation({
    mutationFn: async () => {
      const cart = await getActiveCart();
      const previousQuantity = cart.items.find((item) => item.editionId === editionId)?.quantity ?? 0;
      try {
        const result = await addEditionToCart(editionId);
        return { quantity: result.quantity, previousQuantity };
      } catch (error) {
        if (!(error instanceof ApiRequestError) || error.status >= 500) {
          try {
            const current = await getActiveCart();
            const currentQuantity = current.items.find((item) => item.editionId === editionId)?.quantity ?? 0;
            if (currentQuantity === previousQuantity + 1) return { quantity: currentQuantity, previousQuantity };
          } catch { /* Preserve uncertainty if the reconciliation read also fails. */ }
          throw new CartAddOutcomeUnknown();
        }
        throw error;
      }
    },
    retry: false,
    onSuccess: async ({ quantity }) => {
      await queryClient.invalidateQueries({ queryKey: ["customer-cart"] });
      setFeedback({ message: quantity === 1 ? "Agregado al carrito." : `El carrito ahora tiene ${quantity} unidades de esta edición.`, error: false });
      setAddedPulse(true);
      if (pulseTimer.current !== null) window.clearTimeout(pulseTimer.current);
      pulseTimer.current = window.setTimeout(() => setAddedPulse(false), 1_100);
    },
    onError: (error) => {
      if (error instanceof ApiRequestError && error.status === 401) {
        clear("expired");
        navigate(authLocation("/sign-in", returnHref), {
          state: deferredAuthState(location.state, { kind: "cart", editionId }),
        });
      }
      const conflict = error instanceof ApiRequestError ? availabilityConflictMessage(error.code) : null;
      if (error instanceof CartAddOutcomeUnknown) setUncertain(true);
      if (conflict) {
        setBlockedReason(conflict);
        void queryClient.invalidateQueries({ queryKey: ["public-catalog"] });
        void queryClient.invalidateQueries({ queryKey: ["customer-favorites"] });
      }
      const message = error instanceof CartAddOutcomeUnknown
        ? "No pudimos confirmar el carrito. Consúltalo antes de volver a intentarlo."
        : error instanceof ApiRequestError
        ? availabilityConflictMessage(error.code) ?? `${error.title}. ${error.detail}`
        : "No pudimos consultar tu carrito. Comprueba tu conexión e inténtalo otra vez.";
      setFeedback({ message, error: true });
    },
    onSettled: () => { lock.current = false; },
  });

  useEffect(() => () => {
    if (pulseTimer.current !== null) window.clearTimeout(pulseTimer.current);
  }, []);

  const locationIntent = readCatalogIntent(location.state);
  useEffect(() => {
    if (session?.user.role !== "CUSTOMER" || !available || locationIntent?.kind !== "cart"
        || locationIntent.editionId !== editionId || handledIntent.current) return;
    handledIntent.current = true;
    navigate(`${location.pathname}${location.search}${location.hash}`, {
      replace: true,
      state: stripCatalogIntent(location.state),
    });
    lock.current = true;
    mutation.mutate();
  }, [available, editionId, location.hash, location.pathname, location.search, location.state, locationIntent, mutation, navigate, session]);

  function addToCart() {
    setFeedback(null);
    setAddedPulse(false);
    if (lock.current || mutation.isPending || uncertain || blockedReason) return;
    if (!session) {
      navigate(authLocation("/sign-in", returnHref), {
        state: deferredAuthState(location.state, { kind: "cart", editionId }),
      });
      return;
    }
    if (session.user.role !== "CUSTOMER") {
      setFeedback({ message: "El carrito está disponible para cuentas de cliente.", error: true });
      return;
    }
    lock.current = true;
    mutation.mutate();
  }

  if (session?.user.role === "ADMIN") return { state: "restricted", reason: "Acciones disponibles para cuentas de cliente." };
  if (uncertain) return { state: "uncertain", recoveryTo: "/cart" };
  if (blockedReason) return { state: "restricted", reason: blockedReason };
  if (mutation.isPending) return { state: "pending" };
  return { state: addedPulse ? "success" : "ready", onPress: addToCart };
}
