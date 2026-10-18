import { useMutation } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { requestEmailAction, resetPassword, verifyEmail } from "@/shared/api/emailActions";

export function useEmailRequest(purpose: "verification" | "recovery", from = "/") {
  return useMutation({ mutationFn: (email: string) => requestEmailAction(purpose, email, from === "/" ? undefined : from), retry: false });
}

export function useEmailTokenAction(purpose: "verification" | "recovery") {
  const location = useLocation();
  const navigate = useNavigate();
  // Capture credentials in memory and remove the fragment from history. Recovery
  // still requires a password submission; verification starts when its page opens.
  const [token, setToken] = useState(() => {
    const candidate = new URLSearchParams(location.hash.slice(1)).get("token") ?? "";
    return /^[A-Za-z0-9_-]{43}$/.test(candidate) ? candidate : "";
  });
  // Verification has no editable payload: reuse its original pending/result for
  // every visit to that link on this view, including an uncertain failure. This
  // stays in component memory, never in the query cache or browser storage.
  const verificationRuns = useRef(new Map<string, Promise<void>>());
  const mutation = useMutation({
    mutationFn: (command: { token: string; password?: string }) => {
      if (purpose === "recovery") return resetPassword(command.token, command.password ?? "");
      let result = verificationRuns.current.get(command.token);
      if (!result) {
        result = verifyEmail(command.token);
        verificationRuns.current.set(command.token, result);
      }
      return result;
    },
    retry: false,
    onSettled: (_data, _error, command) => setToken(current => current === command.token ? "" : current),
  });
  const lastFragment = useRef(token);
  const resetMutation = mutation.reset;
  useEffect(() => {
    if (!location.hash) return;
    const candidate = new URLSearchParams(location.hash.slice(1)).get("token") ?? "";
    const next = /^[A-Za-z0-9_-]{43}$/.test(candidate) ? candidate : "";
    // Reopening the same fragment on this view preserves its in-flight/result
    // state instead of replaying a one-use command or leaving an idle screen.
    if (next !== lastFragment.current) {
      lastFragment.current = next;
      setToken(next);
      resetMutation();
    }
    navigate(location.pathname + location.search, { replace: true, state: location.state });
  }, [location.hash, location.pathname, location.search, location.state, navigate, resetMutation]);
  return { token, mutation };
}
