import { useCallback, useRef, useState, type Dispatch, type MutableRefObject } from "react";
import type { AuthSession, JsonValue, PermissionPresetId, ProviderConfig, RelayCatalogImportResult } from "@codex-ui/shared";
import {
  ClaudeDesktopConfigNotFoundError,
  CursorInstallDirNotFoundError,
  exportProfile,
  exportRelayBackup,
  exportRelayConfig,
  fetchProviders,
  fetchRelaySettings,
  importCapabilityCatalog,
  importFreeOllamaRelay,
  importProfile,
  importRelayBackup,
  importRelayConfig,
  injectRelayToClaudeDesktop,
  injectRelayToCursorDesktop,
} from "../../state/codexClient";
import { decryptRelayShare, encryptRelayShare, isRelayShareText, validateRelaySharePasswords } from "../../app/relayShare";
import { fastReasoningEffort, formatErrorText } from "./appUtils";
import { resolveTextRuntimeGroupId } from "./modelSelectionUtils";
import type { ThreadRuntimeSelection } from "../runtime/useThreadRuntimeSelections";
import type { appReducer } from "../../app/appReducer";
import type { ClientState, CodexSocketClient } from "../../state/codexClient";
import type { TranslateFn } from "../../i18n";

export function useProvidersRuntime(input: {
  state: ClientState;
  dispatch: Dispatch<Parameters<typeof appReducer>[1]>;
  client: CodexSocketClient;
  t: TranslateFn;
  providersRef: MutableRefObject<ProviderConfig[]>;
  activatedProviderSelectionRef: MutableRefObject<string | null>;
  activeProviderId: string | null;
  activeGroupId: string | null;
  selectedModel: string;
  authSession: AuthSession | null;
  workspaceSelectionPending: boolean;
  settingsOpen: boolean;
  isClaudeBackend: boolean;
  isAgyBackend: boolean;
  isGrokBackend: boolean;
  loadBasics: (options?: { forceHistoryRefresh?: boolean; preserveHistory?: boolean }) => Promise<void>;
  updateRuntimeSelection: (patch: Partial<ThreadRuntimeSelection>) => void;
  updateNewConversationRuntimeSelection: (patch: Partial<ThreadRuntimeSelection>) => void;
  setRuntimePermission: (permission: PermissionPresetId, confirmed?: boolean) => void;
  setActiveProviderId: (providerId: string | null) => void;
  setActiveGroupId: (groupId: string | null) => void;
}) {
  const {
    state,
    dispatch,
    client,
    t,
    providersRef,
    activatedProviderSelectionRef,
    activeProviderId,
    activeGroupId,
    selectedModel,
    authSession,
    workspaceSelectionPending,
    settingsOpen,
    isClaudeBackend,
    isAgyBackend,
    isGrokBackend,
    loadBasics,
    updateRuntimeSelection,
    updateNewConversationRuntimeSelection,
    setRuntimePermission,
    setActiveProviderId,
    setActiveGroupId,
  } = input;
  const [relayShareImportText, setRelayShareImportText] = useState("");
  const [relayShareImportPassword, setRelayShareImportPassword] = useState("");
  const [relayShareImportOpen, setRelayShareImportOpen] = useState(false);
  const [relayShareImportBusy, setRelayShareImportBusy] = useState(false);
  const [relayShareImportError, setRelayShareImportError] = useState<string | null>(null);
  const [relayShareExportError, setRelayShareExportError] = useState<string | null>(null);
  const [relayShareExportBusy, setRelayShareExportBusy] = useState(false);
  const [relayShareExportProvider, setRelayShareExportProvider] = useState<ProviderConfig | null>(null);
  const [relayShareExportPassword, setRelayShareExportPassword] = useState("");
  const [relayShareExportConfirm, setRelayShareExportConfirm] = useState("");
  const [relayShareExportText, setRelayShareExportText] = useState("");
  const [relayShareExportOpen, setRelayShareExportOpen] = useState(false);
  const providerRefreshRef = useRef<{ token: string; promise: Promise<ProviderConfig[]> } | null>(null);
  const providerRefreshCacheRef = useRef<{ token: string; refreshedAt: number; providers: ProviderConfig[] } | null>(null);

  const refreshProviders = useCallback((token: string, options: { force?: boolean } = {}): Promise<ProviderConfig[]> => {
    const cached = providerRefreshCacheRef.current;
    if (!options.force && cached && cached.token === token && Date.now() - cached.refreshedAt < 1_500) {
      return Promise.resolve(cached.providers);
    }
    const inFlight = providerRefreshRef.current;
    if (inFlight?.token === token) return inFlight.promise;

    const task = fetchProviders(token).then((providers: Awaited<ReturnType<typeof fetchProviders>>) => {
      dispatch({ type: "providers", providers });
      providerRefreshCacheRef.current = { token, refreshedAt: Date.now(), providers };
      return providers;
    });
    const tracked = task.finally(() => {
      if (providerRefreshRef.current?.promise === tracked) providerRefreshRef.current = null;
    });
    providerRefreshRef.current = { token, promise: tracked };
    return tracked;
  }, []);

  const ensureRuntimeProviderActivated = useCallback(async () => {
    if (!activeProviderId || isClaudeBackend || isAgyBackend || isGrokBackend || activeProviderId === "agy-official" || activeProviderId === "grok-official") return;
    const runtimeGroupId = resolveTextRuntimeGroupId(state.providers, activeProviderId, activeGroupId, selectedModel);
    const activationKey = `${activeProviderId}:${runtimeGroupId ?? ""}:${selectedModel || ""}`;
    if (activatedProviderSelectionRef.current === activationKey) return;
    await client.activateProvider(activeProviderId, selectedModel || undefined, runtimeGroupId ?? undefined);
    activatedProviderSelectionRef.current = activationKey;
  }, [activeGroupId, activeProviderId, client, isAgyBackend, isClaudeBackend, isGrokBackend, selectedModel, state.providers]);

  const saveProvider = useCallback(
    async (provider: ProviderConfig, apiKey?: string, mergeIntoProviderId?: string) => {
      if (authSession?.user && authSession.user.role !== "admin") {
        throw new Error("Admin only: provider management");
      }
      try {
        const saved = await client.saveProvider(provider, apiKey, mergeIntoProviderId);
        const providers = [saved, ...state.providers.filter((entry: ProviderConfig) => entry.id !== saved.id)];
        dispatch({
          type: "providers",
          providers
        });
      } catch (error) {
        dispatch({ type: "error", message: formatErrorText(error) });
        throw error;
      }
    },
    [authSession, client, state.providers]
  );

  const injectClaudeDesktop = useCallback(
    async (
      providerId: string,
      groupId?: string,
      models?: string[],
      modelMappings?: Record<string, string>
    ) => {
      if (!state.token) throw new Error("Authentication required");
      // Automatic path discovery can fail on non-standard installs (e.g. MSIX
      // publisher hashes or future layout changes); fall back to a manually
      // entered configLibrary directory instead of failing outright.
      let configLibraryDir: string | undefined;
      for (;;) {
        try {
          await injectRelayToClaudeDesktop(state.token, { providerId, groupId, models, modelMappings, configLibraryDir });
          return;
        } catch (error) {
          if (!(error instanceof ClaudeDesktopConfigNotFoundError)) throw error;
          const entered = window.prompt(
            "未能自动找到 Claude Desktop 配置目录（configLibrary），请手动输入其完整路径：",
            configLibraryDir ?? ""
          );
          if (!entered?.trim()) throw error;
          configLibraryDir = entered.trim();
        }
      }
    },
    [state.token]
  );

  const injectCursorDesktop = useCallback(
    async (providerId: string, groupId?: string) => {
      if (!state.token) throw new Error("Authentication required");
      // Cursor is not always installed under %LOCALAPPDATA% (D:\ installs are
      // common); when the default path has no Cursor.exe the server answers with
      // cursorInstallDirNotFound and we prompt for the real directory instead of
      // guessing across drives.
      let installDir: string | undefined;
      for (;;) {
        try {
          await injectRelayToCursorDesktop(state.token, { providerId, groupId, installDir });
          return;
        } catch (error) {
          if (!(error instanceof CursorInstallDirNotFoundError)) throw error;
          const entered = window.prompt(
            "未在默认位置找到 Cursor（Cursor.exe），请手动输入 Cursor 安装目录的完整路径：",
            error.searchedPath?.replace(/[\\/]Cursor\.exe$/i, "") ?? installDir ?? ""
          );
          if (!entered?.trim()) throw error;
          installDir = entered.trim();
        }
      }
    },
    [state.token]
  );

  const syncFreeOllama = useCallback(async () => {
    if (!state.token) throw new Error("Authentication required");
    const result = await importFreeOllamaRelay(state.token);
    // The import response intentionally contains a redacted settings view,
    // not a complete ProviderConfig. Reload the canonical provider list so
    // nativeModels, aliases and persisted metadata remain intact.
    const providers = await fetchProviders(state.token);
    dispatch({ type: "providers", providers });
    return result;
  }, [state.token]);

  const activateProvider = useCallback(
    async (providerId: string, model?: string, groupId?: string) => {
      try {
        const activation = await client.activateProvider(providerId, model, groupId);
        activatedProviderSelectionRef.current = `${providerId}:${activation.groupId ?? groupId ?? ""}:${activation.model ?? model ?? ""}`;
        updateRuntimeSelection({
          providerId,
          groupId: activation.groupId ?? null,
          model: activation.model ?? model ?? ""
        });
        await loadBasics({ preserveHistory: true });
      } catch (error) {
        dispatch({ type: "error", message: formatErrorText(error) });
        throw error;
      }
    },
    [client, loadBasics, updateRuntimeSelection]
  );

  const openRelayShareExport = useCallback(async (provider: ProviderConfig) => {
    setRelayShareExportProvider(provider);
    setRelayShareExportPassword("");
    setRelayShareExportConfirm("");
    setRelayShareExportText("");
    setRelayShareExportError(null);
    setRelayShareExportOpen(true);
  }, []);

  const createRelayShare = useCallback(async () => {
    if (!state.token) {
      setRelayShareExportError("当前登录会话不可用，请重新打开设置后再试");
      return;
    }
    if (!relayShareExportProvider) {
      setRelayShareExportError("未找到要分享的中转站，请关闭对话框后重新选择");
      return;
    }
    const passwordError = validateRelaySharePasswords(relayShareExportPassword, relayShareExportConfirm);
    if (passwordError) {
      setRelayShareExportError(passwordError);
      return;
    }
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 15_000);
    setRelayShareExportBusy(true);
    setRelayShareExportError(null);
    setRelayShareExportText("");
    try {
      const provider = await fetchRelaySettings(state.token, relayShareExportProvider.id, controller.signal);
      setRelayShareExportText(await encryptRelayShare(provider, relayShareExportPassword.trim()));
      setRelayShareExportError(null);
    } catch (error) {
      setRelayShareExportError(error instanceof DOMException && error.name === "AbortError"
        ? "生成分享内容超时，请检查服务连接或中转站配置大小后重试"
        : `生成分享内容失败：${formatErrorText(error)}`);
    } finally {
      window.clearTimeout(timeout);
      setRelayShareExportBusy(false);
    }
  }, [relayShareExportConfirm, relayShareExportPassword, relayShareExportProvider, state.token]);

  const copyRelayShare = useCallback(async () => {
    if (!relayShareExportText) return;
    try {
      await navigator.clipboard.writeText(relayShareExportText);
      setRelayShareExportError(null);
    } catch (error) {
      setRelayShareExportError(`复制失败：${formatErrorText(error)}`);
    }
  }, [relayShareExportText]);

  const handleRelayShareText = useCallback((value: string) => {
    if (!isRelayShareText(value)) return;
    setRelayShareImportText(value.trim());
    setRelayShareImportPassword("");
    setRelayShareImportError(null);
    setRelayShareImportOpen(true);
  }, []);

  const importRelayShareDirectly = useCallback(async () => {
    if (!state.token || !relayShareImportText || !relayShareImportPassword.trim()) return;
    setRelayShareImportBusy(true);
    setRelayShareImportError(null);
    try {
      const provider = await decryptRelayShare(relayShareImportText, relayShareImportPassword);
      const providerIdExists = state.providers.some((entry: ProviderConfig) => entry.id === provider.id);
      const importedProvider = {
        ...provider,
        id: providerIdExists ? `${provider.id}-shared-${Date.now().toString(36)}` : provider.id,
        name: providerIdExists ? `${provider.name}（分享）` : provider.name,
        sharedImport: { source: "codex-ultra-share" as const, importedAt: Date.now() }
      };
      const result = await importRelayConfig(state.token, {
        schema: "codex-react-ui.relay-config.v1",
        exportedAt: Date.now(),
        includesSecrets: true,
        providers: [importedProvider]
      });
      dispatch({ type: "providers", providers: result.providers });
      setRelayShareImportOpen(false);
      setRelayShareImportText("");
      setRelayShareImportPassword("");
    } catch (error) {
      setRelayShareImportError(`导入失败：${formatErrorText(error)}`);
    } finally {
      setRelayShareImportBusy(false);
    }
  }, [relayShareImportPassword, relayShareImportText, state.providers, state.token]);



  const deleteProvider = useCallback(
    async (providerId: string) => {
      if (authSession?.user && authSession.user.role !== "admin") {
        throw new Error("Admin only: provider management");
      }
      try {
        const deletedProviderId = await client.trashProvider(providerId);
        const providers = state.providers.filter((entry: ProviderConfig) => entry.id !== deletedProviderId);
        dispatch({
          type: "providers",
          providers
        });
        if (activeProviderId === deletedProviderId) {
          setActiveProviderId(null);
          setActiveGroupId(null);
        }
      } catch (error) {
        dispatch({ type: "error", message: formatErrorText(error) });
        throw error;
      }
    },
    [activeProviderId, authSession, client, state.providers]
  );

  const restoreProvider = useCallback(
    async (providerId: string) => {
      if (authSession?.user && authSession.user.role !== "admin") {
        throw new Error("Admin only: provider management");
      }
      try {
        const restoredProvider = await client.restoreProvider(providerId);
        const providers = state.providers.filter((entry: ProviderConfig) => entry.id !== restoredProvider.id);
        dispatch({ type: "providers", providers: [...providers, restoredProvider] });
      } catch (error) {
        dispatch({ type: "error", message: formatErrorText(error) });
        throw error;
      }
    },
    [authSession, client, state.providers]
  );

  const downloadProfile = useCallback(async () => {
    if (!state.token) {
      dispatch({ type: "error", message: "UI session token is not ready" });
      return;
    }
    try {
      const profile = await exportProfile(state.token);
      const blob = new Blob([`${JSON.stringify(profile, null, 2)}
`], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `codex-react-ui-profile-${new Date(profile.exportedAt).toISOString().slice(0, 10)}.json`;
      document.body.append(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(url);
    } catch (error) {
      dispatch({ type: "error", message: formatErrorText(error) });
      throw error;
    }
  }, [state.token]);

  const uploadProfile = useCallback(
    async (file: File) => {
      if (!state.token) {
        dispatch({ type: "error", message: "UI session token is not ready" });
        return 0;
      }
      try {
        const profile = JSON.parse(await file.text());
        const result = await importProfile(state.token, profile);
        dispatch({ type: "providers", providers: result.providers });
        return result.importedProviders;
      } catch (error) {
        dispatch({ type: "error", message: formatErrorText(error) });
        throw error;
      }
    },
    [state.token]
  );

  const downloadRelayConfig = useCallback(async () => {
    if (!state.token) {
      dispatch({ type: "error", message: "UI session token is not ready" });
      return;
    }
    try {
      const bundle = await exportRelayConfig(state.token);
      const blob = new Blob([`${JSON.stringify(bundle, null, 2)}
`], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `codex-react-ui-relays-with-keys-${new Date(bundle.exportedAt).toISOString().slice(0, 10)}.json`;
      document.body.append(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(url);
    } catch (error) {
      dispatch({ type: "error", message: formatErrorText(error) });
      throw error;
    }
  }, [state.token]);

  const uploadRelayConfig = useCallback(
    async (file: File) => {
      if (!state.token) {
        dispatch({ type: "error", message: "UI session token is not ready" });
        return 0;
      }
      try {
        const bundle = JSON.parse(await file.text());
        const result = await importRelayConfig(state.token, bundle);
        dispatch({ type: "providers", providers: result.providers });
        return result.importedProviders;
      } catch (error) {
        dispatch({ type: "error", message: formatErrorText(error) });
        throw error;
      }
    },
    [state.token]
  );

  const downloadRelayBackup = useCallback(async () => {
    if (!state.token) {
      dispatch({ type: "error", message: "UI session token is not ready" });
      return;
    }
    try {
      const bundle = await exportRelayBackup(state.token);
      const blob = new Blob([`${JSON.stringify(bundle, null, 2)}
`], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `codex-relay-backup-${new Date(bundle.exportedAt).toISOString().slice(0, 10)}.json`;
      document.body.append(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(url);
    } catch (error) {
      dispatch({ type: "error", message: formatErrorText(error) });
      throw error;
    }
  }, [state.token]);

  const uploadRelayBackup = useCallback(
    async (file: File) => {
      if (!state.token) {
        dispatch({ type: "error", message: "UI session token is not ready" });
        return 0;
      }
      try {
        const bundle = JSON.parse(await file.text());
        const result = await importRelayBackup(state.token, bundle);
        const providers = await refreshProviders(state.token, { force: true });
        dispatch({ type: "providers", providers });
        return result.importedProviders;
      } catch (error) {
        dispatch({ type: "error", message: formatErrorText(error) });
        throw error;
      }
    },
    [refreshProviders, state.token]
  );

  const uploadCapabilityCatalog = useCallback(
    async (providerId: string, catalog: JsonValue, mode: "merge" | "replace"): Promise<RelayCatalogImportResult> => {
      if (!state.token) throw new Error("UI session token is not ready");
      try {
        const result = await importCapabilityCatalog(state.token, providerId, catalog, mode);
        const providers = await fetchProviders(state.token);
        dispatch({ type: "providers", providers });
        return result;
      } catch (error) {
        dispatch({ type: "error", message: formatErrorText(error) });
        throw error;
      }
    },
    [state.token]
  );
  return {
    relayShareImportText,
    setRelayShareImportText,
    relayShareImportPassword,
    setRelayShareImportPassword,
    relayShareImportOpen,
    setRelayShareImportOpen,
    relayShareImportBusy,
    setRelayShareImportBusy,
    relayShareImportError,
    setRelayShareImportError,
    relayShareExportError,
    setRelayShareExportError,
    relayShareExportBusy,
    setRelayShareExportBusy,
    relayShareExportProvider,
    setRelayShareExportProvider,
    relayShareExportPassword,
    setRelayShareExportPassword,
    relayShareExportConfirm,
    setRelayShareExportConfirm,
    relayShareExportText,
    setRelayShareExportText,
    relayShareExportOpen,
    setRelayShareExportOpen,
    refreshProviders,
    ensureRuntimeProviderActivated,
    saveProvider,
    injectClaudeDesktop,
    injectCursorDesktop,
    syncFreeOllama,
    activateProvider,
    openRelayShareExport,
    createRelayShare,
    copyRelayShare,
    handleRelayShareText,
    importRelayShareDirectly,
    deleteProvider,
    restoreProvider,
    downloadProfile,
    uploadProfile,
    downloadRelayConfig,
    uploadRelayConfig,
    downloadRelayBackup,
    uploadRelayBackup,
    uploadCapabilityCatalog,
  };
}
