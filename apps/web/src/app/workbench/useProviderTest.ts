import { useCallback, useEffect, useState, type Dispatch, type MutableRefObject, type SetStateAction } from "react";
import { CODEX_PROVIDER_TEST_PROMPT, type WorkspaceMode } from "./appConstants";
import { fastReasoningEffort } from "./appUtils";
import type { ReasoningOption } from "../../settings/SettingsDrawer";
import type { SplitViewState, WorkspaceLayoutState } from "../../taskTabs";
import type { ThreadRuntimeSelectionsDomain } from "../runtime/useThreadRuntimeSelections";

type StartCodexTurnFn = (text: string, images: import("../../state/codexClient").ComposerImageAttachment[], mentions: import("../../state/codexClient").ComposerMention[], options?: import("./appConstants").StartCodexTurnOptions) => Promise<string | null>;
import type { appReducer } from "../../app/appReducer";
import type { ClientState, CodexSocketClient } from "../../state/codexClient";
import type { TranslateFn } from "../../i18n";

export function useProviderTest(input: {
  state: ClientState;
  dispatch: Dispatch<Parameters<typeof appReducer>[1]>;
  client: CodexSocketClient;
  t: TranslateFn;
  activateProvider: (providerId: string, model?: string, groupId?: string) => Promise<void>;
  setSettingsOpen: Dispatch<SetStateAction<boolean>>;
  setWorkspaceMode: Dispatch<SetStateAction<WorkspaceMode>>;
  setWorkspaceSelectionPending: Dispatch<SetStateAction<boolean>>;
  setWelcomeDismissed: Dispatch<SetStateAction<boolean>>;
  splitMutationEpochRef: MutableRefObject<number>;
  setWorkspaceLayout: Dispatch<SetStateAction<WorkspaceLayoutState | null>>;
  setSplitView: Dispatch<SetStateAction<SplitViewState | null>>;
  startCodexTurn: StartCodexTurnFn;
  reasoningOptions: ReasoningOption[];
  reasoningEffort: string;
  settingsOpen: boolean;
  workspaceSelectionPending: boolean;
  activeProviderId: string | null;
  setDangerBypassConfirmed: (confirmed: boolean) => void;
} & Pick<ThreadRuntimeSelectionsDomain, "setRuntimePermission" | "updateNewConversationRuntimeSelection">) {
  const {
    state, dispatch, client, t, activateProvider, setSettingsOpen, setWorkspaceMode,
    setWorkspaceSelectionPending, setWelcomeDismissed, splitMutationEpochRef, setWorkspaceLayout,
    setSplitView, startCodexTurn, reasoningOptions, reasoningEffort, settingsOpen,
    workspaceSelectionPending, activeProviderId, setRuntimePermission,
    updateNewConversationRuntimeSelection, setDangerBypassConfirmed,
  } = input;
  const [pendingCodexProviderTest, setPendingCodexProviderTest] = useState<{ providerId: string; prompt: string } | null>(null);

  const testProviderWithCodex = useCallback(
    async (providerId: string, model?: string) => {
      await activateProvider(providerId, model);
      setSettingsOpen(false);
      setRuntimePermission("readonlyAsk");
      setDangerBypassConfirmed(false);
      updateNewConversationRuntimeSelection({ fastModeEnabled: true });
      setWorkspaceMode("local");
      setWorkspaceSelectionPending(false);
      setWelcomeDismissed(true);
      splitMutationEpochRef.current += 1;
      setWorkspaceLayout(null);
      setSplitView(null);
      dispatch({ type: "newConversation" });
      setPendingCodexProviderTest({ providerId, prompt: CODEX_PROVIDER_TEST_PROMPT });
    },
    [activateProvider, setRuntimePermission, updateNewConversationRuntimeSelection]
  );

  useEffect(() => {
    if (
      !pendingCodexProviderTest ||
      settingsOpen ||
      workspaceSelectionPending ||
      state.activeThreadId !== null ||
      activeProviderId !== pendingCodexProviderTest.providerId ||
      !state.connected ||
      state.engine.phase !== "ready"
    ) {
      return;
    }
    const { prompt } = pendingCodexProviderTest;
    setPendingCodexProviderTest(null);
    void startCodexTurn(prompt, [], [], {
      forceEffort: fastReasoningEffort(reasoningOptions, reasoningEffort)
    });
  }, [
    activeProviderId,
    pendingCodexProviderTest,
    reasoningEffort,
    reasoningOptions,
    settingsOpen,
    startCodexTurn,
    state.activeThreadId,
    state.connected,
    state.engine.phase,
    workspaceSelectionPending
  ]);
  return { pendingCodexProviderTest, setPendingCodexProviderTest, testProviderWithCodex };
}
