import type { AuthSession } from "@/app/session";
import { refreshSession } from "@/shared/api/auth";
import type { RegistrationSession } from "@/shared/api/registrationSession";
import { safeAuthReturnHref } from "./authLocation";

/** The session a verified registration continuation created, in the shape every sign-in installs. */
export function sessionFromRegistration(session: RegistrationSession): AuthSession {
  return { accessToken: session.accessToken, expiresAt: Date.now() + session.expiresInSeconds * 1000, user: session.user };
}

/** Where the new customer was going: the server's sanitized returnTo, validated again here, else this page's own intent. */
export function registrationDestination(session: RegistrationSession, intent: string) {
  return safeAuthReturnHref(session.returnTo ?? intent);
}

/**
 * Reads the browser's shared session cookie (another tab's exchange, or a verification whose answer was lost) and
 * installs it only if one exists. Unlike a full restore, finding none changes nothing on this page.
 */
export async function adoptSharedSession(establish: (session: AuthSession) => void): Promise<boolean> {
  const restored = await refreshSession().catch(() => null);
  if (!restored) return false;
  establish({ accessToken: restored.accessToken, expiresAt: Date.now() + restored.expiresInSeconds * 1000, user: restored.user as AuthSession["user"] });
  return true;
}
