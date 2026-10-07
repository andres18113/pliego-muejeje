import { useLayoutEffect, useMemo, useRef } from "react";
import { useSession } from "./session";

export interface SessionOperationScope {
  isCurrent: () => boolean;
  isViewCurrent: () => boolean;
  isAuthorityCurrent: () => boolean;
  assertCurrent: () => void;
}

/** Capture the authority and view that issued a command, not the latest render's credentials. */
export function useSessionOperationScope(resource = ""): SessionOperationScope {
  const { session, captureAuthority } = useSession();
  const mounted = useRef(false);
  const view = useMemo(() => ({ resource }), [resource]);
  const currentView = useRef(view);
  useLayoutEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useLayoutEffect(() => { currentView.current = view; }, [view]);
  const authority = useMemo(() => captureAuthority(session), [captureAuthority, session]);
  return useMemo(() => {
    const isViewCurrent = () => mounted.current && currentView.current === view;
    const isCurrent = () => isViewCurrent() && authority.isCurrent();
    return { isCurrent, isViewCurrent, isAuthorityCurrent: authority.isCurrent, assertCurrent: () => {
      if (!isCurrent()) throw new DOMException("La sesión o la vista cambió.", "AbortError");
    } };
    // Ordinary access-token rotation retains authority and must not reset pending commands.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authority.version, session?.user.userId, session?.user.role, resource]);
}
