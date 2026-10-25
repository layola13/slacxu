import { useCallback, useEffect, type Dispatch, type MutableRefObject, type SetStateAction } from "react";
import type { AuthSession } from "@codex-ui/shared";
import {
  AUTH_TOKEN_STORAGE_KEY,
  SESSION_KEEPALIVE_INTERVAL_MS,
  SESSION_KEEPALIVE_MIN_INTERVAL_MS,
  type AuthStatus,
} from "./appConstants";
import { LoginRequiredError, fetchSessionToken } from "../../state/codexClient";
import { legalReviewRequired } from "./appUtils";
import type { appReducer } from "../../app/appReducer";
import type { ClientState, CodexSocketClient } from "../../state/codexClient";
import type { TranslateFn } from "../../i18n";

export function useSessionRecovery(input: {
  state: ClientState;
  dispatch: Dispatch<Parameters<typeof appReducer>[1]>;
  t: TranslateFn;
  authStatus: AuthStatus;
  setAuthStatus: Dispatch<SetStateAction<AuthStatus>>;
  setAuthSession: Dispatch<SetStateAction<AuthSession | null>>;
  clientRef: MutableRefObject<CodexSocketClient | null>;
}) {
  const { state, dispatch, t, authStatus, setAuthStatus, setAuthSession, clientRef } = input;
  const handleSessionExpired = useCallback(() => {
    window.localStorage.removeItem(AUTH_TOKEN_STORAGE_KEY);
    clientRef.current?.disconnect();
    dispatch({ type: "connected", connected: false });
    dispatch({ type: "token", token: null });
    setAuthSession(null);
    setAuthStatus("loginRequired");
  }, []);

  const recoverOrExpireSession = useCallback(async (): Promise<boolean> => {
    const token = window.localStorage.getItem(AUTH_TOKEN_STORAGE_KEY);
    if (!token) {
      handleSessionExpired();
      return false;
    }
    let session: AuthSession;
    try {
      session = await fetchSessionToken(token);
    } catch (error) {
      if (error instanceof LoginRequiredError) {
        handleSessionExpired();
        return false;
      }
      // Network or proxy failure proves nothing about the session; keep it.
      return true;
    }
    if (session.authenticated === false || session.loginRequired || !session.token) {
      handleSessionExpired();
      return false;
    }
    setAuthSession(session);
    if (session.token !== token) {
      window.localStorage.setItem(AUTH_TOKEN_STORAGE_KEY, session.token);
      dispatch({ type: "token", token: session.token });
      clientRef.current?.updateToken(session.token);
    }
    if (legalReviewRequired(session)) {
      clientRef.current?.disconnect();
      dispatch({ type: "connected", connected: false });
      dispatch({ type: "token", token: null });
      setAuthStatus("legalRequired");
      return false;
    }
    return true;
  }, [handleSessionExpired]);

  useEffect(() => {
    if (authStatus !== "authenticated") return;
    let lastCheckedAt = Date.now();
    const refresh = () => {
      if (document.visibilityState === "hidden") return;
      // Alt-tabbing must not turn into a burst of session calls.
      if (Date.now() - lastCheckedAt < SESSION_KEEPALIVE_MIN_INTERVAL_MS) return;
      lastCheckedAt = Date.now();
      void recoverOrExpireSession();
    };
    const timer = window.setInterval(refresh, SESSION_KEEPALIVE_INTERVAL_MS);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, [authStatus, recoverOrExpireSession]);
  return { handleSessionExpired, recoverOrExpireSession };
}
