import { useCallback, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Navigate, useLocation, useNavigate, useNavigationType } from "react-router-dom";
import { useSession } from "@/app/session";
import { BackNavigationContext } from "./BackNavigationContext";
import { HeaderFlowContext } from "./HeaderFlowContext";
import { BackNavigationHistory, backFallback, canonicalBackPath } from "./BackNavigationHistory";

export function BackNavigationProvider({ children }: { children: ReactNode }) {
  const { session, authorityVersion, captureAuthority } = useSession();
  const location = useLocation();
  const action = useNavigationType();
  const navigate = useNavigate();
  const [history] = useState(() => new BackNavigationHistory());
  const authority = `${session ? `${session.user.role}:${session.user.userId}` : "guest"}:${authorityVersion}`;
  const [snapshot, setSnapshot] = useState<{ key: string; authority: string; previous: { href: string; delta: number } | null; retired: boolean } | null>(null);
  const moving = useRef(false);
  const [flowClaims, setFlowClaims] = useState(0);
  const claim = useCallback(() => { setFlowClaims(count => count + 1); return () => setFlowClaims(count => count - 1); }, []);
  const headerFlow = useMemo(() => ({ scrollsAway: flowClaims > 0, claim }), [flowClaims, claim]);
  const view = useMemo(() => ({ key: location.key, authority }), [location.key, authority]);
  const liveView = useRef(view);
  useLayoutEffect(() => {
    liveView.current = view;
    moving.current = false;
    history.observe({ key: location.key, href: `${location.pathname}${location.search}${location.hash}`, purchased: location.state?.purchased === true }, action, authority);
    setSnapshot({ key: location.key, authority, previous: history.previous(authority), retired: history.isRetired(location.key) });
  }, [history, location.key, location.pathname, location.search, location.hash, location.state, action, authority, view]);
  const current = snapshot?.key === location.key && snapshot.authority === authority ? snapshot : null;
  const fallback = backFallback(location.pathname, session?.user.role ?? null);
  const pathname = canonicalBackPath(location.pathname);
  const captured = captureAuthority(session);
  const goBack = () => {
    if (moving.current || !captured.isCurrent() || liveView.current !== view) return;
    if (!current?.previous && pathname === fallback) return;
    moving.current = true;
    if (current?.previous) void navigate(current.previous.delta);
    else void navigate(fallback, { replace: true });
  };
  // A native POP to retired checkout must not mount its command-capable page.
  const retired = history.isRetired(location.key) || current?.retired;
  return <BackNavigationContext.Provider value={{ canGoBack: !!current?.previous || pathname !== fallback, fallback, goBack }}>
    <HeaderFlowContext.Provider value={headerFlow}>
      {retired ? <Navigate to={pathname === "/checkout" ? "/cart" : "/"} replace /> : children}
    </HeaderFlowContext.Provider>
  </BackNavigationContext.Provider>;
}
