import { useCallback, type Dispatch, type MutableRefObject, type SetStateAction } from "react";
import type { CompactMode } from "@codex-ui/shared";
import {
  checkFreeCompactionReadiness,
  describeFreeCompactionUnready,
  hasFreeRelay,
  listCompactionChannelOptions,
  type CompactionChannelOption,
  type FreeCompactionReadiness,
} from "../../../../frontends/free-mode/src/free/freeCompactionReadiness";
import { FREE_AUTOCOMPACT_MAX_THRESHOLD, FREE_AUTOCOMPACT_MIN_THRESHOLD, clampFreeAutoCompactThreshold } from "../../../../frontends/free-mode/src/free/freeAutoCompactPreferences";
import { NEW_CONVERSATION_SELECTION_KEY, type ThreadRuntimeSelection, type ThreadRuntimeSelectionsDomain } from "../app/runtime/useThreadRuntimeSelections";
import type { SlashCommandNotice } from "../app/workbench/appConstants";
import type { appReducer } from "../app/appReducer";
import type { ClientState, CodexSocketClient } from "../state/codexClient";
import type { TranslateFn } from "../i18n";

export function useFreeCompactionSelection(input: {
  state: ClientState;
  dispatch: Dispatch<Parameters<typeof appReducer>[1]>;
  runtimeSelection: ThreadRuntimeSelection;
  selectedModel: string;
  setSlashNotice: Dispatch<SetStateAction<SlashCommandNotice | null>>;
  freeAutoCompactBusyRef: MutableRefObject<boolean>;
  workspaceMode: import("../app/workbench/appConstants").WorkspaceMode;
  setFreeModelAccessOpen: Dispatch<SetStateAction<boolean>>;
} & Pick<ThreadRuntimeSelectionsDomain, "selectionForThread" | "updateRuntimeSelectionForKey">) {
  const { state, dispatch, runtimeSelection, selectedModel, setSlashNotice, freeAutoCompactBusyRef, selectionForThread, updateRuntimeSelectionForKey, workspaceMode, setFreeModelAccessOpen } = input;
  const freeAutoCompactEnabled = runtimeSelection.freeAutoCompactEnabled;
  const freeAutoCompactThreshold = runtimeSelection.freeAutoCompactThreshold;
  const freeAutoCompactModel = runtimeSelection.freeAutoCompactModel;
  const freeAutoCompactProviderId = runtimeSelection.freeAutoCompactProviderId;
  const freeAutoCompactGroupId = runtimeSelection.freeAutoCompactGroupId;
  const compactMode = runtimeSelection.compactMode;
  const jevCompressThreshold = runtimeSelection.jevCompressThreshold;

  const compactTools = runtimeSelection.vmPolicy?.tools;
  const compactCapabilityWarning = compactMode === "jev-sub" || compactMode === "jev-token"
    ? (!compactTools?.jevCompress
      ? "需先在代码增强工具第 7 节开启 jev_compress，否则压缩指令不会执行"
      : !compactTools?.clearToolHistory
        ? "需先在代码增强工具第 6 节开启 clear_tool_history，否则无法裁剪"
        : compactMode === "jev-sub" && !compactTools?.jevThinking
          ? "订阅高频剪建议同时开启 jev_thinking（第 7 节），用于分叉裁决"
          : compactMode === "jev-token" && !compactTools?.jevChecklist
            ? "阈值剪建议同时开启 jev_checklist（第 7 节），用于压缩前门卫检查"
            : null)
    : null;
  const setFreeAutoCompactEnabled = (enabled: boolean) => {
    if (freeAutoCompactBusyRef.current || enabled === freeAutoCompactEnabled) return;

    const selectionKey = state.activeThreadId ?? NEW_CONVERSATION_SELECTION_KEY;
    const nextSelection = { ...selectionForThread(state.activeThreadId), freeAutoCompactEnabled: enabled };
    updateRuntimeSelectionForKey(selectionKey, { freeAutoCompactEnabled: enabled });
    if (enabled) {
      const readiness = checkFreeModelsBeforeToggle();
      if (!readiness.ok && readiness.reason !== "no-active-thread") return;
    }

    const routeLabel = nextSelection.freeAutoCompactProviderId
      ? `${nextSelection.freeAutoCompactProviderId}/${nextSelection.freeAutoCompactModel ?? "未选择模型"}`
      : "未选择压缩渠道和模型";
    setSlashNotice({
      id: `free-compact-${Date.now()}`,
      title: enabled ? "省钱模式已开启" : "省钱模式已关闭",
      message: enabled
        ? `当前对话已开启，触发阈值 ${nextSelection.freeAutoCompactThreshold}%，压缩路由：${routeLabel}`
        : "当前对话已停止自动免费压缩，发送前不再拦截",
      severity: enabled ? "success" : "info"
    });
  };

  const setCompactMode = (mode: CompactMode) => {
    if (mode === compactMode) return;
    updateRuntimeSelectionForKey(state.activeThreadId ?? NEW_CONVERSATION_SELECTION_KEY, {
      compactMode: mode,
      freeAutoCompactEnabled: mode === "cheap"
    });
    if (mode === "cheap") {
      const readiness = checkFreeModelsBeforeToggle();
      if (!readiness.ok && readiness.reason !== "no-active-thread") return;
    }
    const modeLabel = mode === "off" ? "关闭" : mode === "cheap" ? "廉价模型压缩" : mode === "jev-sub" ? "JEV订阅高频剪" : "JEV Token阈值剪";
    setSlashNotice({
      id: `compact-mode-${Date.now()}`,
      title: `压缩策略：${modeLabel}`,
      message: mode === "off"
        ? "当前对话已关闭自动压缩"
        : mode === "cheap"
          ? `当前对话使用廉价模型压缩，触发阈值 ${freeAutoCompactThreshold}%`
          : `当前对话使用${modeLabel}，触发阈值 ${jevCompressThreshold}%，发送前将注入压缩指令`,
      severity: mode === "off" ? "info" : "success"
    });
  };

  const setJevCompressThreshold = (value: number) => {
    const clamped = clampFreeAutoCompactThreshold(value);
    updateRuntimeSelectionForKey(state.activeThreadId ?? NEW_CONVERSATION_SELECTION_KEY, { jevCompressThreshold: clamped });
    if (compactMode === "jev-sub" || compactMode === "jev-token") {
      setSlashNotice({
        id: `jev-compress-${Date.now()}`,
        title: "JEV压缩阈值已更新",
        message: `新阈值 ${clamped}%（${FREE_AUTOCOMPACT_MIN_THRESHOLD}–${FREE_AUTOCOMPACT_MAX_THRESHOLD}）`,
        severity: "info"
      });
    }
  };

  // L0能力门禁联动见 runtimeSelection 解构之后的 compactCapabilityWarning。

  const setFreeAutoCompactThreshold = (value: number) => {
    const clamped = clampFreeAutoCompactThreshold(value);
    updateRuntimeSelectionForKey(state.activeThreadId ?? NEW_CONVERSATION_SELECTION_KEY, { freeAutoCompactThreshold: clamped });
    if (freeAutoCompactEnabled) {
      setSlashNotice({
        id: `free-compact-${Date.now()}`,
        title: "省钱模式阈值已更新",
        message: `新阈值 ${clamped}%（${FREE_AUTOCOMPACT_MIN_THRESHOLD}–${FREE_AUTOCOMPACT_MAX_THRESHOLD}）`,
        severity: "info"
      });
    }
  };

  const freeCompactionChannelOptions = listCompactionChannelOptions(state.providers);
  const selectedFreeCompactionChannel = freeAutoCompactProviderId
    ? freeCompactionChannelOptions.find((option) => (
        option.providerId === freeAutoCompactProviderId
        && option.groupId === freeAutoCompactGroupId
      )) ?? null
    : null;
  const freeCompactionProviderOptions = Array.from(new Map(
    freeCompactionChannelOptions.map((option) => [option.providerId, {
      providerId: option.providerId,
      providerName: option.providerName
    }])
  ).values());
  const freeCompactionGroupOptions = freeAutoCompactProviderId
    ? freeCompactionChannelOptions.filter((option) => option.providerId === freeAutoCompactProviderId)
    : [];
  const freeCompactionModels = selectedFreeCompactionChannel?.models ?? [];
  const freeCompactionReadiness = checkFreeCompactionReadiness({
    currentModel: selectedModel,
    providers: state.providers,
    workspaceMode,
    activeThreadId: state.activeThreadId,
    manualProviderId: freeAutoCompactProviderId,
    manualGroupId: freeAutoCompactGroupId,
    manualFreeModel: freeAutoCompactModel
  });

  const setFreeAutoCompactProvider = (providerId: string | null) => {
    if (!providerId) {
      updateRuntimeSelectionForKey(state.activeThreadId ?? NEW_CONVERSATION_SELECTION_KEY, {
        freeAutoCompactProviderId: null,
        freeAutoCompactGroupId: null,
        freeAutoCompactModel: null
      });
      return;
    }
    const firstOption = freeCompactionChannelOptions.find((option: CompactionChannelOption) => option.providerId === providerId);
    updateRuntimeSelectionForKey(state.activeThreadId ?? NEW_CONVERSATION_SELECTION_KEY, {
      freeAutoCompactProviderId: providerId,
      freeAutoCompactGroupId: firstOption?.groupId ?? null,
      freeAutoCompactModel: firstOption?.models[0] ?? null
    });
  };

  const setFreeAutoCompactGroup = (groupId: string | null) => {
    if (!freeAutoCompactProviderId) return;
    const option = freeCompactionChannelOptions.find((entry: import("../../../../frontends/free-mode/src/free/freeCompactionReadiness").CompactionChannelOption) => (
      entry.providerId === freeAutoCompactProviderId && entry.groupId === groupId
    ));
    updateRuntimeSelectionForKey(state.activeThreadId ?? NEW_CONVERSATION_SELECTION_KEY, {
      freeAutoCompactGroupId: groupId,
      freeAutoCompactModel: option?.models.includes(freeAutoCompactModel ?? "")
        ? freeAutoCompactModel
        : option?.models[0] ?? null
    });
  };

  const setFreeAutoCompactModel = (model: string | null) => {
    updateRuntimeSelectionForKey(state.activeThreadId ?? NEW_CONVERSATION_SELECTION_KEY, { freeAutoCompactModel: model });
    setSlashNotice({
      id: `free-compact-model-${Date.now()}`,
      title: "压缩模型已更新",
      message: model ? `此对话将使用 ${model} 压缩上下文` : "此对话尚未选择手动压缩模型",
      severity: "info"
    });
  };
  const checkFreeModelsBeforeToggle = (): FreeCompactionReadiness => {
    const readiness = checkFreeCompactionReadiness({
      currentModel: selectedModel,
      providers: state.providers,
      workspaceMode,
      activeThreadId: state.activeThreadId,
      manualProviderId: runtimeSelection.freeAutoCompactProviderId,
      manualGroupId: runtimeSelection.freeAutoCompactGroupId,
      manualFreeModel: runtimeSelection.freeAutoCompactModel
    });
    if (readiness.ok) return readiness;
    const reason = readiness.reason;
    const detail = readiness.detail;
    const message = describeFreeCompactionUnready(reason, detail);
    const shouldPromptSync =
      !runtimeSelection.freeAutoCompactProviderId && (
        reason === "group-missing" ||
        reason === "group-empty" ||
        reason === "provider-missing" ||
        (reason === "manual-route-incomplete" && !hasFreeRelay(state.providers)) ||
        (reason === "manual-model-unavailable" && !hasFreeRelay(state.providers))
      );
    setSlashNotice({ id: `free-compact-${Date.now()}`, title: "省钱模式未就绪", message, severity: "warning" });
    if (shouldPromptSync) setFreeModelAccessOpen(true);
    console.warn("[free-auto-compact] readiness failed", reason, detail ?? "");
    return { ok: false, reason, detail };
  };

  return {
    freeAutoCompactEnabled,
    freeAutoCompactThreshold,
    freeAutoCompactModel,
    freeAutoCompactProviderId,
    freeAutoCompactGroupId,
    compactMode,
    jevCompressThreshold,
    setFreeAutoCompactEnabled,
    setCompactMode,
    setJevCompressThreshold,
    setFreeAutoCompactThreshold,
    freeCompactionChannelOptions,
    selectedFreeCompactionChannel,
    freeCompactionProviderOptions,
    freeCompactionGroupOptions,
    freeCompactionModels,
    freeCompactionReadiness,
    setFreeAutoCompactProvider,
    setFreeAutoCompactGroup,
    setFreeAutoCompactModel,
    checkFreeModelsBeforeToggle,
    compactCapabilityWarning,
  };
}
