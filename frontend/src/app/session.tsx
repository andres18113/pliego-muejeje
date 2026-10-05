import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { logoutSession, refreshSession, type LoginResponse } from "@/shared/api/auth";
import { setApiAccessToken } from "@/shared/api/client";

export type AuthenticatedUser = Required<NonNullable<LoginResponse["user"]>>;

export interface AuthSession {
  accessToken: string;
  expiresAt: number;
  user: AuthenticatedUser;
}

type RestoreState = "restoring" | "ready" | "unavailable";

interface SessionContextValue {
  session: AuthSession | null;
  /** True after the backend confirms that a previously active session is no longer valid. */
  expired: boolean;
  restoreState: RestoreState;
  establish: (session: AuthSession) => void;
  updateEmailForSession: (expected: AuthSession, email: string) => boolean;
  clear: (reason?: "expired") => void;
  logout: () => Promise<void>;
  retryRestore: () => Promise<void>;
}

const SessionContext = createContext<SessionContextValue | null>(null);
const SESSION_CHANNEL = "pliego-auth-session";

function notifyOtherTabs(reason: "logout" | "expired") {
  if (typeof BroadcastChannel === "undefined") return;
  const channel = new BroadcastChannel(SESSION_CHANNEL);
  channel.postMessage(reason);
  channel.close();
}

export function SessionProvider({ children, restoreOnMount = true }: {
  children: ReactNode;
  restoreOnMount?: boolean;
}) {
  const queryClient = useQueryClient();
  const [session, setSession] = useState<AuthSession | null>(null);
  const currentSession = useRef<AuthSession | null>(null);
  const wasAuthenticated = useRef(false);
  const [expired, setExpired] = useState(false);
  const [restoreState, setRestoreState] = useState<RestoreState>(restoreOnMount ? "restoring" : "ready");

  const forgetSession = useCallback((reason?: "expired") => {
    currentSession.current = null;
    setApiAccessToken(null);
    queryClient.removeQueries({ predicate: (query) => query.meta?.authRequired === true });
    setExpired(reason === "expired");
    wasAuthenticated.current = false;
    setSession(null);
    setRestoreState("ready");
  }, [queryClient]);

  const establish = useCallback((next: AuthSession) => {
    currentSession.current = next;
    setApiAccessToken(next.accessToken);
    wasAuthenticated.current = true;
    setExpired(false);
    setSession(next);
    setRestoreState("ready");
  }, []);

  const updateEmailForSession = useCallback((expected: AuthSession, email: string) => {
    // Compare the exact accepted session generation, including token and identity, atomically.
    // An async account command must never restore a logged-out or replaced session.
    if (currentSession.current !== expected) return false;
    const next = { ...expected, user: { ...expected.user, email } };
    currentSession.current = next;
    setSession(next);
    return true;
  }, []);

  const acceptRestoredSession = useCallback((response: Required<LoginResponse> | null) => {
    if (!response) {
      const hadActiveSession = wasAuthenticated.current;
      forgetSession(hadActiveSession ? "expired" : undefined);
      if (hadActiveSession) notifyOtherTabs("expired");
      return false;
    }
    establish({
      accessToken: response.accessToken,
      expiresAt: Date.now() + response.expiresInSeconds * 1000,
      user: response.user as AuthenticatedUser,
    });
    return true;
  }, [establish, forgetSession]);

  const retryRestore = useCallback(async () => {
    setRestoreState("restoring");
    try {
      acceptRestoredSession(await refreshSession());
    } catch {
      setRestoreState("unavailable");
    }
  }, [acceptRestoredSession]);

  useEffect(() => {
    if (restoreOnMount) void retryRestore();
  }, [restoreOnMount, retryRestore]);

  useEffect(() => {
    if (typeof BroadcastChannel === "undefined") return;
    const channel = new BroadcastChannel(SESSION_CHANNEL);
    channel.onmessage = (event: MessageEvent<unknown>) => {
      if (event.data === "logout" || event.data === "expired") {
        forgetSession(event.data === "expired" ? "expired" : undefined);
      }
    };
    return () => channel.close();
  }, [forgetSession]);

  const clear = useCallback((reason?: "expired") => {
    if (reason !== "expired") {
      forgetSession();
      return;
    }
    setRestoreState("restoring");
    void refreshSession()
      .then((response) => { acceptRestoredSession(response); })
      .catch(() => { setRestoreState("unavailable"); });
  }, [acceptRestoredSession, forgetSession]);

  const logout = useCallback(async () => {
    await logoutSession();
    forgetSession();
    notifyOtherTabs("logout");
  }, [forgetSession]);

  useEffect(() => {
    if (!session) return;
    let timer = 0;
    let refreshing = false;
    const schedule = (delay: number) => {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => { void refresh(); }, Math.max(0, delay));
    };
    const refresh = async () => {
      if (refreshing) return;
      refreshing = true;
      try {
        const response = await refreshSession();
        acceptRestoredSession(response);
      } catch {
        // A temporary network failure does not revoke the server session; retry while this tab is open.
        schedule(30_000);
      } finally {
        refreshing = false;
      }
    };
    const refreshWhenVisible = () => {
      if (document.visibilityState === "visible" && Date.now() >= session.expiresAt - 60_000) {
        void refresh();
      }
    };
    schedule(session.expiresAt - Date.now() - 60_000);
    document.addEventListener("visibilitychange", refreshWhenVisible);
    window.addEventListener("online", refreshWhenVisible);
    return () => {
      window.clearTimeout(timer);
      document.removeEventListener("visibilitychange", refreshWhenVisible);
      window.removeEventListener("online", refreshWhenVisible);
    };
  }, [acceptRestoredSession, session]);

  const value = useMemo(() => ({
    session,
    expired,
    restoreState,
    establish,
    updateEmailForSession,
    clear,
    logout,
    retryRestore,
  }), [clear, establish, expired, logout, restoreState, retryRestore, session, updateEmailForSession]);

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession() {
  const value = useContext(SessionContext);
  if (!value) throw new Error("useSession debe usarse dentro de SessionProvider.");
  return value;
}
