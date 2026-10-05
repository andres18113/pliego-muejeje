import { useCallback, useEffect, useRef, useState } from "react";
import { useMutation, useQueryClient, type QueryKey } from "@tanstack/react-query";
import { useLocation, useNavigate } from "react-router-dom";
import { authLocation } from "@/features/auth/authLocation";
import { deferredAuthState, readCatalogIntent, stripCatalogIntent, type CatalogIntent } from "@/features/favorites/favoriteIntent";
import { addCustomerFavorite, removeCustomerFavorite, getCustomerFavoriteStatus, type FavoriteStatus } from "@/shared/api/favorites";
import { ApiRequestError } from "@/shared/api/errors";
import { addEditionToCart, getActiveCart } from "@/shared/api/cart";
import { isDigitalFormat } from "@/shared/api/editionFormats";
import { useSession } from "@/app/session";
import { availabilityConflictMessage, resolveStockStatus } from "./stockStatusModel";
import type { BookCardFeedback, FavoriteControl, CartControl } from "./bookCardModel";

type FeedbackSink = (value: BookCardFeedback | null) => void;
export interface FavoriteControllerProps { editionId: string; isFavorite: boolean; ready: boolean; queryKey: QueryKey; returnHref: string; onFeedback: FeedbackSink;
  /** Told the confirmed state after a change the server accepted (e.g. so a list can offer to undo a removal). */
  onChanged?: (favorite: boolean) => void }

class FavoriteOutcomeUnknown extends Error {}

export function useFavoriteControl({ editionId, isFavorite, ready, queryKey, returnHref, onFeedback, onChanged }: FavoriteControllerProps): FavoriteControl {
  const location = useLocation();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { session, clear } = useSession();
  const customer = session?.user.role === "CUSTOMER";
  const [shownFavorite, setShownFavorite] = useState(isFavorite);
  const lastFavoriteProp = useRef(isFavorite);
  const setFeedback = useCallback((value: { message: string; error: boolean } | null) => onFeedback(value ? { kind: value.error ? "error" : "success", message: value.message } : null), [onFeedback]);
  const lock = useRef(false);
  const onChangedRef = useRef(onChanged);
  onChangedRef.current = onChanged;
  const [checking, setChecking] = useState(false);
  const [uncertain, setUncertain] = useState(false);
  const handledIntent = useRef(false);
  const mutation = useMutation({
    mutationFn: async (next: boolean) => {
      try {
        await (next ? addCustomerFavorite(editionId) : removeCustomerFavorite(editionId));
        return next;
      } catch (error) {
        if (error instanceof ApiRequestError && error.status < 500) throw error;
        try {
          const statuses = await getCustomerFavoriteStatus([editionId]);
          return statuses.find(status => status.editionId === editionId)!.favorite;
        } catch { throw new FavoriteOutcomeUnknown(); }
      }
    },
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
    setChecking(true);
    try {
      const actual = await mutation.mutateAsync(next);
      setShownFavorite(actual);
      queryClient.setQueriesData<FavoriteStatus[]>({ queryKey: ["customer-favorite-status", session.user.userId] }, old => old?.map(status => status.editionId === editionId ? { ...status, favorite: actual } : status));
      await Promise.all([
        queryClient.invalidateQueries({ queryKey }),
        queryClient.invalidateQueries({ queryKey: ["customer-favorites", session.user.userId] }),
      ]);
      if (actual === next) onChangedRef.current?.(actual);
      setFeedback({ message: actual === next ? (actual ? "Agregado a favoritos." : "Quitado de favoritos.") : (actual ? "El libro sigue guardado en tus favoritos. El cambio no se confirmó." : "El libro no está guardado en tus favoritos. El cambio no se confirmó."), error: actual !== next });
    } catch (error) {
      if (error instanceof FavoriteOutcomeUnknown) {
        setUncertain(true);
        setFeedback({ message: "No pudimos confirmar tus favoritos. Consulta el estado antes de volver a cambiarlo.", error: true });
        return;
      }
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
      setChecking(false);
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
  if (checking || mutation.isPending) return { state: "pending", selected: uncertain ? undefined : shownFavorite, label: uncertain ? "Consultando favorito…" : undefined };
  if (uncertain) return { state: "uncertain", reason: "Favoritos sin confirmar.", onPress: () => {
    if (lock.current) return;
    lock.current = true;
    setChecking(true);
    void getCustomerFavoriteStatus([editionId]).then(async statuses => {
      const actual = statuses.find(status => status.editionId === editionId)!.favorite;
      setShownFavorite(actual);
      queryClient.setQueriesData<FavoriteStatus[]>({ queryKey: ["customer-favorite-status", session?.user.userId] }, old => old?.map(status => status.editionId === editionId ? { ...status, favorite: actual } : status));
      setUncertain(false);
      setFeedback({ message: actual ? "El libro está guardado en tus favoritos." : "El libro no está guardado en tus favoritos.", error: false });
      await queryClient.invalidateQueries({ queryKey: ["customer-favorite-status", session?.user.userId] });
      await queryClient.invalidateQueries({ queryKey: ["customer-favorites", session?.user.userId] });
    }).catch(() => setFeedback({ message: "Aún no pudimos consultar tus favoritos. Conservamos el resultado sin confirmar.", error: true })).finally(() => { lock.current = false; setChecking(false); });
  } };
  return { state: "ready", selected: shownFavorite, onPress: () => void saveFavorite(!shownFavorite) };
}

class CartAddOutcomeUnknown extends Error {}
export function useCartControl({ editionId, available, format, returnHref, onFeedback }: { editionId: string; available: boolean; format?: string; returnHref: string; onFeedback: FeedbackSink }): CartControl {
  const location = useLocation();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { session, clear } = useSession();
  const [addedPulse, setAddedPulse] = useState(false);
  const setFeedback = useCallback((value: { message: string; error: boolean } | null) => onFeedback(value ? { kind: value.error ? "error" : "success", message: value.message } : null), [onFeedback]);
  const [uncertain, setUncertain] = useState(false);
  const lock = useRef(false);
  const pulseTimer = useRef<number | null>(null);
  const handledIntent = useRef(false);
  const mutation = useMutation({
    mutationFn: async () => {
      const cart = await getActiveCart();
      const previousQuantity = cart.items.find((item) => item.editionId === editionId)?.quantity ?? 0;
      if (isDigitalFormat(format) && previousQuantity >= 1) return { quantity: previousQuantity, previousQuantity };
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
    onSuccess: async ({ quantity, previousQuantity }) => {
      await queryClient.invalidateQueries({ queryKey: ["customer-cart"] });
      setFeedback({ message: isDigitalFormat(format) && quantity === previousQuantity ? "Esta edición digital ya está en tu carrito." : quantity === 1 ? "Agregado al carrito." : `El carrito ahora tiene ${quantity} unidades de esta edición.`, error: false });
      setAddedPulse(true);
      if (pulseTimer.current !== null) window.clearTimeout(pulseTimer.current);
      pulseTimer.current = window.setTimeout(() => setAddedPulse(false), 1_100);
    },
    onError: async (error) => {
      if (error instanceof ApiRequestError && error.status === 401) {
        clear("expired");
        navigate(authLocation("/sign-in", returnHref), {
          state: deferredAuthState(location.state, { kind: "cart", editionId }),
        });
      }
      const conflict = error instanceof ApiRequestError ? availabilityConflictMessage(error.code) : null;
      if (error instanceof CartAddOutcomeUnknown) setUncertain(true);
      const message = error instanceof CartAddOutcomeUnknown
        ? "No pudimos confirmar el carrito. Consúltalo antes de volver a intentarlo."
        : error instanceof ApiRequestError
        ? availabilityConflictMessage(error.code) ?? `${error.title}. ${error.detail}`
        : "No pudimos consultar tu carrito. Comprueba tu conexión e inténtalo otra vez.";
      setFeedback({ message, error: true });
      if (conflict) await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["public-catalog"] }),
        queryClient.invalidateQueries({ queryKey: ["customer-favorites"] }),
      ]);
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
    if (lock.current || mutation.isPending || uncertain || !resolveStockStatus({ available }).canAddToCart) return;
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
  if (mutation.isPending) return { state: "pending" };
  return { state: addedPulse ? "success" : "ready", onPress: addToCart };
}
