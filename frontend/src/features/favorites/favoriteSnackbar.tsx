import { useEffect, useSyncExternalStore } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { UndoToast } from "@/shared/ui/UndoToast";

/**
 * The confirmation for a heart pressed on a catalog, Ofertas or edition card: PLIEGO's snackbar (the same ultramar
 * field as "Quitado del carrito"), one at a time for the whole store. A save offers "Ver favoritos"; a removal offers
 * "Deshacer". Problems never come here: they stay beside the heart that caused them. The Favoritos page keeps its
 * own removal snackbar and reports nothing through this one.
 */
export interface FavoriteSnackbarNotice {
  /** The card that made the change; its snackbar leaves with it, so "Deshacer" never acts for a card that is gone. */
  owner: symbol;
  favorite: boolean;
  title: string;
  undo: () => void;
}

type Shown = { notice: FavoriteSnackbarNotice; key: number; busy: boolean } | null;
let shown: Shown = null;
let nextKey = 1;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach(listener => listener());
const subscribe = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };

export function showFavoriteSnackbar(notice: FavoriteSnackbarNotice) {
  shown = { notice, key: nextKey++, busy: false };
  emit();
}

/** Without an owner: whatever is shown. With one: only that card's snackbar. */
export function dismissFavoriteSnackbar(owner?: symbol) {
  if (!shown || (owner && shown.notice.owner !== owner)) return;
  shown = null;
  emit();
}

export function FavoriteSnackbar() {
  const current = useSyncExternalStore(subscribe, () => shown, () => null);
  const navigate = useNavigate();
  const { pathname } = useLocation();
  // It speaks about a card on the page being left.
  useEffect(() => { dismissFavoriteSnackbar(); }, [pathname]);
  const notice = current?.notice;
  return <UndoToast onDismiss={() => dismissFavoriteSnackbar()} toast={current && notice ? {
    key: current.key,
    message: notice.favorite ? "Agregado a favoritos" : "Quitado de favoritos",
    detail: notice.title,
    action: notice.favorite
      ? { label: "Ver favoritos", onPress: () => navigate("/favorites") }
      : { label: "Deshacer", busyLabel: "Guardando…", busy: current.busy, onPress: () => {
        if (shown) { shown = { ...shown, busy: true }; emit(); }
        notice.undo();
      } },
  } : null} />;
}
