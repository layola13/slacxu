import { useCallback, useEffect, useState, type Dispatch, type MutableRefObject, type SetStateAction } from "react";
import {
  fetchClineBalance,
  fetchFreebuffSessionStatus,
  releaseFreebuffSessionSlot,
  type ClineBalanceInfo,
  type FreebuffSessionStatus,
} from "../../state/codexClient";
import { formatErrorText } from "./appUtils";
import { readStoredBoolean } from "./preferenceUtils";
import type { SlashCommandNotice } from "./appConstants";
import type { FreebuffFallbackSuggestion } from "./composerCoreContext";
import type { ThreadRuntimeSelectionsDomain } from "../runtime/useThreadRuntimeSelections";
import type { appReducer } from "../../app/appReducer";
import type { ClientState, CodexSocketClient } from "../../state/codexClient";
import type { TranslateFn } from "../../i18n";

export function useFreebuffSession(input: {
  state: ClientState;
  dispatch: Dispatch<Parameters<typeof appReducer>[1]>;
  activeThreadIdRef: MutableRefObject<string | null>;
  setSlashNotice: Dispatch<SetStateAction<SlashCommandNotice | null>>;
} & Pick<ThreadRuntimeSelectionsDomain, "updateNewConversationRuntimeSelection" | "setSelectedModel">) {
  const { state, dispatch, activeThreadIdRef, setSlashNotice, updateNewConversationRuntimeSelection, setSelectedModel } = input;
  const [freebuffSession, setFreebuffSession] = useState<FreebuffSessionStatus | null>(null);
  const [freebuffSwitchDialogOpen, setFreebuffSwitchDialogOpen] = useState(false);
  const [freebuffSwitchTargetModel, setFreebuffSwitchTargetModel] = useState("");
  const [freebuffSwitchBusy, setFreebuffSwitchBusy] = useState(false);
  const [clineBalance, setClineBalance] = useState<ClineBalanceInfo | null>(null);
  const [freebuffAutoFailover, setFreebuffAutoFailover] = useState(() => readStoredBoolean("codex_freebuff_auto_failover", true));
  const [freebuffFallbackSuggestion, setFreebuffFallbackSuggestion] = useState<{
    currentModel: string;
    suggestedModel: { id: string; name: string; price: number };
    reason: string;
  } | null>(null);

  useEffect(() => {
    window.localStorage.setItem("codex_freebuff_auto_failover", freebuffAutoFailover ? "true" : "false");
  }, [freebuffAutoFailover]);

  const refreshFreebuffSession = useCallback(async (token: string | null = state.token) => {
    if (!token) return null;
    try {
      const status = await fetchFreebuffSessionStatus(token);
      setFreebuffSession(status);
      return status;
    } catch {
      return null;
    }
  }, [state.token]);

  const refreshClineBalance = useCallback(async (token: string | null = state.token, forceRefresh: boolean = false) => {
    if (!token) return null;
    try {
      const balanceInfo = await fetchClineBalance(token, forceRefresh);
      setClineBalance(balanceInfo);
      return balanceInfo;
    } catch {
      return null;
    }
  }, [state.token]);

  const handleReleaseFreebuffSlotFromChip = useCallback(async () => {
    if (!state.token) return;
    try {
      await releaseFreebuffSessionSlot(state.token);
      await refreshFreebuffSession();
      setSlashNotice({
        id: `freebuff-slot-released-${Date.now()}`,
        title: "Freebuff 插槽已释放",
        message: "当前模型插槽已成功释放",
        severity: "info"
      });
    } catch (error) {
      dispatch({ type: "error", message: `释放 Freebuff 插槽失败: ${formatErrorText(error)}` });
    }
  }, [state.token, refreshFreebuffSession, dispatch]);

  const handleConfirmFreebuffSwitch = useCallback(async () => {
    if (!state.token || !freebuffSwitchTargetModel) return;
    setFreebuffSwitchBusy(true);
    try {
      await releaseFreebuffSessionSlot(state.token);
      if (activeThreadIdRef.current) setSelectedModel(freebuffSwitchTargetModel);
      else updateNewConversationRuntimeSelection({ model: freebuffSwitchTargetModel });
      setFreebuffSwitchDialogOpen(false);
      await refreshFreebuffSession();
    } catch (error) {
      dispatch({ type: "error", message: `释放 Freebuff 插槽失败: ${formatErrorText(error)}` });
    } finally {
      setFreebuffSwitchBusy(false);
    }
  }, [dispatch, freebuffSwitchTargetModel, refreshFreebuffSession, setSelectedModel, state.token, updateNewConversationRuntimeSelection]);

  const handleKeepCurrentFreebuffModel = useCallback(() => {
    if (freebuffSession?.active && freebuffSession.model) {
      if (activeThreadIdRef.current) setSelectedModel(freebuffSession.model);
      else updateNewConversationRuntimeSelection({ model: freebuffSession.model });
    }
    setFreebuffSwitchDialogOpen(false);
  }, [freebuffSession, setSelectedModel, updateNewConversationRuntimeSelection]);
  return {
    freebuffSession,
    setFreebuffSession,
    freebuffSwitchDialogOpen,
    setFreebuffSwitchDialogOpen,
    freebuffSwitchTargetModel,
    setFreebuffSwitchTargetModel,
    freebuffSwitchBusy,
    setFreebuffSwitchBusy,
    clineBalance,
    setClineBalance,
    freebuffAutoFailover,
    setFreebuffAutoFailover,
    freebuffFallbackSuggestion,
    setFreebuffFallbackSuggestion,
    refreshFreebuffSession,
    refreshClineBalance,
    handleReleaseFreebuffSlotFromChip,
    handleConfirmFreebuffSwitch,
    handleKeepCurrentFreebuffModel,
  };
}
