import { useCallback, useEffect, type Dispatch, type MutableRefObject, type SetStateAction } from "react";
import type { AuthSession, LegalPolicyBundle, ProviderConfig } from "@codex-ui/shared";
import {
  AUTH_TOKEN_STORAGE_KEY,
  LEGAL_ACCEPTANCE_STORAGE_PREFIX,
  SESSION_KEEPALIVE_INTERVAL_MS,
  SESSION_KEEPALIVE_MIN_INTERVAL_MS,
  type AuthStatus,
} from "./appConstants";
import {
  LoginRequiredError,
  acceptLegalPolicy,
  fetchSessionToken,
  login,
  loginWith2fa,
  registerAccount,
  startCodexEngine,
} from "../../state/codexClient";
import { parseConfigReadResponse, type CodexUserConfigView } from "../../state/codexConfigSettings";
import { formatErrorText, legalReviewRequired, withTimeout } from "./appUtils";
import type { appReducer } from "../../app/appReducer";
import type { ClientState, CodexSocketClient } from "../../state/codexClient";
import type { TranslateFn } from "../../i18n";

export function useSessionBootstrap(input: {
  state: ClientState;
  dispatch: Dispatch<Parameters<typeof appReducer>[1]>;
  client: CodexSocketClient;
  t: TranslateFn;
  authStatus: AuthStatus;
  authSession: AuthSession | null;
  setAuthStatus: Dispatch<SetStateAction<AuthStatus>>;
  setAuthSession: Dispatch<SetStateAction<AuthSession | null>>;
  setLoginError: Dispatch<SetStateAction<string | null>>;
  setLoginSubmitting: Dispatch<SetStateAction<boolean>>;
  refreshProviders: (token: string, options?: { force?: boolean }) => Promise<ProviderConfig[]>;
  handleSessionExpired: () => void;
  recoverOrExpireSession: () => Promise<boolean>;
  applyLoadedCodexConfig: (view: CodexUserConfigView, providers: ProviderConfig[]) => void;
  loadBasics: (options?: { forceHistoryRefresh?: boolean; preserveHistory?: boolean }) => Promise<void>;
  cliPrerequisitesBlocked: boolean;
  checkCodexCliUpdate: (token: string) => void;
  clientRef: MutableRefObject<CodexSocketClient | null>;
}) {
  const { state, dispatch, client, t, authStatus, authSession, setAuthStatus, setAuthSession, setLoginError, setLoginSubmitting, refreshProviders, applyLoadedCodexConfig, loadBasics, cliPrerequisitesBlocked, checkCodexCliUpdate, clientRef, handleSessionExpired, recoverOrExpireSession } = input;

  const verifySessionAfterDisconnect = useCallback(async () => {
    await recoverOrExpireSession();
  }, [recoverOrExpireSession]);

  useEffect(() => {
    if (cliPrerequisitesBlocked) return;
    let mounted = true;
    let storedToken: string | null = null;
    let sessionVerifiedForWorkbench = false;
    void (async () => {
      try {
        storedToken = window.localStorage.getItem(AUTH_TOKEN_STORAGE_KEY);
        const session = await withTimeout(fetchSessionToken(storedToken), 8_000, "Session check timeout");
        if (!mounted || window.localStorage.getItem(AUTH_TOKEN_STORAGE_KEY) !== storedToken) return;
        if (session.authenticated === false || session.loginRequired || !session.token) {
          window.localStorage.removeItem(AUTH_TOKEN_STORAGE_KEY);
          setAuthStatus("loginRequired");
          return;
        }
        window.localStorage.setItem(AUTH_TOKEN_STORAGE_KEY, session.token);
        setAuthSession(session);
        if (legalReviewRequired(session)) {
          setAuthStatus("legalRequired");
          return;
        }
        sessionVerifiedForWorkbench = true;
        setAuthStatus("authenticated");
        dispatch({ type: "token", token: session.token });
        try {
          await startCodexEngine(session.token);
          checkCodexCliUpdate(session.token);
        } catch (error) {
          console.warn("[engine] startup failed; workbench will show the engine status", error);
        }
        const websocketConnectTimeoutMs = (session.websocket?.handshakeTimeoutMs ?? 8_000) + 1_000;
        await withTimeout(
          client.connect(session.token, session.websocket),
          websocketConnectTimeoutMs,
          "WebSocket connect timeout"
        );
        let providers: ProviderConfig[] = [];
        try {
          providers = await withTimeout(refreshProviders(session.token), 8_000, "Provider refresh timeout");
          if (!mounted) return;
        } catch (error) {
          if (error instanceof LoginRequiredError) {
            throw error;
          }
          console.warn("[auth] provider fetch failed; preserving current relay list", error);
        }
        try {
          const configResult = await withTimeout(client.rpc("config/read", { includeLayers: false }), 8_000, "Config read timeout");
          if (!mounted || window.localStorage.getItem(AUTH_TOKEN_STORAGE_KEY) !== session.token) return;
          const view = parseConfigReadResponse(configResult);
          applyLoadedCodexConfig(view, providers);
        } catch {
          /* The workbench can still load with engine defaults if config/read is unavailable. */
        }
        await loadBasics();
      } catch (error) {
        if (!mounted) return;
        const currentToken = window.localStorage.getItem(AUTH_TOKEN_STORAGE_KEY);
        if (currentToken !== storedToken && currentToken !== null) {
          return;
        }
        if (error instanceof LoginRequiredError) {
          window.localStorage.removeItem(AUTH_TOKEN_STORAGE_KEY);
          setAuthStatus("loginRequired");
          return;
        }
        // Verify if session token is still valid on server
        if (currentToken) {
          const recheck = await withTimeout(fetchSessionToken(currentToken), 8_000, "Session recheck timeout").catch(() => null);
          if (recheck && recheck.authenticated === false) {
            window.localStorage.removeItem(AUTH_TOKEN_STORAGE_KEY);
            setAuthStatus("loginRequired");
            return;
          }
          if (recheck?.token) {
            setAuthSession(recheck);
            if (legalReviewRequired(recheck)) {
              client.disconnect();
              dispatch({ type: "connected", connected: false });
              dispatch({ type: "token", token: null });
              setAuthStatus("legalRequired");
              return;
            }
            dispatch({ type: "token", token: recheck.token });
            sessionVerifiedForWorkbench = true;
          }
        }
        dispatch({ type: "error", message: formatErrorText(error) });
        if (window.localStorage.getItem(AUTH_TOKEN_STORAGE_KEY) && sessionVerifiedForWorkbench) {
          setAuthStatus("authenticated");
        } else {
          setAuthStatus("loginRequired");
        }
      }
    })();
    return () => {
      mounted = false;
    };
  }, [applyLoadedCodexConfig, cliPrerequisitesBlocked, client, loadBasics, refreshProviders]);

  const completeLoginSession = useCallback(
    async (session: AuthSession) => {
      window.localStorage.setItem(AUTH_TOKEN_STORAGE_KEY, session.token);
      setAuthSession(session);
      if (legalReviewRequired(session)) {
        client.disconnect();
        dispatch({ type: "connected", connected: false });
        dispatch({ type: "token", token: null });
        setAuthStatus("legalRequired");
        return;
      }
      dispatch({ type: "token", token: session.token });
      // Mark authenticated immediately so UI enters the workbench even if
      // the WebSocket or subsequent RPCs are slow/failing.
      setAuthStatus("authenticated");
      let providers = state.providers;
      // Best-effort post-login setup: never block the workbench.
      void (async () => {
        try {
          await startCodexEngine(session.token);
          checkCodexCliUpdate(session.token);
        } catch (error) {
          console.warn("[engine] startup failed; workbench will show the engine status", error);
        }
        try {
          const websocketConnectTimeoutMs = (session.websocket?.handshakeTimeoutMs ?? 8_000) + 1_000;
          await withTimeout(
            client.connect(session.token, session.websocket),
            websocketConnectTimeoutMs,
            "WebSocket connect timeout"
          );
        } catch (error) {
          console.warn("[auth] WebSocket connect failed, workbench remains usable", error);
        }
        try {
          providers = await withTimeout(refreshProviders(session.token), 8000, "Provider refresh timeout");
        } catch (error) {
          console.warn("[auth] provider fetch failed; preserving current relay list", error);
        }
        try {
          const configResult = await withTimeout(client.rpc("config/read", { includeLayers: false }), 8000, "Config read timeout");
          const view = parseConfigReadResponse(configResult);
          applyLoadedCodexConfig(view, providers);
        } catch {
          /* optional */
        }
      })();
    },
    [applyLoadedCodexConfig, client, refreshProviders, state.providers]
  );

  const acceptCurrentLegalPolicy = useCallback(
    async (policy: LegalPolicyBundle) => {
      const session = authSession;
      if (!session?.token || !session.user) {
        handleSessionExpired();
        return;
      }
      const legalConsent = await acceptLegalPolicy(session.token, policy.version, policy.language);
      const nextSession: AuthSession = { ...session, legalConsent };
      window.localStorage.setItem(
        `${LEGAL_ACCEPTANCE_STORAGE_PREFIX}.${session.user.id}`,
        JSON.stringify({ version: legalConsent.version, acceptedAt: legalConsent.acceptedAt ?? Date.now(), language: policy.language })
      );
      await completeLoginSession(nextSession);
    },
    [authSession, completeLoginSession, handleSessionExpired]
  );

  const leaveLegalReview = useCallback(() => {
    handleSessionExpired();
  }, [handleSessionExpired]);

  const handleLogin = useCallback(
    async (email: string, password: string, captcha?: { captchaId?: string; captchaAnswer?: string }) => {
      setLoginSubmitting(true);
      setLoginError(null);
      try {
        const result = await login(email, password, captcha);
        if ("requires_2fa" in result && result.requires_2fa) {
          return { requires_2fa: true as const, pendingToken: result.pendingToken };
        }
        await completeLoginSession(result as AuthSession);
        return undefined;
      } catch (error) {
        setLoginError(formatErrorText(error));
        throw error;
      } finally {
        setLoginSubmitting(false);
      }
    },
    [completeLoginSession]
  );

  const handleLogin2fa = useCallback(
    async (pendingToken: string, totpCode: string) => {
      setLoginSubmitting(true);
      setLoginError(null);
      try {
        const session = await loginWith2fa(pendingToken, totpCode);
        await completeLoginSession(session);
      } catch (error) {
        setLoginError(formatErrorText(error));
        throw error;
      } finally {
        setLoginSubmitting(false);
      }
    },
    [completeLoginSession]
  );

  const handleRegister = useCallback(
    async (input: {
      email: string;
      password: string;
      username?: string;
      captchaId?: string;
      captchaAnswer?: string;
    }) => {
      setLoginSubmitting(true);
      setLoginError(null);
      try {
        await registerAccount(input);
        setLoginError(null);
      } catch (error) {
        setLoginError(formatErrorText(error));
        throw error;
      } finally {
        setLoginSubmitting(false);
      }
    },
    []
  );
  return {
    verifySessionAfterDisconnect,
    completeLoginSession,
    acceptCurrentLegalPolicy,
    leaveLegalReview,
    handleLogin,
    handleLogin2fa,
    handleRegister,
  };
}
