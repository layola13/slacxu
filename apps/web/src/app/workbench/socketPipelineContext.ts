import type { Dispatch, MutableRefObject, SetStateAction } from "react";
import type { ProviderConfig, ThreadAgentRoster } from "@codex-ui/shared";
import type {
  ComposerImageAttachment,
  ComposerMention,
  PtyTerminalSession,
  SocketConnectionStatus,
  WorkbenchTurn,
} from "../../state/codexClient";
import type { createTaskNotificationTracker, TaskNotificationEvent } from "../../taskNotifications";
import type { SplitViewState, WorkspaceLayoutState } from "../../taskTabs";
import type { TurnRetryState } from "../turnRetryState";
import type { TopicUsageStore } from "../usage/topicUsageStore";
import type { TopicTranscriptStore } from "../transcripts/topicTranscriptStore";
import type { ThreadTokenUsageState } from "../../components/ChatPanel";
import type { AuthStatus, StartCodexTurnOptions } from "./appConstants";
import type { useTopicTranscriptRuntime } from "../transcripts/useTopicTranscriptRuntime";
import type { ThreadRuntimeSelectionsDomain } from "../runtime/useThreadRuntimeSelections";
import type { appReducer } from "../../app/appReducer";
import type { ClientState } from "../../state/codexClient";
import type { TranslateFn } from "../../i18n";
import type { JsonRpcNotification } from "@codex-ui/shared";

type ModelCapacityRetryEntry = {
  attempt: number;
  max: number;
  timer: number | null;
  failedTurnId?: string;
  retryTurnId?: string;
  prompt?: string;
  exhausted: boolean;
  lastFailureTurnId?: string;
  lastError?: string;
  details?: string;
  errorTurnIds: Set<string>;
};

type FreeCompactionWaiter = {
  resolve: () => void;
  reject: (error: Error) => void;
  cancel: () => void;
  turnId?: string;
  providerId: string;
  model: string;
  contextWindow: number | null;
};

type CompactionSource = {
  source: "free" | "native";
  providerId: string;
  model: string;
};

export type SocketPipelineInput = {
  state: ClientState;
  dispatch: Dispatch<Parameters<typeof appReducer>[1]>;
  hasOpenedSocketRef: MutableRefObject<boolean>;
  setConnectionEpoch: Dispatch<SetStateAction<number>>;
  authStatus: AuthStatus;
  verifySessionAfterDisconnect: () => Promise<void>;
  setConnectionStatus: Dispatch<SetStateAction<SocketConnectionStatus>>;
  lastCodexActivityAtRef: MutableRefObject<number>;
  handleGoalNotification(message: JsonRpcNotification): void;
  transcriptRuntime: ReturnType<typeof useTopicTranscriptRuntime>;
  turnsRef: MutableRefObject<WorkbenchTurn[]>;
  activeThreadIdRef: MutableRefObject<string | null>;
  t: TranslateFn;
  activeProviderId: string | null;
  capacityTurnRetryEnabled: boolean;
  topicTranscriptStore: TopicTranscriptStore;
  usageStore: TopicUsageStore;
  providersRef: MutableRefObject<ProviderConfig[]>;
  publishThreadTokenUsage: (immediate?: boolean) => void;
  applyTurnRetryState: (next: TurnRetryState | null | ((current: TurnRetryState | null) => TurnRetryState | null)) => void;
  turnRetryStateRef: MutableRefObject<TurnRetryState | null>;
  modelCapacityRetryRef: MutableRefObject<Map<string, ModelCapacityRetryEntry>>;
  contextWindowByTurnIdRef: MutableRefObject<Record<string, number | null>>;
  pendingContextWindowByThreadRef: MutableRefObject<Record<string, number | null>>;
  freeCompactionContextWindowByTurnIdRef: MutableRefObject<Record<string, number | null>>;
  freeCompactionSourceTurnIdsRef: MutableRefObject<Set<string>>;
  freeCompactionWaitersRef: MutableRefObject<Map<string, FreeCompactionWaiter>>;
  freeCompactAfterTurnRef: MutableRefObject<((options?: { threadId?: string; silentSkip?: boolean }) => Promise<void>) | null>;
  taskNotificationTrackerRef: MutableRefObject<ReturnType<typeof createTaskNotificationTracker>>;
  startCodexTurnRef: MutableRefObject<(text: string, images: ComposerImageAttachment[], mentions: ComposerMention[], options?: StartCodexTurnOptions) => Promise<string | null>>;
  appendTerminalOutput: (processId: string, output: string) => void;
  enqueueTokenUsage: (threadId: string | undefined, turnId: string | undefined, usage: ThreadTokenUsageState) => void;
  loadTooling: (options?: { forceSkillReload?: boolean; skillExtraRoots?: string[] }) => Promise<void>;
  sendWindowsTaskNotification: (event: TaskNotificationEvent) => void;
  setCompactionSourceByTurnId: Dispatch<SetStateAction<Record<string, CompactionSource>>>;
  setOfficialLoginNotice: Dispatch<SetStateAction<string | null>>;
  setOfficialLoginOpen: Dispatch<SetStateAction<boolean>>;
  setPendingAcceptedThreads: Dispatch<SetStateAction<Set<string>>>;
  setPtyTerminals: Dispatch<SetStateAction<PtyTerminalSession[]>>;
  setSplitView: Dispatch<SetStateAction<SplitViewState | null>>;
  setThreadAgentRosters: Dispatch<SetStateAction<Record<string, ThreadAgentRoster>>>;
  setWorkspaceLayout: Dispatch<SetStateAction<WorkspaceLayoutState | null>>;
  suppressThreadAutoNudge: (threadId: string | null | undefined) => void;
} & Pick<ThreadRuntimeSelectionsDomain, "selectionForThread" | "patchThreadRuntimeSelection" | "setActiveProviderId" | "setActiveGroupId">;
