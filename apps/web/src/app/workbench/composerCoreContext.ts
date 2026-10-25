import type { Dispatch, MutableRefObject, SetStateAction } from "react";
import type { AuthSession, JsonValue, PermissionPresetId, ProviderConfig } from "@codex-ui/shared";
import type { SplitViewState, WorkspaceLayoutState } from "../../taskTabs";
import type { PendingSendGate } from "../../composer/PendingSendGate";
import type { InterruptTurnGate } from "../turnInterruptRetry";
import type { TopicTranscriptStore } from "../transcripts/topicTranscriptStore";
import type { PendingAppendMessage } from "../../waterfall/pendingRows";
import type { ReasoningOption } from "../../settings/SettingsDrawer";
import type { CodexUserConfigView } from "../../state/codexConfigSettings";
import type {
  DangerDialogIntent,
  SlashCommandNotice,
  SshPreflightResult,
  WorkspaceMode,
} from "./appConstants";
import type {
  ThreadRuntimeSelection,
  ThreadRuntimeSelectionsDomain,
} from "../runtime/useThreadRuntimeSelections";
import type { ImageRuntimeSelection } from "../../imageRuntime";
import type { appReducer } from "../../app/appReducer";
import type { ClientState, CodexSocketClient, FreebuffSessionStatus, WorkbenchTurn } from "../../state/codexClient";
import type { TranslateFn } from "../../i18n";

export type FreebuffFallbackSuggestion = {
  currentModel: string;
  suggestedModel: { id: string; name: string; price: number };
  reason: string;
} | null;

export type ComposerCoreInput = {
  state: ClientState;
  authSession: AuthSession | null;
  imageRuntimeSelection: ImageRuntimeSelection;
  dispatch: Dispatch<Parameters<typeof appReducer>[1]>;
  client: CodexSocketClient;
  t: TranslateFn;
  runtimeSelection: ThreadRuntimeSelection;
  workspaceMode: WorkspaceMode;
  cwd: string;
  sshCommand: string;
  additionalRoots: string[];
  workspaceFilePath: string | null;
  workspaceSelectionPending: boolean;
  localWorkspaceDefaultPath: string;
  activeProviderId: string | null;
  activeGroupId: string | null;
  selectedModel: string;
  reasoningEffort: string;
  reasoningOptions: ReasoningOption[];
  permission: PermissionPresetId;
  isClaudeBackend: boolean;
  isAgyBackend: boolean;
  isGrokBackend: boolean;
  isPiBackend: boolean;
  isOpencodeBackend: boolean;
  isOpencodeV2Backend: boolean;
  fastModeEnabled: boolean;
  dangerBypassPermissionConfirmed: boolean;
  enablePlanAutoContinuation: (threadId: string) => void;
  codexConfig: CodexUserConfigView | null;
  freebuffSession: FreebuffSessionStatus | null;
  freebuffAutoFailover: boolean;
  refreshFreebuffSession: (token?: string | null) => Promise<FreebuffSessionStatus | null>;
  ensureRuntimeProviderActivated: () => Promise<void>;
  refreshProviders: (token: string, options?: { force?: boolean }) => Promise<ProviderConfig[]>;
  applyHistoryThreads: (threads: ClientState["threads"]) => void;
  loadAuditEvents: () => Promise<void>;
  resumeThreadAutoNudge: (threadId: string | null | undefined) => void;
  cwdForThread: (threadId: string | null) => string;
  activeThreadIdRef: MutableRefObject<string | null>;
  allHistoryThreadsRef: MutableRefObject<ClientState["threads"]>;
  turnsRef: MutableRefObject<WorkbenchTurn[]>;
  activatedProviderSelectionRef: MutableRefObject<string | null>;
  pendingSendGateRef: MutableRefObject<PendingSendGate>;
  interruptTurnGateRef: MutableRefObject<InterruptTurnGate>;
  startCodexTurnInFlightRef: MutableRefObject<{ key: string; at: number } | null>;
  planContinuationTimersRef: MutableRefObject<Map<string, number>>;
  writerConflictThreadIdsRef: MutableRefObject<Set<string>>;
  contextWindowByTurnIdRef: MutableRefObject<Record<string, number | null>>;
  pendingContextWindowByThreadRef: MutableRefObject<Record<string, number | null>>;
  optimisticThreadIdsRef: MutableRefObject<Set<string>>;
  splitMutationEpochRef: MutableRefObject<number>;
  topicTranscriptStore: TopicTranscriptStore;
  setPendingAppends: Dispatch<SetStateAction<PendingAppendMessage[]>>;
  setPendingAcceptedThreads: Dispatch<SetStateAction<Set<string>>>;
  setClosedTaskTabIds: Dispatch<SetStateAction<string[]>>;
  setTaskTabOrder: Dispatch<SetStateAction<string[]>>;
  setSplitView: Dispatch<SetStateAction<SplitViewState | null>>;
  setWorkspaceLayout: Dispatch<SetStateAction<WorkspaceLayoutState | null>>;
  setComposerSuggestion: Dispatch<SetStateAction<{ id: string; text: string } | null>>;
  setDangerDialogAcknowledged: Dispatch<SetStateAction<boolean>>;
  setDangerDialogIntent: Dispatch<SetStateAction<DangerDialogIntent | null>>;
  setFreebuffFallbackSuggestion: Dispatch<SetStateAction<FreebuffFallbackSuggestion>>;
  setFreebuffSwitchDialogOpen: Dispatch<SetStateAction<boolean>>;
  setFreebuffSwitchTargetModel: Dispatch<SetStateAction<string>>;
  setNewChatSetupOpen: Dispatch<SetStateAction<boolean>>;
  setOfficialLoginNotice: Dispatch<SetStateAction<string | null>>;
  setOfficialLoginOpen: Dispatch<SetStateAction<boolean>>;
  setPendingNewConversationCount: Dispatch<SetStateAction<number>>;
  setSlashNotice: Dispatch<SetStateAction<SlashCommandNotice | null>>;
  setSshInstallConfirming: Dispatch<SetStateAction<boolean>>;
  setSshInstallError: Dispatch<SetStateAction<string | null>>;
  setSshPreflightIssue: Dispatch<SetStateAction<SshPreflightResult | null>>;
} & Pick<
  ThreadRuntimeSelectionsDomain,
  | "selectionForThread"
  | "historySelectionForThread"
  | "updateRuntimeSelection"
  | "updateImageRuntimeSelection"
  | "setThreadRuntimePersistencePaused"
  | "awaitThreadRuntimePersistence"
  | "patchThreadRuntimeSelection"
  | "persistThreadRuntimeSelection"
  | "loadPersistedThreadRuntimeSelection"
  | "updateNewConversationRuntimeSelection"
  | "setSelectedModel"
>;

export type { JsonValue };
