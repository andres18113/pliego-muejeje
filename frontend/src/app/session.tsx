import { createContext, useContext, useMemo, useState, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { setApiAccessToken } from "@/shared/api/client";
import type { LoginResponse } from "@/shared/api/auth";

export type AuthenticatedUser = Required<NonNullable<LoginResponse["user"]>>;

export interface AuthSession {
  accessToken: string;
  expiresAt: number;
  user: AuthenticatedUser;
}

interface SessionContextValue {
  session: AuthSession | null;
  establish: (session: AuthSession) => void;
  clear: () => void;
}

const SessionContext = createContext<SessionContextValue | null>(null);

export function SessionProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const [session, setSession] = useState<AuthSession | null>(null);
  const value = useMemo(() => ({
    session,
    establish: (nextSession: AuthSession) => {
      setApiAccessToken(nextSession.accessToken);
      setSession(nextSession);
    },
    clear: () => {
      setApiAccessToken(null);
      queryClient.removeQueries({ predicate: (query) => query.meta?.authRequired === true });
      setSession(null);
    },
  }), [queryClient, session]);

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession() {
  const value = useContext(SessionContext);
  if (!value) throw new Error("useSession debe usarse dentro de SessionProvider.");
  return value;
}
