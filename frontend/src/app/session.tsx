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
export interface SessionAuthority { version: number; isCurrent: () => boolean }

interface SessionContextValue {
  session: AuthSession | null;
  /** True after the backend confirms that a previously active session is no longer valid. */
  expired: boolean;
  restoreState: RestoreState;
  authorityVersion: number;
  captureAuthority: (expected: AuthSession | null) => SessionAuthority;
  establish: (session: AuthSession) => void;
  updateEmailForSession: (expected: AuthSession, email: string) => boolean;
  clear: (reason?: "expired") => void;
  logout: () => Promise<void>;
  retryRestore: () => Promise<void>;
}

const SessionContext = createContext<SessionContextValue | null>(null);
const SESSION_CHANNEL = "pliego-auth-session";

export function SessionProvider({ children, restoreOnMount = true }: {
  children: ReactNode;
  restoreOnMount?: boolean;
}) {
  const queryClient = useQueryClient();
  const [session, setSession] = useState<AuthSession | null>(null);
  const currentSession = useRef<AuthSession | null>(null);
  const generation = useRef(0);
  const authorityGeneration = useRef(0);
  const sessionChannel = useRef<BroadcastChannel | null>(null);
  const notifyOtherTabs = useCallback((reason: "logout" | "expired" | "changed") => {
    // Use the listening instance so BroadcastChannel never echoes a login back to this tab.
    sessionChannel.current?.postMessage(reason);
  }, []);
  const wasAuthenticated = useRef(false);
  const [expired, setExpired] = useState(false);
  const [restoreState, setRestoreState] = useState<RestoreState>(restoreOnMount ? "restoring" : "ready");

  const captureAuthority = useCallback((expected: AuthSession | null): SessionAuthority => {
    const version = authorityGeneration.current;
    const userId = expected?.user.userId, role = expected?.user.role;
    return { version, isCurrent: () => version === authorityGeneration.current && (expected === null
      ? currentSession.current === null
      : currentSession.current?.user.userId === userId && currentSession.current?.user.role === role) };
  }, []);

  const forgetPrivateData = useCallback(() => {
    queryClient.removeQueries({ predicate: query => query.meta?.authRequired === true });
    const mutations = queryClient.getMutationCache();
    for (const mutation of mutations.getAll()) if (mutation.meta?.authRequired === true) mutations.remove(mutation);
  }, [queryClient]);

  useEffect(() => () => {
    // A disposed provider cannot replace a newer provider's token or revive its timers.
    generation.current += 1;
    authorityGeneration.current += 1;
  }, []);

  const forgetSession = useCallback((reason?: "expired") => {
    generation.current += 1;
    authorityGeneration.current += 1;
    currentSession.current = null;
    setApiAccessToken(null);
    forgetPrivateData();
    setExpired(reason === "expired");
    wasAuthenticated.current = false;
    setSession(null);
    setRestoreState("ready");
  }, [forgetPrivateData]);

  const establish = useCallback((next: AuthSession) => {
    generation.current += 1;
    if (currentSession.current?.user.userId !== next.user.userId || currentSession.current?.user.role !== next.user.role) {
      authorityGeneration.current += 1;
      forgetPrivateData();
    }
    currentSession.current = next;
    setApiAccessToken(next.accessToken);
    wasAuthenticated.current = true;
    setExpired(false);
    setSession(next);
    setRestoreState("ready");
  }, [forgetPrivateData]);

  const establishFromCredentials = useCallback((next: AuthSession) => {
    authorityGeneration.current += 1;
    establish(next);
    // Broadcast no private data or token; other tabs restore the authoritative cookie.
    notifyOtherTabs("changed");
  }, [establish, notifyOtherTabs]);

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
  }, [establish, forgetSession, notifyOtherTabs]);

  const retryRestore = useCallback(async () => {
    const expectedGeneration = generation.current;
    setRestoreState("restoring");
    try {
      const response = await refreshSession();
      if (generation.current === expectedGeneration) acceptRestoredSession(response);
    } catch {
      if (generation.current === expectedGeneration) setRestoreState("unavailable");
    }
  }, [acceptRestoredSession]);

  useEffect(() => {
    if (restoreOnMount) void retryRestore();
  }, [restoreOnMount, retryRestore]);

  useEffect(() => {
    if (typeof BroadcastChannel === "undefined") return;
    const channel = new BroadcastChannel(SESSION_CHANNEL);
    sessionChannel.current = channel;
    channel.onmessage = (event: MessageEvent<unknown>) => {
      if (event.data === "logout" || event.data === "expired") {
        forgetSession(event.data === "expired" ? "expired" : undefined);
      } else if (event.data === "changed") {
        forgetSession();
        void retryRestore();
      }
    };
    return () => { sessionChannel.current = null; channel.close(); };
  }, [forgetSession, retryRestore]);

  const clear = useCallback((reason?: "expired") => {
    if (reason !== "expired") {
      forgetSession();
      return;
    }
    setRestoreState("restoring");
    const expectedGeneration = generation.current;
    void refreshSession()
      .then((response) => { if (generation.current === expectedGeneration) acceptRestoredSession(response); })
      .catch(() => { if (generation.current === expectedGeneration) setRestoreState("unavailable"); });
  }, [acceptRestoredSession, forgetSession]);

  const logout = useCallback(async () => {
    // Token rotation of this identity does not supersede an intentional logout.
    // A new credential login or identity boundary does supersede it.
    const expectedGeneration = authorityGeneration.current;
    await logoutSession();
    if (authorityGeneration.current !== expectedGeneration) return;
    forgetSession();
    notifyOtherTabs("logout");
  }, [forgetSession, notifyOtherTabs]);

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
      const expectedGeneration = generation.current;
      try {
        const response = await refreshSession();
        if (generation.current === expectedGeneration) acceptRestoredSession(response);
      } catch {
        // A temporary network failure does not revoke the server session; retry while this tab is open.
        if (generation.current === expectedGeneration) schedule(30_000);
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
    authorityVersion: authorityGeneration.current,
    captureAuthority,
    establish: establishFromCredentials,
    updateEmailForSession,
    clear,
    logout,
    retryRestore,
  }), [captureAuthority, clear, establishFromCredentials, expired, logout, restoreState, retryRestore, session, updateEmailForSession]);

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession() {
  const value = useContext(SessionContext);
  if (!value) throw new Error("useSession debe usarse dentro de SessionProvider.");
  return value;
}
