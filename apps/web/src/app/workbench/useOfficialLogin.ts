import { useCallback, useRef, useState, type Dispatch } from "react";
import type { ProviderConfig, ServerToClientMessage } from "@codex-ui/shared";
import { asRecord, stringValue } from "./appUtils";
import type { appReducer } from "../../app/appReducer";
import type { ClientState, CodexSocketClient } from "../../state/codexClient";
import type { TranslateFn } from "../../i18n";

export function useOfficialLogin(input: {
  state: ClientState;
  dispatch: Dispatch<Parameters<typeof appReducer>[1]>;
  client: CodexSocketClient;
  t: TranslateFn;
  activateProvider: (providerId: string, model?: string, groupId?: string) => Promise<void>;
}) {
  const { state, dispatch, client, t, activateProvider } = input;
  const [officialLoginOpen, setOfficialLoginOpen] = useState(false);
  const [officialLoginNotice, setOfficialLoginNotice] = useState<string | null>(null);
  const officialOAuthSessionsRef = useRef(new Map<string, (reason?: Error) => void>());

  const startOfficialOpenAiOAuth = useCallback(async () => {
    let loginId = "";
    let settled = false;
    let timer = 0;
    let resolveCompletion: (() => void) | undefined;
    let rejectCompletion: ((error: Error) => void) | undefined;
    const completion = new Promise<void>((resolve: (value: void | PromiseLike<void>) => void, reject: (reason?: unknown) => void) => {
      resolveCompletion = resolve;
      rejectCompletion = reject;
    });
    function finish() {
      if (settled) return;
      settled = true;
      window.clearTimeout(timer);
      client.removeEventListener("server-message", onMessage);
      if (loginId) officialOAuthSessionsRef.current.delete(loginId);
    }
    async function finalizeLogin() {
      try {
        const [account, modelResult] = await Promise.all([
          client.rpc("account/read", { refreshToken: true }),
          client.rpc("model/list", {})
        ]);
        const modelsValue = asRecord(modelResult).data ?? asRecord(modelResult).models;
        const models = Array.isArray(modelsValue) ? modelsValue : [];
        const modelIds = [...new Set(models.map((entry: unknown) => {
          const model = asRecord(entry);
          return stringValue(model.model) ?? stringValue(model.id) ?? "";
        }).filter(Boolean))];
        if (modelIds.length === 0) {
          throw new Error("OpenAI OAuth succeeded, but no official models were returned");
        }
        const existing = state.providers.find((provider: ProviderConfig) => provider.id === "official-openai" || provider.kind === "chatgpt");
        const now = Date.now();
        const saved = await client.saveProvider({
          ...(existing ?? {}),
          id: existing?.id ?? "official-openai",
          kind: "chatgpt",
          name: "OpenAI 官方",
          serviceProvider: { id: "openai-official", name: "OpenAI" },
          apiKeyStorage: "none",
          defaultModel: modelIds[0],
          nativeModels: modelIds,
          modelAliases: existing?.modelAliases ?? [],
          stationType: "official",
          channelMode: "fast",
          groups: [{
            id: "default",
            name: "default",
            kind: "text",
            status: "enabled",
            groupRatio: 1,
            models: modelIds,
            responseProtocol: "openai-response",
            responseProtocolMode: "fixed",
            authType: "none",
            credentialMode: "provider",
            keyMode: "single",
            keys: []
          }],
          createdAt: existing?.createdAt ?? now,
          updatedAt: now
        });
        dispatch({ type: "account", account });
        dispatch({ type: "models", models: models as ClientState["models"] });
        dispatch({
          type: "providers",
          providers: [saved, ...state.providers.filter((provider: ProviderConfig) => provider.id !== saved.id && provider.kind !== "chatgpt")]
        });
        await activateProvider(saved.id, modelIds[0], "default");
        finish();
        resolveCompletion?.();
      } catch (error) {
        finish();
        rejectCompletion?.(error instanceof Error ? error : new Error(String(error)));
      }
    }
    function onMessage(event: Event) {
      const detail = (event as CustomEvent<ServerToClientMessage>).detail;
      if (detail.type !== "codex.notification" || detail.message.method !== "account/login/completed") return;
      const params = asRecord(detail.message.params);
      if (!loginId || stringValue(params.loginId) !== loginId) return;
      if (params.success === true) void finalizeLogin();
      else {
        finish();
        rejectCompletion?.(new Error(stringValue(params.error) ?? "OpenAI OAuth login failed"));
      }
    }
    client.addEventListener("server-message", onMessage);
    timer = window.setTimeout(() => {
      finish();
      rejectCompletion?.(new Error("OpenAI OAuth login timed out"));
    }, 10 * 60_000);
    try {
      await client.rpc("account/logout", {}).catch(() => undefined);
      const result = asRecord(await client.rpc("account/login/start", {
        type: "chatgpt",
        codexStreamlinedLogin: true,
        useHostedLoginSuccessPage: true,
        appBrand: "codex"
      }));
      loginId = stringValue(result.loginId) ?? "";
      const authUrl = stringValue(result.authUrl) ?? "";
      if (!loginId || !authUrl || result.type !== "chatgpt") throw new Error("OpenAI OAuth did not return a login URL");
      officialOAuthSessionsRef.current.set(loginId, (reason?: Error) => {
        finish();
        rejectCompletion?.(reason ?? new Error("OpenAI OAuth login was cancelled"));
      });
      return { loginId, authUrl, completion };
    } catch (error) {
      finish();
      throw error;
    }
  }, [activateProvider, client, state.providers]);

  const cancelOfficialOpenAiOAuth = useCallback(async (loginId: string) => {
    officialOAuthSessionsRef.current.get(loginId)?.(new Error("OpenAI OAuth login was cancelled"));
    await client.rpc("account/login/cancel", { loginId });
  }, [client]);
  return {
    officialLoginOpen,
    setOfficialLoginOpen,
    officialLoginNotice,
    setOfficialLoginNotice,
    officialOAuthSessionsRef,
    startOfficialOpenAiOAuth,
    cancelOfficialOpenAiOAuth,
  };
}
