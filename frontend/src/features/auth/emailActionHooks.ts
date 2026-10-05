import { useMutation } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { requestEmailAction, resetPassword, verifyEmail } from "@/shared/api/emailActions";

export function useEmailRequest(purpose: "verification" | "recovery") {
  return useMutation({ mutationFn: (email: string) => requestEmailAction(purpose, email), retry: false });
}

export function useEmailTokenAction(purpose: "verification" | "recovery") {
  const location = useLocation();
  const navigate = useNavigate();
  // A user confirms before the one-use command runs. Never consume on mounting or store credentials.
  const [token, setToken] = useState(() => {
    const candidate = new URLSearchParams(location.hash.slice(1)).get("token") ?? "";
    return /^[A-Za-z0-9_-]{43}$/.test(candidate) ? candidate : "";
  });
  const mutation = useMutation({
    mutationFn: (command: { token: string; password?: string }) => purpose === "verification" ? verifyEmail(command.token) : resetPassword(command.token, command.password ?? ""),
    retry: false,
    onSettled: (_data, _error, command) => setToken(current => current === command.token ? "" : current),
  });
  const resetMutation = mutation.reset;
  useEffect(() => {
    if (!location.hash) return;
    const candidate = new URLSearchParams(location.hash.slice(1)).get("token") ?? "";
    setToken(/^[A-Za-z0-9_-]{43}$/.test(candidate) ? candidate : "");
    resetMutation();
    navigate(location.pathname + location.search, { replace: true, state: location.state });
  }, [location.hash, location.pathname, location.search, location.state, navigate, resetMutation]);
  return { token, mutation };
}
