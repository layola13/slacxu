import { useCallback, useEffect, useRef, useState } from "react";
import { applyReasoningEffortAgentDefaults, createDefaultSaVmPolicyConfig, parseAgentRuntimeOverride as parseSharedAgentRuntimeOverride, type AgentRuntimeOverride, type CompactMode, type PermissionPresetId, type ProviderConfig, type SaVmPolicyConfig, type CliBackend } from "@codex-ui/shared";
export { agentRuntimeThreadConfig as buildAgentThreadConfig } from "@codex-ui/shared";
import {
  fetchThreadRuntimeMetadata,
  updateThreadRuntimeMetadata,
  type ThreadEntry
} from "../../state/codexClient";
import {
  DEFAULT_IMAGE_RUNTIME_SELECTION,
  parseImageRuntimeSelections,
  type ImageRuntimeSelection
} from "../../imageRuntime";
import {
  restoreThreadRuntimePermission,
  THREAD_RUNTIME_PERMISSION_SCHEMA_VERSION
} from "../../threadRuntimePermission";
import {
  FREE_COMPACT_GROUP_ID,
  FREE_COMPACT_PROVIDER_ID
} from "../../../../../frontends/free-mode/src/free/freeCompactionReadiness";
import { normalizeThreadCliBackend } from "../cli/cliBackendKind";

export const NEW_CONVERSATION_SELECTION_KEY = "__new__";
const CODEX_RUNTIME_SELECTIONS_STORAGE_KEY = "codex-ultra.thread-runtime-selections";
const MINI_RUNTIME_SELECTIONS_STORAGE_KEY = "codex-ultra.mini-thread-runtime-selections";

export interface ThreadRuntimeSelection {
  providerId: string | null;
  groupId: string | null;
  model: string;
  reasoningEffort: string;
  freeAutoCompactEnabled: boolean;
  freeAutoCompactThreshold: number;
  freeAutoCompactModel: string | null;
  freeAutoCompactProviderId: string | null;
  freeAutoCompactGroupId: string | null;
  compactMode: CompactMode;
  jevCompressThreshold: number;
  permission: PermissionPresetId;
  permissionSchemaVersion: number;
  dangerBypassConfirmed: boolean;
  fastModeEnabled: boolean;
  planModeEnabled: boolean;
  vmEnabled: boolean;
  vmPolicy?: SaVmPolicyConfig;
  agents: AgentRuntimeOverride;
  cliBackend: CliBackend;
}

export const DEFAULT_AGENT_RUNTIME_OVERRIDE: AgentRuntimeOverride = {
  mode: "inherit",
  childCount: null,
  model: "",
  reasoningEffort: "",
  roles: []
};

export const DEFAULT_RUNTIME_SELECTION: ThreadRuntimeSelection = {
  providerId: null,
  groupId: null,
  model: "",
  reasoningEffort: "medium",
  freeAutoCompactEnabled: false,
  freeAutoCompactThreshold: 80,
  freeAutoCompactModel: null,
  freeAutoCompactProviderId: null,
  freeAutoCompactGroupId: null,
  compactMode: "off",
  jevCompressThreshold: 85,
  permission: "workspaceAsk",
  permissionSchemaVersion: THREAD_RUNTIME_PERMISSION_SCHEMA_VERSION,
  dangerBypassConfirmed: false,
  fastModeEnabled: false,
  planModeEnabled: false,
  vmEnabled: false,
  agents: DEFAULT_AGENT_RUNTIME_OVERRIDE,
  cliBackend: "mini"
};

export interface PersistedThreadRuntimeSelection {
  threadId: string;
  providerId: string | null;
  groupId: string | null;
  model: string;
  reasoningEffort: string;
  freeAutoCompactEnabled?: boolean;
  freeAutoCompactThreshold?: number;
  freeAutoCompactModel?: string | null;
  freeAutoCompactProviderId?: string | null;
  freeAutoCompactGroupId?: string | null;
  compactMode?: CompactMode;
  jevCompressThreshold?: number;
  permission: PermissionPresetId;
  agents?: AgentRuntimeOverride;
  cwd?: string;
  additionalRoots?: string[];
  workspaceFilePath?: string;
  cliBackend?: CliBackend;
  fastModeEnabled?: boolean;
  planModeEnabled?: boolean;
  vmEnabled?: boolean;
  vmPolicy?: SaVmPolicyConfig;
}

export interface LoadedThreadRuntimeSelection extends ThreadRuntimeSelection {
  cwd?: string;
  additionalRoots?: string[];
  workspaceFilePath?: string;
}

export interface ThreadRuntimeSelectionsDomain {
  threadRuntimeSelections: Record<string, ThreadRuntimeSelection>;
  imageRuntimeSelections: Record<string, ImageRuntimeSelection>;
  runtimeSelectionKey: string;
  runtimeSelection: ThreadRuntimeSelection;
  imageRuntimeSelection: ImageRuntimeSelection;
  selectedModelRef: React.MutableRefObject<string>;
  selectionForThread(threadId: string | null | undefined): ThreadRuntimeSelection;
  historySelectionForThread(threadId: string): ThreadRuntimeSelection;
  hydratePreferences(threadSelections: unknown, imageSelections: unknown): void;
  updateRuntimeSelection(patch: Partial<ThreadRuntimeSelection>): void;
  updateRuntimeSelectionAndPersist(patch: Partial<ThreadRuntimeSelection>): void;
  updateRuntimeSelectionForKey(selectionKey: string, patch: Partial<ThreadRuntimeSelection>): void;
  updateNewConversationRuntimeSelection(patch: Partial<ThreadRuntimeSelection>): void;
  patchThreadRuntimeSelection(threadId: string, patch: Partial<ThreadRuntimeSelection>): void;
  seedThreadRuntimeSelection(threadId: string): void;
  setSelectedModel(model: string): void;
  setReasoningEffort(effort: string): void;
  setActiveProviderId(providerId: string | null): void;
  setActiveGroupId(groupId: string | null): void;
  setRuntimePermission(permission: PermissionPresetId, confirmed?: boolean): void;
  updateImageRuntimeSelection(patch: Partial<ImageRuntimeSelection>, threadId?: string): void;
  loadPersistedThreadRuntimeSelection(threadId: string, fallback?: ThreadRuntimeSelection): Promise<LoadedThreadRuntimeSelection>;
  persistThreadRuntimeSelection(input: PersistedThreadRuntimeSelection, options?: { bypassPause?: boolean }): Promise<void>;
  awaitThreadRuntimePersistence(threadId: string): Promise<void>;
  setThreadRuntimePersistencePaused(threadId: string, paused: boolean): void;
  applyDefaultNewChatSelection(providers: ProviderConfig[]): boolean;
}

export interface ThreadRuntimeSelectionState {
  selections: Record<string, ThreadRuntimeSelection>;
  revisions: Record<string, number>;
}

export interface ThreadRuntimePersistenceRequest {
  token: string;
  selection: PersistedThreadRuntimeSelection;
}

/**
 * Owns the per-topic model, relay, effort and permission selections. App may
 * coordinate when a topic becomes active, but it must not mutate the backing
 * dictionaries itself.
 */
export function useThreadRuntimeSelections(input: {
  token: string | null;
  activeThreadId: string | null;
}): ThreadRuntimeSelectionsDomain {
  const [threadRuntimeSelections, setThreadRuntimeSelections] = useState<Record<string, ThreadRuntimeSelection>>(readThreadRuntimeSelections);
  const [imageRuntimeSelections, setImageRuntimeSelections] = useState<Record<string, ImageRuntimeSelection>>(readImageRuntimeSelections);
  const tokenRef = useRef(input.token);
  const selectionKeyRef = useRef(input.activeThreadId ?? NEW_CONVERSATION_SELECTION_KEY);
  const threadSelectionsRef = useRef(threadRuntimeSelections);
  // A metadata/preferences request may outlive a user interaction. Keep a
  // per-thread revision so late responses cannot put an older relay/model/
  // reasoning selection back into the active conversation.
  const selectionRevisionRef = useRef<Record<string, number>>({});
  const persistenceQueuesRef = useRef(new Map<string, Promise<void>>());
  const enqueuedPersistenceRevisionRef = useRef<Record<string, number>>({});
  const pausedPersistenceThreadIdsRef = useRef(new Set<string>());
  const deferredPersistenceThreadIdsRef = useRef(new Set<string>());

  tokenRef.current = input.token;
  selectionKeyRef.current = input.activeThreadId ?? NEW_CONVERSATION_SELECTION_KEY;
  threadSelectionsRef.current = threadRuntimeSelections;

  const runtimeSelectionKey = selectionKeyRef.current;
  const runtimeSelection = selectionForKey(threadRuntimeSelections, runtimeSelectionKey);
  const imageRuntimeSelection = imageRuntimeSelections[runtimeSelectionKey]
    ?? imageRuntimeSelections[NEW_CONVERSATION_SELECTION_KEY]
    ?? DEFAULT_IMAGE_RUNTIME_SELECTION;
  const selectedModelRef = useRef(runtimeSelection.model);
  selectedModelRef.current = runtimeSelection.model;

  const updateRuntimeSelection = useCallback((patch: Partial<ThreadRuntimeSelection>) => {
    const key = selectionKeyRef.current;
    const next = applyThreadRuntimeSelectionPatch(
      threadSelectionsRef.current,
      selectionRevisionRef.current,
      key,
      patch
    );
    if (next.selections === threadSelectionsRef.current) return;
    selectionRevisionRef.current = next.revisions;
    threadSelectionsRef.current = next.selections;
    setThreadRuntimeSelections(next.selections);
  }, []);

  const updateNewConversationRuntimeSelection = useCallback((patch: Partial<ThreadRuntimeSelection>) => {
    const next = applyThreadRuntimeSelectionPatch(
      threadSelectionsRef.current,
      selectionRevisionRef.current,
      NEW_CONVERSATION_SELECTION_KEY,
      patch
    );
    if (next.selections === threadSelectionsRef.current) return;
    selectionRevisionRef.current = next.revisions;
    threadSelectionsRef.current = next.selections;
    setThreadRuntimeSelections(next.selections);
  }, []);

  const updateRuntimeSelectionForKey = useCallback((selectionKey: string, patch: Partial<ThreadRuntimeSelection>) => {
    const next = applyThreadRuntimeSelectionPatch(
      threadSelectionsRef.current,
      selectionRevisionRef.current,
      selectionKey,
      patch
    );
    if (next.selections === threadSelectionsRef.current) return;
    selectionRevisionRef.current = next.revisions;
    threadSelectionsRef.current = next.selections;
    setThreadRuntimeSelections(next.selections);
  }, []);

  const patchThreadRuntimeSelection = useCallback((threadId: string, patch: Partial<ThreadRuntimeSelection>) => {
    updateRuntimeSelectionForKey(threadId, patch);
  }, [updateRuntimeSelectionForKey]);

  const seedThreadRuntimeSelection = useCallback((threadId: string) => {
    if (threadSelectionsRef.current[threadId]) return;
    const next = { ...threadSelectionsRef.current, [threadId]: defaultHistorySelection() };
    threadSelectionsRef.current = next;
    setThreadRuntimeSelections(next);
  }, []);

  const selectionForThread = useCallback((threadId: string | null | undefined) => {
    return selectionForKey(threadSelectionsRef.current, threadId ?? NEW_CONVERSATION_SELECTION_KEY);
  }, []);

  const historySelectionForThread = useCallback((threadId: string) => {
    const current = threadSelectionsRef.current;
    const existing = current[threadId];
    if (existing) return existing;
    return defaultHistorySelection();
  }, []);

  const hydratePreferences = useCallback((threadSelections: unknown, imageSelections: unknown) => {
    const parsedThreads = parseThreadRuntimeSelections(threadSelections);
    if (Object.keys(parsedThreads).length > 0) {
      const next = mergeHydratedThreadRuntimeSelections(threadSelectionsRef.current, parsedThreads, selectionRevisionRef.current);
      threadSelectionsRef.current = next;
      setThreadRuntimeSelections(next);
    }
    const parsedImages = parseImageRuntimeSelections(imageSelections);
    if (Object.keys(parsedImages).length > 0) setImageRuntimeSelections(parsedImages);
  }, []);

  const updateImageRuntimeSelection = useCallback((patch: Partial<ImageRuntimeSelection>, threadId?: string) => {
    setImageRuntimeSelections((current) => {
      const key = threadId ?? selectionKeyRef.current;
      const base = current[key] ?? current[NEW_CONVERSATION_SELECTION_KEY] ?? DEFAULT_IMAGE_RUNTIME_SELECTION;
      return { ...current, [key]: { ...base, ...patch } };
    });
  }, []);

  const loadPersistedThreadRuntimeSelection = useCallback(async (
    threadId: string,
    fallback = historySelectionForThread(threadId)
  ): Promise<LoadedThreadRuntimeSelection> => {
    const revision = selectionRevisionRef.current[threadId] ?? 0;
    // A local selection change is authoritative for this thread. Do not
    // reload an older server snapshot on send and overwrite the relay, model,
    // or reasoning effort the user just selected.
    const token = tokenRef.current;
    if (!token) {
      if ((selectionRevisionRef.current[threadId] ?? 0) === revision) {
        const next = applyPersistedThreadRuntimeSelection(
          threadSelectionsRef.current,
          selectionRevisionRef.current,
          threadId,
          revision,
          fallback,
          false
        );
        threadSelectionsRef.current = next;
        setThreadRuntimeSelections(next);
      }
      return selectionForKey(threadSelectionsRef.current, threadId);
    }
    try {
      const persisted = await fetchThreadRuntimeMetadata(token, threadId);
      if ((selectionRevisionRef.current[threadId] ?? 0) !== revision) {
        const current = selectionForKey(threadSelectionsRef.current, threadId);
        return {
          ...current,
          cwd: persisted?.cwd,
          additionalRoots: persisted?.additionalRoots,
          workspaceFilePath: persisted?.workspaceFilePath
        };
      }
      if (!persisted) {
        const next = applyPersistedThreadRuntimeSelection(
          threadSelectionsRef.current,
          selectionRevisionRef.current,
          threadId,
          revision,
          fallback,
          false
        );
        threadSelectionsRef.current = next;
        setThreadRuntimeSelections(next);
        return selectionForKey(threadSelectionsRef.current, threadId);
      }
      if (revision > 0) {
        return {
          ...selectionForKey(threadSelectionsRef.current, threadId),
          cwd: persisted.cwd,
          additionalRoots: persisted.additionalRoots,
          workspaceFilePath: persisted.workspaceFilePath
        };
      }
      const restoredFreeAutoCompactModel = normalizeFreeAutoCompactModel(persisted.freeAutoCompactModel);
      const persistedFreeAutoCompactProviderId = normalizeFreeAutoCompactRoutePart(persisted.freeAutoCompactProviderId);
      const persistedFreeAutoCompactGroupId = normalizeFreeAutoCompactRoutePart(persisted.freeAutoCompactGroupId);
      const upgradesLegacyFreeModelSelection = Boolean(
        restoredFreeAutoCompactModel
        && !persistedFreeAutoCompactProviderId
        && !persistedFreeAutoCompactGroupId
      );
      const restoredRoute = mergePersistedRuntimeRouteSelection(fallback, persisted);
      const restored: ThreadRuntimeSelection = {
        ...fallback,
        ...restoredRoute,
        reasoningEffort: persisted.reasoningEffort || fallback.reasoningEffort,
        freeAutoCompactEnabled: persisted.freeAutoCompactEnabled === true,
        freeAutoCompactThreshold: normalizeFreeAutoCompactThreshold(persisted.freeAutoCompactThreshold),
        freeAutoCompactModel: restoredFreeAutoCompactModel,
        freeAutoCompactProviderId: upgradesLegacyFreeModelSelection ? FREE_COMPACT_PROVIDER_ID : persistedFreeAutoCompactProviderId,
        freeAutoCompactGroupId: upgradesLegacyFreeModelSelection ? FREE_COMPACT_GROUP_ID : persistedFreeAutoCompactGroupId,
        compactMode: normalizeCompactMode(persisted.compactMode ?? (persisted.freeAutoCompactEnabled === true ? "cheap" : "off")),
        jevCompressThreshold: normalizeJevCompressThreshold(persisted.jevCompressThreshold),
        permission: persisted.permission ?? fallback.permission,
        permissionSchemaVersion: THREAD_RUNTIME_PERMISSION_SCHEMA_VERSION,
        dangerBypassConfirmed: (persisted.permission ?? fallback.permission) === "dangerBypass",
        fastModeEnabled: persisted.fastModeEnabled === true,
        planModeEnabled: persisted.planModeEnabled === true,
        vmEnabled: persisted.vmEnabled === true,
        vmPolicy: persisted.vmPolicy ?? (persisted.vmEnabled ? createDefaultSaVmPolicyConfig() : undefined),
        agents: persisted.agents ?? fallback.agents,
        cliBackend: persisted.cliBackend ? normalizeThreadCliBackend(persisted.cliBackend) : (fallback.cliBackend ?? "mini")
      };
      if ((selectionRevisionRef.current[threadId] ?? 0) !== revision) {
        return selectionForKey(threadSelectionsRef.current, threadId);
      }
      const next = applyPersistedThreadRuntimeSelection(
        threadSelectionsRef.current,
        selectionRevisionRef.current,
        threadId,
        revision,
        restored,
        true
      );
      threadSelectionsRef.current = next;
      setThreadRuntimeSelections(next);
      if ((!persisted.permission || upgradesLegacyFreeModelSelection || (persisted.vmEnabled && !persisted.vmPolicy)) && (selectionRevisionRef.current[threadId] ?? 0) === revision) {
        await updateThreadRuntimeMetadata(token, {
          threadId,
          providerId: restored.providerId,
          groupId: restored.groupId,
            model: restored.model,
            reasoningEffort: restored.reasoningEffort,
            freeAutoCompactEnabled: restored.freeAutoCompactEnabled,
            freeAutoCompactThreshold: restored.freeAutoCompactThreshold,
            freeAutoCompactModel: restored.freeAutoCompactModel,
            freeAutoCompactProviderId: restored.freeAutoCompactProviderId,
            freeAutoCompactGroupId: restored.freeAutoCompactGroupId,
            compactMode: restored.compactMode,
            jevCompressThreshold: restored.jevCompressThreshold,
            permission: restored.permission,
            agents: restored.agents,
            fastModeEnabled: restored.fastModeEnabled,
            planModeEnabled: restored.planModeEnabled,
            vmEnabled: restored.vmEnabled,
            vmPolicy: restored.vmPolicy
        });
      }
      return {
        ...restored,
        cwd: persisted.cwd,
        additionalRoots: persisted.additionalRoots,
        workspaceFilePath: persisted.workspaceFilePath
      };
    } catch (error) {
      console.warn("[thread runtime] failed to load persisted selection", { threadId, error });
      if ((selectionRevisionRef.current[threadId] ?? 0) === revision) {
        const next = applyPersistedThreadRuntimeSelection(
          threadSelectionsRef.current,
          selectionRevisionRef.current,
          threadId,
          revision,
          fallback,
          false
        );
        threadSelectionsRef.current = next;
        setThreadRuntimeSelections(next);
      }
      return selectionForKey(threadSelectionsRef.current, threadId);
    }
  }, [historySelectionForThread]);

  const persistThreadRuntimeSelection = useCallback(async (
    selection: PersistedThreadRuntimeSelection,
    options?: { bypassPause?: boolean }
  ) => {
    const token = tokenRef.current;
    if (!token) throw new Error("An active session is required to save conversation runtime metadata");
    const threadId = selection.threadId;
    if (!options?.bypassPause && pausedPersistenceThreadIdsRef.current.has(threadId)) {
      deferredPersistenceThreadIdsRef.current.add(threadId);
      return;
    }
    const previous = persistenceQueuesRef.current.get(threadId) ?? Promise.resolve();
    let task!: Promise<void>;
    task = previous.catch(() => undefined).then(() => updateThreadRuntimeMetadata(token, selection)).then(() => undefined).finally(() => {
      if (persistenceQueuesRef.current.get(threadId) === task) persistenceQueuesRef.current.delete(threadId);
    });
    persistenceQueuesRef.current.set(threadId, task);
    await task;
  }, []);

  const awaitThreadRuntimePersistence = useCallback(async (threadId: string) => {
    await (persistenceQueuesRef.current.get(threadId) ?? Promise.resolve()).catch(() => undefined);
  }, []);

  // Relay / model / effort setters persist immediately for the active thread so a
  // refresh or close cannot lose the per-conversation route. For the
  // new-conversation key they stay memory-only, same as before.
  const enqueueLatestThreadRuntimeSelection = useCallback((threadId: string) => {
    if (pausedPersistenceThreadIdsRef.current.has(threadId)) {
      deferredPersistenceThreadIdsRef.current.add(threadId);
      return false;
    }
    void enqueueLatestThreadRuntimePersistence(
      persistenceQueuesRef.current,
      threadId,
      () => {
        const token = tokenRef.current;
        const selection = threadSelectionsRef.current[threadId];
        if (!token || !selection) return null;
        return {
          token,
          selection: {
            threadId,
            providerId: selection.providerId,
            groupId: selection.groupId,
            model: selection.model,
            reasoningEffort: selection.reasoningEffort,
            freeAutoCompactEnabled: selection.freeAutoCompactEnabled,
            freeAutoCompactThreshold: selection.freeAutoCompactThreshold,
            freeAutoCompactModel: selection.freeAutoCompactModel,
            freeAutoCompactProviderId: selection.freeAutoCompactProviderId,
            freeAutoCompactGroupId: selection.freeAutoCompactGroupId,
            compactMode: selection.compactMode,
            jevCompressThreshold: selection.jevCompressThreshold,
            permission: selection.permission,
            agents: selection.agents,
            cliBackend: selection.cliBackend,
            fastModeEnabled: selection.fastModeEnabled,
            planModeEnabled: selection.planModeEnabled,
            vmEnabled: selection.vmEnabled,
            vmPolicy: selection.vmPolicy
          }
        };
      },
      ({ token, selection }) => updateThreadRuntimeMetadata(token, selection),
      (error) => console.warn("[thread runtime] failed to save selection", { threadId, error })
    );
    return true;
  }, []);

  const updateRuntimeSelectionAndPersist = useCallback((patch: Partial<ThreadRuntimeSelection>) => {
    const threadId = selectionKeyRef.current;
    updateRuntimeSelection(patch);
    if (threadId !== NEW_CONVERSATION_SELECTION_KEY && enqueueLatestThreadRuntimeSelection(threadId)) {
      enqueuedPersistenceRevisionRef.current[threadId] = selectionRevisionRef.current[threadId] ?? 0;
    }
  }, [enqueueLatestThreadRuntimeSelection, updateRuntimeSelection]);

  const setSelectedModel = useCallback((model: string) => updateRuntimeSelectionAndPersist({ model }), [updateRuntimeSelectionAndPersist]);
  const setReasoningEffort = useCallback((reasoningEffort: string) => {
    const defaults = applyReasoningEffortAgentDefaults(reasoningEffort, selectionForThread(selectionKeyRef.current).agents);
    updateRuntimeSelectionAndPersist(defaults);
  }, [selectionForThread, updateRuntimeSelectionAndPersist]);
  const setActiveProviderId = useCallback((providerId: string | null) => updateRuntimeSelectionAndPersist({ providerId }), [updateRuntimeSelectionAndPersist]);
  const setActiveGroupId = useCallback((groupId: string | null) => updateRuntimeSelectionAndPersist({ groupId }), [updateRuntimeSelectionAndPersist]);
  const setRuntimePermission = useCallback((permission: PermissionPresetId, confirmed = false) => {
    updateRuntimeSelection({
      permission,
      dangerBypassConfirmed: permission === "dangerBypass" ? confirmed : false
    });
  }, [updateRuntimeSelection]);

  const applyDefaultNewChatSelection = useCallback((providers: ProviderConfig[]) => {
    const defaultProvider = providers.find((provider) => /deepkey/i.test(provider.id) || /deepkey/i.test(provider.name)) ?? providers[0];
    if (!defaultProvider) return false;
    const groups = defaultProvider.groups ?? [];
    const defaultGroup = groups.find((group) => group.id === "codex" || /codex/i.test(group.id) || /codex/i.test(group.name))
      ?? groups.find((group) => group.kind !== "image")
      ?? groups[0]
      ?? null;
    const models = defaultGroup?.models ?? defaultProvider.nativeModels ?? [];
    setThreadRuntimeSelections((current) => {
      const next = patchSelection(current, NEW_CONVERSATION_SELECTION_KEY, {
        providerId: defaultProvider.id,
        groupId: defaultGroup?.id ?? null,
        model: models.find((model) => model === "gpt-5.5") ?? models[0] ?? "",
        vmEnabled: false,
        vmPolicy: undefined
      });
      threadSelectionsRef.current = next;
      return next;
    });
    return true;
  }, []);

  const setThreadRuntimePersistencePaused = useCallback((threadId: string, paused: boolean) => {
    if (paused) {
      pausedPersistenceThreadIdsRef.current.add(threadId);
      return;
    }
    pausedPersistenceThreadIdsRef.current.delete(threadId);
    if (!deferredPersistenceThreadIdsRef.current.delete(threadId)) return;
    const revision = selectionRevisionRef.current[threadId] ?? 0;
    if (enqueueLatestThreadRuntimeSelection(threadId)) {
      enqueuedPersistenceRevisionRef.current[threadId] = revision;
    }
  }, [enqueueLatestThreadRuntimeSelection]);

  useEffect(() => {
    const token = input.token;
    if (!token) return;
    for (const [threadId, selection] of Object.entries(threadRuntimeSelections)) {
      if (threadId === NEW_CONVERSATION_SELECTION_KEY || !selection) continue;
      const revision = selectionRevisionRef.current[threadId] ?? 0;
      if (revision === 0 || (enqueuedPersistenceRevisionRef.current[threadId] ?? 0) >= revision) continue;
      if (enqueueLatestThreadRuntimeSelection(threadId)) {
        enqueuedPersistenceRevisionRef.current[threadId] = revision;
      }
    }
  }, [enqueueLatestThreadRuntimeSelection, input.token, threadRuntimeSelections]);

  useEffect(() => {
    seedThreadRuntimeSelection(runtimeSelectionKey);
  }, [runtimeSelectionKey, seedThreadRuntimeSelection]);

  return {
    threadRuntimeSelections,
    imageRuntimeSelections,
    runtimeSelectionKey,
    runtimeSelection,
    imageRuntimeSelection,
    selectedModelRef,
    selectionForThread,
    historySelectionForThread,
    hydratePreferences,
    updateRuntimeSelection,
    updateRuntimeSelectionAndPersist,
    updateRuntimeSelectionForKey,
    updateNewConversationRuntimeSelection,
    patchThreadRuntimeSelection,
    seedThreadRuntimeSelection,
    setSelectedModel,
    setReasoningEffort,
    setActiveProviderId,
    setActiveGroupId,
    setRuntimePermission,
    updateImageRuntimeSelection,
    loadPersistedThreadRuntimeSelection,
    persistThreadRuntimeSelection,
    awaitThreadRuntimePersistence,
    setThreadRuntimePersistencePaused,
    applyDefaultNewChatSelection
  };
}

export function parseThreadRuntimeSelections(value: unknown): Record<string, ThreadRuntimeSelection> {
  const parsed = record(value);
  if (!parsed) return {};
  return Object.fromEntries(Object.entries(parsed).flatMap(([key, entry]) => {
    const selection = record(entry) as Partial<ThreadRuntimeSelection> | null;
    if (!selection || typeof selection.model !== "string" || typeof selection.reasoningEffort !== "string") return [];
    if (selection.providerId !== null && typeof selection.providerId !== "string") return [];
    if (selection.groupId !== null && typeof selection.groupId !== "string") return [];
    const restoredPermission = restoreThreadRuntimePermission({
      isNewConversation: key === NEW_CONVERSATION_SELECTION_KEY,
      permission: selection.permission,
      permissionSchemaVersion: selection.permissionSchemaVersion,
      dangerBypassConfirmed: selection.dangerBypassConfirmed
    });
    const freeAutoCompactModel = normalizeFreeAutoCompactModel(selection.freeAutoCompactModel);
    const storedFreeAutoCompactProviderId = normalizeFreeAutoCompactRoutePart(selection.freeAutoCompactProviderId);
    const storedFreeAutoCompactGroupId = normalizeFreeAutoCompactRoutePart(selection.freeAutoCompactGroupId);
    const upgradesLegacyFreeModelSelection = Boolean(
      freeAutoCompactModel
      && !storedFreeAutoCompactProviderId
      && !storedFreeAutoCompactGroupId
    );
    return [[key, {
      providerId: selection.providerId ?? null,
      groupId: selection.groupId ?? null,
      model: selection.model,
      reasoningEffort: selection.reasoningEffort,
      freeAutoCompactEnabled: selection.freeAutoCompactEnabled === true,
      freeAutoCompactThreshold: normalizeFreeAutoCompactThreshold(selection.freeAutoCompactThreshold),
      freeAutoCompactModel,
      freeAutoCompactProviderId: upgradesLegacyFreeModelSelection ? FREE_COMPACT_PROVIDER_ID : storedFreeAutoCompactProviderId,
      freeAutoCompactGroupId: upgradesLegacyFreeModelSelection ? FREE_COMPACT_GROUP_ID : storedFreeAutoCompactGroupId,
      compactMode: normalizeCompactMode(selection.compactMode ?? (selection.freeAutoCompactEnabled === true ? "cheap" : "off")),
      jevCompressThreshold: normalizeJevCompressThreshold(selection.jevCompressThreshold),
      fastModeEnabled: selection.fastModeEnabled === true,
      planModeEnabled: selection.planModeEnabled === true,
      vmEnabled: key === NEW_CONVERSATION_SELECTION_KEY ? false : selection.vmEnabled === true,
      vmPolicy: key === NEW_CONVERSATION_SELECTION_KEY ? undefined : selection.vmPolicy ?? (selection.vmEnabled ? createDefaultSaVmPolicyConfig() : undefined),
      agents: parseAgentRuntimeOverride(selection.agents),
      cliBackend: normalizeThreadCliBackend(selection.cliBackend),
      ...restoredPermission
    } satisfies ThreadRuntimeSelection]];
  }));
}

export function mergePersistedRuntimeRouteSelection(
  fallback: Pick<ThreadRuntimeSelection, "providerId" | "groupId" | "model">,
  persisted: Partial<Pick<ThreadRuntimeSelection, "providerId" | "groupId" | "model">>
): Pick<ThreadRuntimeSelection, "providerId" | "groupId" | "model"> {
  return {
    providerId: persisted.providerId || fallback.providerId,
    groupId: persisted.groupId || fallback.groupId,
    model: persisted.model || fallback.model
  };
}

export function threadRuntimeSelectionsForPreferences(
  selections: Record<string, ThreadRuntimeSelection>
): Record<string, ThreadRuntimeSelection> {
  const newConversationSelection = selections[NEW_CONVERSATION_SELECTION_KEY];
  return newConversationSelection
    ? { [NEW_CONVERSATION_SELECTION_KEY]: { ...newConversationSelection, vmEnabled: false, vmPolicy: undefined } }
    : {};
}

export function parseAgentRuntimeOverride(value: unknown): AgentRuntimeOverride {
  return parseSharedAgentRuntimeOverride(value);
}

export function applyThreadRuntimeSelectionPatch(
  selections: Record<string, ThreadRuntimeSelection>,
  revisions: Record<string, number>,
  key: string,
  patch: Partial<ThreadRuntimeSelection>
): ThreadRuntimeSelectionState {
  const nextSelections = patchSelection(selections, key, patch);
  if (nextSelections === selections) return { selections, revisions };
  return {
    selections: nextSelections,
    revisions: { ...revisions, [key]: (revisions[key] ?? 0) + 1 }
  };
}

export function mergeHydratedThreadRuntimeSelections(
  current: Record<string, ThreadRuntimeSelection>,
  hydrated: Record<string, ThreadRuntimeSelection>,
  revisions: Record<string, number>
): Record<string, ThreadRuntimeSelection> {
  const next = { ...current };
  for (const [key, selection] of Object.entries(hydrated)) {
    // Preferences are an initial snapshot. Preserve anything the user changed
    // while that snapshot was being fetched or applied.
    if ((revisions[key] ?? 0) === 0) next[key] = selection;
  }
  return next;
}

export function applyPersistedThreadRuntimeSelection(
  selections: Record<string, ThreadRuntimeSelection>,
  revisions: Record<string, number>,
  threadId: string,
  requestRevision: number,
  persisted: ThreadRuntimeSelection,
  replaceExisting: boolean
): Record<string, ThreadRuntimeSelection> {
  if ((revisions[threadId] ?? 0) !== requestRevision) return selections;
  const existing = selections[threadId];
  if (!replaceExisting && existing) return selections;
  if (existing && threadRuntimeSelectionsEqual(existing, persisted)) return selections;
  return { ...selections, [threadId]: persisted };
}

export function enqueueLatestThreadRuntimePersistence(
  queues: Map<string, Promise<void>>,
  threadId: string,
  readLatest: () => ThreadRuntimePersistenceRequest | null,
  persist: (request: ThreadRuntimePersistenceRequest) => Promise<unknown>,
  onError: (error: unknown) => void = () => undefined
): Promise<void> {
  const previous = queues.get(threadId) ?? Promise.resolve();
  const task = previous.catch(() => undefined).then(async () => {
    const latest = readLatest();
    if (latest) await persist(latest);
  }).catch(onError).finally(() => {
    if (queues.get(threadId) === task) queues.delete(threadId);
  });
  queues.set(threadId, task);
  return task;
}

function patchSelection(
  current: Record<string, ThreadRuntimeSelection>,
  key: string,
  patch: Partial<ThreadRuntimeSelection>
): Record<string, ThreadRuntimeSelection> {
  const base = selectionForKey(current, key);
  const next = { ...base, ...patch };
  if (patch.permission) next.permissionSchemaVersion = THREAD_RUNTIME_PERMISSION_SCHEMA_VERSION;
  if (patch.permission && patch.permission !== "dangerBypass" && patch.dangerBypassConfirmed === undefined) {
    next.dangerBypassConfirmed = false;
  }
  if (threadRuntimeSelectionsEqual(base, next)) return current;
  return { ...current, [key]: next };
}

function threadRuntimeSelectionsEqual(left: ThreadRuntimeSelection, right: ThreadRuntimeSelection): boolean {
  return left.providerId === right.providerId
    && left.groupId === right.groupId
    && left.model === right.model
    && left.reasoningEffort === right.reasoningEffort
    && left.freeAutoCompactEnabled === right.freeAutoCompactEnabled
    && left.freeAutoCompactThreshold === right.freeAutoCompactThreshold
    && left.freeAutoCompactModel === right.freeAutoCompactModel
    && left.freeAutoCompactProviderId === right.freeAutoCompactProviderId
    && left.freeAutoCompactGroupId === right.freeAutoCompactGroupId
    && left.compactMode === right.compactMode
    && left.jevCompressThreshold === right.jevCompressThreshold
    && left.permission === right.permission
    && left.permissionSchemaVersion === right.permissionSchemaVersion
    && left.dangerBypassConfirmed === right.dangerBypassConfirmed
    && left.fastModeEnabled === right.fastModeEnabled
    && left.planModeEnabled === right.planModeEnabled
    && left.vmEnabled === right.vmEnabled
    && JSON.stringify(left.vmPolicy) === JSON.stringify(right.vmPolicy)
    && left.agents === right.agents
    && left.cliBackend === right.cliBackend;
}

function normalizeFreeAutoCompactThreshold(value: unknown): number {
  const numeric = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(numeric)) return 80;
  return Math.min(95, Math.max(50, Math.round(numeric)));
}

function normalizeCompactMode(value: unknown): CompactMode {
  return value === "cheap" || value === "jev-sub" || value === "jev-token" ? value : "off";
}

function normalizeJevCompressThreshold(value: unknown): number {
  const numeric = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(numeric)) return 85;
  return Math.min(95, Math.max(50, Math.round(numeric)));
}

function normalizeFreeAutoCompactModel(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 && trimmed.length <= 512 ? trimmed : null;
}

function normalizeFreeAutoCompactRoutePart(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 && trimmed.length <= 512 ? trimmed : null;
}

function selectionForKey(selections: Record<string, ThreadRuntimeSelection>, key: string): ThreadRuntimeSelection {
  if (key === NEW_CONVERSATION_SELECTION_KEY) {
    return selections[key] ?? DEFAULT_RUNTIME_SELECTION;
  }
  return selections[key] ?? defaultHistorySelection();
}

export function defaultHistorySelection(): ThreadRuntimeSelection {
  return {
    ...DEFAULT_RUNTIME_SELECTION,
    // Unknown history threads default to codex, not mini: codex is the native
    // default everywhere else (normalizeThreadCliBackend, sidebar `?? "codex"`,
    // server default route), while mini threads always self-identify via file,
    // session or persisted metadata. Inheriting the new-conversation default
    // ("mini") here mislabeled metadata-less codex threads as mini on reopen
    // and misrouted their next turn (param cliBackend=mini short-circuits the
    // server's mini file-check). New-conversation default stays mini.
    cliBackend: "mini",
    permission: "dangerBypass",
    permissionSchemaVersion: THREAD_RUNTIME_PERMISSION_SCHEMA_VERSION,
    dangerBypassConfirmed: true
  };
}

function readThreadRuntimeSelections(): Record<string, ThreadRuntimeSelection> {
  try {
    const codex = parseThreadRuntimeSelections(JSON.parse(localStorage.getItem(CODEX_RUNTIME_SELECTIONS_STORAGE_KEY) ?? "{}"));
    const mini = parseThreadRuntimeSelections(JSON.parse(localStorage.getItem(MINI_RUNTIME_SELECTIONS_STORAGE_KEY) ?? "{}"));
    return { ...codex, ...mini };
  } catch {
    return {};
  }
}

function readImageRuntimeSelections(): Record<string, ImageRuntimeSelection> {
  try {
    return parseImageRuntimeSelections(JSON.parse(localStorage.getItem("codex-ultra.image-runtime-selections") ?? "{}"));
  } catch {
    return {};
  }
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

export function runtimeSelectionFallbackForThread(
  thread: ThreadEntry | undefined,
  fallback: ThreadRuntimeSelection
): ThreadRuntimeSelection {
  if (!thread) return fallback;
  return {
    ...fallback,
    providerId: thread.modelProvider?.trim() || fallback.providerId,
    model: thread.model?.trim() || fallback.model,
    reasoningEffort: fallback.reasoningEffort || "medium",
    cliBackend: thread.cliBackend
      ? normalizeThreadCliBackend(thread.cliBackend)
      : (fallback.cliBackend ?? "mini")
  };
}
