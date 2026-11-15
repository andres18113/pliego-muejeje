import { createContext, lazy, Suspense, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { useLocation } from "react-router-dom";

// The drawer (cart reads and mutations, pickers, removal dialog) is code for pages that can add to the cart:
// it is fetched when such a page mounts or on the first open, never on the public first load.
const loadCartPreviewDrawer = () => import("./CartPreviewDrawer");
const CartPreviewDrawer = lazy(async () => ({ default: (await loadCartPreviewDrawer()).CartPreviewDrawer }));

type CartPreview = { open: (editionId: string) => void; prepare: () => void };
const CartPreviewContext = createContext<CartPreview | null>(null);

/** Opens the cart preview after a confirmed add. Null outside the storefront layout: callers simply stay put. */
export function useCartPreview() {
  const preview = useContext(CartPreviewContext);
  // A page that can add to the cart fetches the drawer's code as it mounts, so the first add opens it at once.
  useEffect(() => { preview?.prepare(); }, [preview]);
  return preview;
}

/**
 * PLIEGO's one add-to-cart answer: the shopper stays on the shelf and the cart comes in from the right,
 * showing the server's cart (lines, quantities, totals) — never a client-side copy of it. A later add
 * reopens the same drawer on the newly added edition; leaving the page closes it.
 */
export function CartPreviewProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<{ opened: boolean; editionId: string | null }>({ opened: false, editionId: null });
  // The drawer mounts closed once its code is here (`loaded`) and opens only after that first closed commit
  // (`mounted`): Mantine records the element focus returns to on the closed → open transition.
  const [loaded, setLoaded] = useState(false);
  const [mounted, setMounted] = useState(false);
  const { pathname } = useLocation();
  const close = useCallback(() => setState((current) => ({ ...current, opened: false })), []);
  const markMounted = useCallback(() => setMounted(true), []);
  useEffect(close, [pathname, close]);
  const value = useMemo<CartPreview>(() => {
    const prepare = () => { void loadCartPreviewDrawer().then(() => setLoaded(true)); };
    return { prepare, open: (editionId) => { prepare(); setState({ opened: true, editionId }); } };
  }, []);

  return <CartPreviewContext.Provider value={value}>
    {children}
    {loaded && <Suspense fallback={null}>
      <CartPreviewDrawer opened={state.opened && mounted} addedEditionId={state.editionId} onClose={close} onMounted={markMounted} />
    </Suspense>}
  </CartPreviewContext.Provider>;
}
