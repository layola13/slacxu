import { useRef, useState } from "react";
import type { AuthStatus } from "./appConstants";
import type { AuthSession } from "@codex-ui/shared";
import type { ClientState } from "../../state/codexClient";

export function useSessionState() {
  const [authStatus, setAuthStatus] = useState<AuthStatus>("checking");
  const [authSession, setAuthSession] = useState<AuthSession | null>(null);
  const [loginError, setLoginError] = useState<string | null>(null);
  const [loginSubmitting, setLoginSubmitting] = useState(false);
  const authSessionRef = useRef(authSession);
  return {
    authStatus,
    setAuthStatus,
    authSession,
    setAuthSession,
    loginError,
    setLoginError,
    loginSubmitting,
    setLoginSubmitting,
    authSessionRef,
  };
}
