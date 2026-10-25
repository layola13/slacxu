import { useCallback, useState, type Dispatch, type MutableRefObject } from "react";
import type { AuthSession, JsonValue, ProviderConfig } from "@codex-ui/shared";
import {
  applyConfigWriteToView,
  buildConfigValueWrite,
  buildDynamicConfigValueWrite,
  parseConfigReadResponse,
  type CodexConfigFieldKey,
  type CodexUserConfigView,
} from "../../state/codexConfigSettings";
import { resolveConfiguredProviderId } from "./modelSelectionUtils";
import { errorMessage } from "./appUtils";
import type { ThreadRuntimeSelectionsDomain } from "../runtime/useThreadRuntimeSelections";
import type { appReducer } from "../../app/appReducer";
import type { ClientState, CodexSocketClient } from "../../state/codexClient";
import type { TranslateFn } from "../../i18n";

export function useCodexConfig(input: {
  state: ClientState;
  dispatch: Dispatch<Parameters<typeof appReducer>[1]>;
  client: CodexSocketClient;
  t: TranslateFn;
  authSession: AuthSession | null;
  activeThreadIdRef: MutableRefObject<string | null>;
} & Pick<ThreadRuntimeSelectionsDomain, "selectionForThread" | "updateNewConversationRuntimeSelection">) {
  const { state, dispatch, client, t, authSession, activeThreadIdRef, selectionForThread, updateNewConversationRuntimeSelection } = input;
  const [codexConfig, setCodexConfig] = useState<CodexUserConfigView | null>(null);
  const [codexConfigLoading, setCodexConfigLoading] = useState(false);
  const [codexConfigSaving, setCodexConfigSaving] = useState(false);
  const [codexConfigError, setCodexConfigError] = useState<string | null>(null);

  const applyLoadedCodexConfig = useCallback((view: CodexUserConfigView, providers: ProviderConfig[]) => {
    setCodexConfig(view);
    if (activeThreadIdRef.current) return;
    const newConversationSelection = selectionForThread(null);
    const configuredProviderId = resolveConfiguredProviderId(providers, view.modelProvider);
    if (configuredProviderId && !newConversationSelection.providerId) {
      updateNewConversationRuntimeSelection({ providerId: configuredProviderId });
    }
    if (view.model && !newConversationSelection.model) {
      updateNewConversationRuntimeSelection({ model: view.model });
    }
  }, [selectionForThread, updateNewConversationRuntimeSelection]);

  const loadCodexConfig = useCallback(async () => {
    setCodexConfigLoading(true);
    setCodexConfigError(null);
    try {
      const result = await client.rpc("config/read", { includeLayers: false });
      const view = parseConfigReadResponse(result);
      applyLoadedCodexConfig(view, state.providers);
    } catch (error) {
      setCodexConfigError(errorMessage("Codex config read", error));
    } finally {
      setCodexConfigLoading(false);
    }
  }, [applyLoadedCodexConfig, client, state.providers]);

  const writeCodexConfigField = useCallback(
    async (field: CodexConfigFieldKey, value: string) => {
      if (authSession?.user && authSession.user.role !== "admin") {
        setCodexConfigError("Member accounts cannot edit Codex configuration");
        return;
      }
      const write = buildConfigValueWrite(field, value);
      if (!write) {
        return;
      }
      // Skip no-op when value already matches loaded config.
      if (codexConfig && codexConfig[field] === value) {
        return;
      }
      setCodexConfigSaving(true);
      setCodexConfigError(null);
      setCodexConfig((current: CodexUserConfigView | null) => (current ? applyConfigWriteToView(current, write.keyPath, write.value) : current));
      try {
        // batchWrite supports reloadUserConfig so loaded threads pick up user config.toml edits.
        await client.rpc("config/batchWrite", {
          edits: [write],
          reloadUserConfig: true
        });
        const reloaded = await client.rpc("config/read", { includeLayers: false });
        const view = parseConfigReadResponse(reloaded);
        setCodexConfig(view);
      } catch (error) {
        setCodexConfigError(errorMessage("Codex config write", error));
        try {
          const reloaded = await client.rpc("config/read", { includeLayers: false });
          setCodexConfig(parseConfigReadResponse(reloaded));
        } catch {
          /* keep optimistic state if re-read also fails */
        }
      } finally {
        setCodexConfigSaving(false);
      }
    },
    [authSession?.user, client, codexConfig]
  );

  const writeCodexConfigValue = useCallback(
    async (keyPath: string, value: JsonValue) => {
      if (authSession?.user && authSession.user.role !== "admin") {
        setCodexConfigError("Member accounts cannot edit Codex configuration");
        return;
      }
      const write = buildDynamicConfigValueWrite(keyPath, value);
      if (!write) {
        return;
      }
      setCodexConfigSaving(true);
      setCodexConfigError(null);
      setCodexConfig((current: CodexUserConfigView | null) => (current ? applyConfigWriteToView(current, write.keyPath, write.value) : current));
      try {
        await client.rpc("config/batchWrite", {
          edits: [write],
          reloadUserConfig: true
        });
        const reloaded = await client.rpc("config/read", { includeLayers: false });
        setCodexConfig(parseConfigReadResponse(reloaded));
      } catch (error) {
        setCodexConfigError(errorMessage("Codex config write", error));
        try {
          const reloaded = await client.rpc("config/read", { includeLayers: false });
          setCodexConfig(parseConfigReadResponse(reloaded));
        } catch {
          /* keep optimistic state if re-read also fails */
        }
      } finally {
        setCodexConfigSaving(false);
      }
    },
    [authSession?.user, client]
  );
  return {
    codexConfig,
    setCodexConfig,
    codexConfigLoading,
    setCodexConfigLoading,
    codexConfigSaving,
    setCodexConfigSaving,
    codexConfigError,
    setCodexConfigError,
    applyLoadedCodexConfig,
    loadCodexConfig,
    writeCodexConfigField,
    writeCodexConfigValue,
  };
}
