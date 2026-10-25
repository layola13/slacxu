import { useCallback, useRef, useState, type Dispatch, type SetStateAction } from "react";
import type { ProviderConfig } from "@codex-ui/shared";
import type { SideChatTab } from "../../components/SideChatPanel";
import type { RightWorkspaceTab } from "../../components/RightWorkspacePanel";
import { generateProviderImage, type ComposerImageAttachment } from "../../state/codexClient";
import { applySideChatDuckDefault } from "../sidechat/sideChatDuckDefaults";
import type { ThreadRuntimeSelection } from "../runtime/useThreadRuntimeSelections";

export function useSideChatTabs(input: {
  token: string | null;
  activeWorkspaceCwd: string;
  providers: ProviderConfig[];
  activeProviderId: string | null;
  activeGroupId: string | null;
  selectedModel: string;
  selectionForThread: (threadId: string | null | undefined) => ThreadRuntimeSelection;
  setRightWorkspaceTab: Dispatch<SetStateAction<RightWorkspaceTab>>;
  setRightWorkspaceVisible: Dispatch<SetStateAction<boolean>>;
}) {
  const {
    token,
    activeWorkspaceCwd,
    providers,
    activeProviderId,
    activeGroupId,
    selectedModel,
    selectionForThread,
    setRightWorkspaceTab,
    setRightWorkspaceVisible,
  } = input;
  const state = { token, providers };
  const [sideChatTabs, setSideChatTabs] = useState<SideChatTab[]>(() => [
    {
      id: "sidechat-1",
      title: "Side chat",
      threadId: null,
      draft: "",
      sending: false,
      userMessages: []
    }
  ]);
  const [activeSideChatId, setActiveSideChatId] = useState("sidechat-1");
  const [sideChatError, setSideChatError] = useState<string | null>(null);
  const sideChatSequenceRef = useRef(2);
  const sideChatInFlightRef = useRef(new Set<string>());

  const addSideChatTab = useCallback(() => {
    const nextIndex = sideChatSequenceRef.current;
    sideChatSequenceRef.current += 1;
    const nextTab: SideChatTab = {
      id: `sidechat-${nextIndex}`,
      title: `Side chat ${nextIndex}`,
      threadId: null,
      draft: "",
      sending: false,
      userMessages: []
    };
    setSideChatTabs((current: SideChatTab[]) => [...current, nextTab]);
    setActiveSideChatId(nextTab.id);
    setRightWorkspaceTab("sidechat");
    setRightWorkspaceVisible(true);
  }, []);

  const closeSideChatTab = useCallback((tabId: string) => {
    setSideChatTabs((current: SideChatTab[]) => {
      if (current.length <= 1) {
        sideChatInFlightRef.current.delete(tabId);
        return current.map((tab: SideChatTab) => (tab.id === tabId ? { ...tab, threadId: null, draft: "", sending: false, userMessages: [] } : tab));
      }
      const next = current.filter((tab: SideChatTab) => tab.id !== tabId);
      sideChatInFlightRef.current.delete(tabId);
      setActiveSideChatId((active: string) => (active === tabId ? next[Math.max(0, current.findIndex((tab: SideChatTab) => tab.id === tabId) - 1)]?.id ?? next[0]?.id ?? active : active));
      return next;
    });
  }, []);

  const changeSideChatDraft = useCallback((tabId: string, draft: string) => {
    setSideChatTabs((current: SideChatTab[]) => current.map((tab: SideChatTab) => (tab.id === tabId ? { ...tab, draft } : tab)));
  }, []);

  // Per-tab model override; applies on the next send (send path persists it).
  const changeSideChatModel = useCallback((tabId: string, model: string) => {
    const next = model.trim();
    setSideChatTabs((current: SideChatTab[]) => current.map((tab: SideChatTab) => (tab.id === tabId ? { ...tab, modelOverride: next || null } : tab)));
  }, []);

  const toggleSideChatWebSearch = useCallback((tabId: string) => {
    setSideChatTabs((current: SideChatTab[]) => current.map((tab: SideChatTab) => (tab.id === tabId ? { ...tab, webSearch: !tab.webSearch } : tab)));
  }, []);

  const removeSideChatAttachment = useCallback((tabId: string, attachmentId: string) => {
    setSideChatTabs((current: SideChatTab[]) => current.map((tab: SideChatTab) => {
      if (tab.id !== tabId) return tab;
      const remaining = (tab.attachments ?? []).filter((entry) => entry.id !== attachmentId);
      return { ...tab, attachments: remaining };
    }));
  }, []);

  const attachSideChatFiles = useCallback(async (tabId: string, files: File[]) => {
    if (files.length === 0) return;
    const token = state.token;
    const cwd = activeWorkspaceCwd;
    const uploaded: ComposerImageAttachment[] = [];
    for (const file of files) {
      const mediaType = file.type || "application/octet-stream";
      const isImage = mediaType.startsWith("image/");
      let path: string | undefined;
      if (token) {
        const form = new FormData();
        form.set("file", file);
        form.set("cwd", cwd);
        const response = await fetch("/api/attachments/upload", {
          method: "POST",
          headers: { "x-codex-ui-token": token },
          body: form
        });
        if (!response.ok) {
          throw new Error(`Attachment upload failed (${response.status})`);
        }
        const body = await response.json().catch(() => ({})) as { path?: string };
        path = body.path;
      }
      uploaded.push({
        id: typeof crypto.randomUUID === "function" ? crypto.randomUUID() : `${file.name}-${Date.now()}-${Math.random()}`,
        name: file.name,
        url: path ?? "",
        size: file.size,
        mediaType,
        kind: isImage ? "image" : "file",
        path
      });
    }
    setSideChatTabs((current: SideChatTab[]) => current.map((tab: SideChatTab) => (
      tab.id === tabId ? { ...tab, attachments: [...(tab.attachments ?? []), ...uploaded] } : tab
    )));
  }, [state.token, activeWorkspaceCwd]);

  const createSideChatImage = useCallback(async (tabId: string) => {
    const tab = sideChatTabs.find((entry: SideChatTab) => entry.id === tabId);
    if (!tab) return;
    const prompt = tab.draft.trim();
    if (!prompt || tab.imageBusy) return;
    const token = state.token;
    if (!token) return;
    setSideChatTabs((current: SideChatTab[]) => current.map((entry: SideChatTab) => (entry.id === tabId ? { ...entry, imageBusy: true } : entry)));
    try {
      const baseSelection = tab.threadId ? selectionForThread(tab.threadId) : selectionForThread(null);
      const duckSelected = tab.threadId ? baseSelection : applySideChatDuckDefault(baseSelection, state.providers);
      const providerId = duckSelected.providerId ?? activeProviderId ?? "";
      const groupId = duckSelected.groupId ?? activeGroupId ?? "";
      const model = (tab.modelOverride?.trim() ? tab.modelOverride.trim() : null) ?? duckSelected.model ?? selectedModel;
      const result = await generateProviderImage(token, {
        providerId, groupId, prompt, model,
        requestId: `sidechat-${tabId}-${Date.now()}`
      });
      const images = (result.data ?? []).map((entry, index) => ({
        id: `sidechat-img-${Date.now()}-${index}`,
        url: entry.url ?? entry.savedPath ?? (entry.b64Json ? `data:${entry.mediaType ?? "image/png"};base64,${entry.b64Json}` : ""),
        prompt
      })).filter((entry) => Boolean(entry.url));
      setSideChatTabs((current: SideChatTab[]) => current.map((entry: SideChatTab) => (
        entry.id === tabId ? { ...entry, imageBusy: false, generatedImages: [...(entry.generatedImages ?? []), ...images] } : entry
      )));
    } catch {
      setSideChatTabs((current: SideChatTab[]) => current.map((entry: SideChatTab) => (entry.id === tabId ? { ...entry, imageBusy: false } : entry)));
    }
  }, [sideChatTabs, state.providers, state.token, activeProviderId, activeGroupId, selectedModel, selectionForThread]);
  return {
    sideChatTabs,
    setSideChatTabs,
    activeSideChatId,
    setActiveSideChatId,
    sideChatError,
    setSideChatError,
    sideChatSequenceRef,
    sideChatInFlightRef,
    addSideChatTab,
    closeSideChatTab,
    changeSideChatDraft,
    changeSideChatModel,
    toggleSideChatWebSearch,
    removeSideChatAttachment,
    attachSideChatFiles,
    createSideChatImage,
  };
}
