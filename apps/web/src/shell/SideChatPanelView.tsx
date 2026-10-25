import { lazy } from "react";
import type { ComponentProps, Dispatch, SetStateAction } from "react";
import type { ModelEntry } from "../state/codexClient";
import { resolveSideChatTabModel, sideChatModelOptions } from "../app/sidechat/sideChatDuckDefaults";
import { TopicTranscriptBoundary } from "../app/transcripts/TopicTranscriptBoundary";
import type { PanelTranscriptProjection } from "../app/transcripts/transcriptProjection";
import type { SideChatTab } from "../components/SideChatPanel";
import type { ReasoningOption } from "../settings/SettingsDrawer";
import type { TranslateFn } from "../i18n";
import type { ClientState } from "../state/codexClient";

const SideChatPanel = lazy(async () => {
  const module = await import("../components/SideChatPanel");
  return { default: module.SideChatPanel };
});

type TopicStore = ComponentProps<typeof TopicTranscriptBoundary>["store"];

export interface SideChatPanelViewProps {
  sideChatTabs: SideChatTab[];
  activeSideChatId: string;
  selectedModel: string;
  state: Pick<ClientState, "providers" | "connected" | "engine">;
  topicTranscriptStore: TopicStore;
  composerModels: ModelEntry[];
  selectedReasoning: ReasoningOption | undefined;
  reasoningEffort: string;
  sideChatPermissionLabel: string;
  sideChatError: string | null;
  setActiveSideChatId: Dispatch<SetStateAction<string>>;
  addSideChatTab: () => void;
  closeSideChatTab: (tabId: string) => void;
  closeRightWorkspace: () => void;
  changeSideChatDraft: (tabId: string, draft: string) => void;
  changeSideChatModel: (tabId: string, model: string) => void;
  toggleSideChatWebSearch: (tabId: string) => void;
  attachSideChatFiles: (tabId: string, files: File[]) => Promise<unknown>;
  removeSideChatAttachment: (tabId: string, attachmentId: string) => void;
  createSideChatImage: (tabId: string) => void;
  t: TranslateFn;
  sendSideChatPrompt: (tabId: string, text: string) => Promise<unknown>;
}

export function SideChatPanelView({
  sideChatTabs,
  activeSideChatId,
  selectedModel,
  state,
  topicTranscriptStore,
  composerModels,
  selectedReasoning,
  reasoningEffort,
  sideChatPermissionLabel,
  sideChatError,
  setActiveSideChatId,
  addSideChatTab,
  closeSideChatTab,
  closeRightWorkspace,
  changeSideChatDraft,
  changeSideChatModel,
  toggleSideChatWebSearch,
  attachSideChatFiles,
  removeSideChatAttachment,
  createSideChatImage,
  t,
  sendSideChatPrompt,
}: SideChatPanelViewProps) {

    const activeSideChat = sideChatTabs.find((tab) => tab.id === activeSideChatId) ?? sideChatTabs[0];
    // Fresh tabs show the duck2api default they will send with.
    const sideChatDisplayModel = resolveSideChatTabModel(
      activeSideChat?.modelOverride,
      selectedModel,
      Boolean(activeSideChat?.threadId),
      state.providers
    );
    return (
      <TopicTranscriptBoundary store={topicTranscriptStore} topicId={activeSideChat?.threadId ?? null}>
        {(projection: PanelTranscriptProjection) => (
      <SideChatPanel
        tabs={sideChatTabs}
        activeTabId={activeSideChatId}
        turns={activeSideChat?.threadId ? projection.turnsByThreadId.get(activeSideChat.threadId) ?? [] : []}
        models={composerModels}
        selectedModel={sideChatDisplayModel}
        sideModels={sideChatModelOptions(state.providers)}
        tabModel={sideChatDisplayModel}
        reasoningLabel={selectedReasoning?.label ?? reasoningEffort}
        permissionLabel={sideChatPermissionLabel}
        connected={state.connected}
        engineReady={state.engine.phase === "ready"}
        error={sideChatError}
        onTabChange={setActiveSideChatId}
        onAddTab={addSideChatTab}
        onCloseTab={closeSideChatTab}
        onClosePanel={closeRightWorkspace}
        onDraftChange={changeSideChatDraft}
        onModelChange={changeSideChatModel}
        onToggleWebSearch={toggleSideChatWebSearch}
        onAttachFiles={(tabId: string, files: File[]) => void attachSideChatFiles(tabId, files).catch(() => undefined)}
        onRemoveAttachment={removeSideChatAttachment}
        onCreateImage={(tabId: string) => void createSideChatImage(tabId)}
        t={t}
        onSend={(tabId: string, text: string) => void sendSideChatPrompt(tabId, text)}
      />
      )}
      </TopicTranscriptBoundary>
    );
}
