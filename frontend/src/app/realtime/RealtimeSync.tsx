import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useSession } from "@/app/session";
import { apiUrl } from "@/shared/api/client";
import { browserRealtimeEnvironment, startRealtime, type RealtimeEnvironment } from "./realtimeConnection";
import { applyRealtimeHint, type RealtimeRole } from "./realtimeInvalidation";

/**
 * ADR 0054: the stream authenticates with the existing HttpOnly session cookie, scoped to /api/v1/auth, so the URL
 * must carry the full /api/v1 path on the API origin. Built like every other API call (see `apiUrl`); production
 * configures the bare origin, and appending to the raw variable once produced `/auth/events` there.
 */
export const realtimeEventsUrl = apiUrl("/api/v1/auth/events");

/**
 * Keeps a signed-in customer's or administrator's views current without a manual refresh. It renders nothing:
 * hints from the stream only refetch the server's own resources, so every state, deadline and permission stays the API's.
 */
export function RealtimeSync({ environment }: { environment?: () => RealtimeEnvironment }) {
  const { session } = useSession();
  const queryClient = useQueryClient();
  const userId = session?.user.userId ?? null;
  const role = session?.user.role;
  const realtimeRole: RealtimeRole | null = role === "CUSTOMER" || role === "ADMIN" ? role : null;
  useEffect(() => {
    if (!userId || !realtimeRole) return;
    return startRealtime({
      userId, url: realtimeEventsUrl, env: (environment ?? browserRealtimeEnvironment)(),
      onHint: hint => { void applyRealtimeHint(queryClient, realtimeRole, hint); },
    });
  }, [environment, queryClient, realtimeRole, userId]);
  return null;
}
