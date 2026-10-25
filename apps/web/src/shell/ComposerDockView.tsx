import { Alert, Box, Button, IconButton, Tooltip, alpha } from "@mui/material";
import CloudQueueIcon from "@mui/icons-material/CloudQueue";
import TuneIcon from "@mui/icons-material/Tune";
import type { ComponentProps, Dispatch, MouseEvent as ReactMouseEvent, PointerEvent as ReactPointerEvent, ReactNode, RefObject, SetStateAction } from "react";
import type { PermissionPresetId, SaVmPolicyConfig } from "@codex-ui/shared";
import { DEFAULT_CONTEXT_WINDOW_TOKENS, resolveDisplayedContextWindow } from "../contextUsage";
import { createDefaultSaVmPolicyConfig, hasEnhanceToolsEnabled } from "@codex-ui/shared";
import { releaseFreebuffSessionSlot, syncSaVmWorkspaceSkill, type FreebuffSessionStatus } from "../state/codexClient";
import { saveWorkspaceVmPolicy } from "../utils/recentWorkspaces";
import { loadJevConfig } from "../../../../frontends/jev/src/jev/jevConfig";
import type { SlashCommandNotice } from "../app/workbench/appConstants";
import { Composer, type ComposerWorkingStatus } from "../composer/Composer";
import type { TranslateFn } from "../i18n";
import type { ThreadRuntimeSelection } from "../app/runtime/useThreadRuntimeSelections";
import type { ImageRuntimeSelection } from "../imageRuntime";
import type { ClientState, ThreadEntry, WorkbenchTurn } from "../state/codexClient";
import type { ThreadTokenUsageState } from "../components/ChatPanel";
import type { SocketConnectionStatus } from "../state/codexClient";
import { stripModelContextVariant } from "@codex-ui/shared";
import type { WorkbenchModeState } from "../components/ChatPanel";
import type { SettingsSectionId } from "../settings/SettingsDrawer";
import type { CodexPluginSettingsTab } from "../components/CodexPluginSettingsPanel";

type ComposerProps = ComponentProps<typeof Composer>;

export interface ComposerDockViewProps {
  official: boolean;
  showThemePet: boolean;
  petImage: string | undefined;
  themeTuning: { panelSurfaceOpacity: number };
  immersiveComposerDockRef: RefObject<HTMLDivElement | null>;
  immersiveView: boolean;
  isMobile: boolean;
  beginImmersiveComposerDrag: (event: ReactPointerEvent<HTMLDivElement>) => void;
  reactivateThreadSubscription: () => void;
  moveImmersiveComposer: (event: ReactPointerEvent<HTMLDivElement>) => void;
  endImmersiveComposerDrag: (event: ReactPointerEvent<HTMLDivElement>) => void;
  immersiveComposerCompact: boolean;
  freebuffFallbackSuggestion: { currentModel: string; suggestedModel: { id: string; name: string; price: number }; reason: string } | null;
  setFreebuffFallbackSuggestion: Dispatch<SetStateAction<{ currentModel: string; suggestedModel: { id: string; name: string; price: number }; reason: string } | null>>;
  state: ClientState;
  activeThreadIdRef: RefObject<string | null>;
  setSelectedModel: (model: string) => void;
  updateNewConversationRuntimeSelection: (patch: Partial<ThreadRuntimeSelection>) => void;
  refreshFreebuffSession: (token?: string | null) => Promise<FreebuffSessionStatus | null>;
  setSlashNotice: Dispatch<SetStateAction<SlashCommandNotice | null>>;
  activeWorkspaceCwd: string;
  activeProviderLabel: string;
  composerBackendName: string;
  selectedModel: string;
  setRuntimeConfigAnchor: Dispatch<SetStateAction<HTMLElement | null>>;
  activeConversationReadOnly: boolean;
  t: TranslateFn;
  openWorkspacePicker: (purpose?: "primary" | "additional") => void;
  activeWorkspaceAdditionalRoots: string[];
  additionalRoots: string[];
  setAdditionalRoots: Dispatch<SetStateAction<string[]>>;
  persistWorkspaceForActiveThread: (nextCwd: string, nextRoots: string[], nextWorkspaceFilePath?: string | null) => void;
  permission: PermissionPresetId;
  composerConnected: boolean;
  connectionStatus: SocketConnectionStatus;
  connectionNotice: string;
  pendingMention: ComposerProps["pendingMention"];
  composerSuggestion: ComposerProps["suggestedPrompt"];
  activeThemePlugin: ComposerProps["activeThemePlugin"];
  composerBackgroundImage: ComposerProps["backgroundImage"];
  modeState: WorkbenchModeState;
  dangerBypassPermissionConfirmed: boolean;
  conversationWorking: boolean;
  composerWorkingStatus: ComposerWorkingStatus | null;
  conversationStatus: ComposerProps["statusKind"];
  conversationStatusLabel: string;
  composerBackgroundControl: ReactNode;
  desktopLayout: boolean;
  runtimeControlSet: ReactNode;
  setImmersiveComposerCompact: Dispatch<SetStateAction<boolean>>;
  resetImmersiveComposerOffset: () => void;
  setImmersiveComposerHintOpen: Dispatch<SetStateAction<boolean>>;
  imageChannels: NonNullable<ComposerProps["imageChannels"]>;
  imageRuntimeSelection: ImageRuntimeSelection;
  updateImageRuntimeSelection: (patch: { providerId: string; groupId: string; model: string }) => void;
  activeComposerThreadUsage: ThreadTokenUsageState | null | undefined;
  threadTokenUsage: Record<string, ThreadTokenUsageState>;
  displayedThreadContextWindow: number | null | undefined;
  configuredContextWindow: number | null | undefined;
  displayedContextGroup: { contextWindow?: number } | null | undefined;
  displayedContextModel: string;
  composerCliBackendAction: ReactNode;
  composerFreeSavingsAction: ReactNode;
  composerAgentsAction: ReactNode;
  composerGitBranch: string | null;
  composerGitDirtyCount: number;
  reviewWaterfallFileChanges: () => void;
  vmEnabled: boolean;
  runtimeSelection: ThreadRuntimeSelection;
  updateRuntimeSelection: (patch: Partial<ThreadRuntimeSelection>) => void;
  selectionForThread: (threadId: string) => ThreadRuntimeSelection;
  persistThreadRuntimeSelection: (selection: ThreadRuntimeSelection & { threadId: string }) => Promise<void>;
  saveWorkspaceVmPolicy: (cwd: string, enabled: boolean, policy: SaVmPolicyConfig) => void;
  loadTooling: (options?: { forceSkillReload?: boolean }) => Promise<unknown>;
  allowedPermissions: PermissionPresetId[];
  requestPermissionChange: ComposerProps["onPermissionChange"];
  activeRunningTurn: WorkbenchTurn | null;
  stopActiveTurn: () => Promise<void>;
  handleRelayShareText: ComposerProps["onRelayShareDetected"];
  mainThreads: ThreadEntry[];
  openSettings: (section?: SettingsSectionId, pluginTab?: CodexPluginSettingsTab, relayTarget?: { providerId?: string; groupId?: string }) => void;
  setPendingMention: Dispatch<SetStateAction<ComposerProps["pendingMention"]>>;
  setWelcomeDismissed: Dispatch<SetStateAction<boolean>>;
  setComposerSuggestion: Dispatch<SetStateAction<{ id: string; text: string } | null>>;
  planModeEnabled: boolean;
  sendPrompt: ComposerProps["onSend"];
  steerPrompt: ComposerProps["onSteer"];
  cwd: string;
}

export function ComposerDockView({
  official,
  showThemePet,
  petImage,
  themeTuning,
  immersiveComposerDockRef,
  immersiveView,
  isMobile,
  beginImmersiveComposerDrag,
  reactivateThreadSubscription,
  moveImmersiveComposer,
  endImmersiveComposerDrag,
  immersiveComposerCompact,
  freebuffFallbackSuggestion,
  setFreebuffFallbackSuggestion,
  state,
  activeThreadIdRef,
  setSelectedModel,
  updateNewConversationRuntimeSelection,
  refreshFreebuffSession,
  setSlashNotice,
  activeWorkspaceCwd,
  activeProviderLabel,
  composerBackendName,
  selectedModel,
  setRuntimeConfigAnchor,
  activeConversationReadOnly,
  t,
  openWorkspacePicker,
  activeWorkspaceAdditionalRoots,
  additionalRoots,
  setAdditionalRoots,
  persistWorkspaceForActiveThread,
  permission,
  composerConnected,
  connectionStatus,
  connectionNotice,
  pendingMention,
  composerSuggestion,
  activeThemePlugin,
  composerBackgroundImage,
  modeState,
  dangerBypassPermissionConfirmed,
  conversationWorking,
  composerWorkingStatus,
  conversationStatus,
  conversationStatusLabel,
  composerBackgroundControl,
  desktopLayout,
  runtimeControlSet,
  setImmersiveComposerCompact,
  resetImmersiveComposerOffset,
  setImmersiveComposerHintOpen,
  imageChannels,
  imageRuntimeSelection,
  updateImageRuntimeSelection,
  activeComposerThreadUsage,
  threadTokenUsage,
  displayedThreadContextWindow,
  configuredContextWindow,
  displayedContextGroup,
  displayedContextModel,
  composerCliBackendAction,
  composerFreeSavingsAction,
  composerAgentsAction,
  composerGitBranch,
  composerGitDirtyCount,
  reviewWaterfallFileChanges,
  vmEnabled,
  runtimeSelection,
  updateRuntimeSelection,
  selectionForThread,
  persistThreadRuntimeSelection,
  saveWorkspaceVmPolicy,
  loadTooling,
  allowedPermissions,
  requestPermissionChange,
  activeRunningTurn,
  stopActiveTurn,
  handleRelayShareText,
  mainThreads,
  openSettings,
  setPendingMention,
  setWelcomeDismissed,
  setComposerSuggestion,
  planModeEnabled,
  sendPrompt,
  steerPrompt,
  cwd,
}: ComposerDockViewProps) {

    return (
      <>
        {showThemePet && (
          <Box
            data-testid="theme-pet-dock"
            sx={{
              position: "absolute",
              right: { xs: 14, sm: 22 },
              bottom: { xs: 220, sm: 246 },
              width: { xs: 74, sm: 104 },
              aspectRatio: "1 / 1",
              borderRadius: 2,
              overflow: "hidden",
              border: "1px solid",
              borderColor: "divider",
              bgcolor: (theme) => alpha(theme.palette.background.paper, themeTuning.panelSurfaceOpacity),
              boxShadow: (theme) => theme.customShadows?.z8,
              pointerEvents: "none",
              display: { xs: "none", sm: "block" },
              zIndex: 2
            }}
          >
            <Box component="img" src={petImage ?? ""} alt="" sx={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} />
          </Box>
        )}
        <Box
          ref={immersiveComposerDockRef}
          className={official ? "chatgpt-composer-dock" : undefined}
          data-testid="composer-dock"
          data-immersive={immersiveView ? "true" : "false"}
          data-dragging="false"
          onPointerDown={beginImmersiveComposerDrag}
          onFocus={reactivateThreadSubscription}
          onPointerMove={moveImmersiveComposer}
          onPointerUp={endImmersiveComposerDrag}
          onPointerCancel={endImmersiveComposerDrag}
          onLostPointerCapture={endImmersiveComposerDrag}
          sx={{
            position: immersiveView ? "absolute" : isMobile ? "relative" : "sticky",
            left: immersiveView ? "50%" : "auto",
            bottom: immersiveView ? { xs: 8, sm: 14 } : 0,
            width: immersiveView ? { xs: "calc(100% - 16px)", sm: "calc(100% - 36px)" } : "100%",
            maxWidth: immersiveView ? 920 : "none",
            minWidth: 0,
            boxSizing: "border-box",
            transform: immersiveView
              ? "translate(calc(-50% + var(--immersive-composer-offset-x, 0px)), var(--immersive-composer-offset-y, 0px))"
              : "none",
            zIndex: 7,
            flex: "0 0 auto",
            border: immersiveView ? "1px solid" : 0,
            borderTop: "1px solid",
            borderColor: "divider",
            borderRadius: immersiveView ? 3 : 0,
            overflow: "hidden",
            bgcolor: (theme) => alpha(theme.palette.background.paper, isMobile ? (theme.palette.mode === "dark" ? 0.98 : 1) : immersiveView ? Math.max(0.94, themeTuning.panelSurfaceOpacity) : themeTuning.panelSurfaceOpacity),
            boxShadow: immersiveView ? "0 18px 54px rgba(0,0,0,.24)" : "none",
            cursor: immersiveView && immersiveComposerCompact ? "grab" : "default",
            touchAction: immersiveView && immersiveComposerCompact ? "none" : "auto",
            pb: isMobile ? "max(6px, env(safe-area-inset-bottom))" : 0,
            transition: "width 260ms cubic-bezier(.2,.8,.2,1), left 260ms cubic-bezier(.2,.8,.2,1), bottom 260ms cubic-bezier(.2,.8,.2,1), border-radius 220ms ease, box-shadow 220ms ease",
            "&[data-dragging='true']": { cursor: "grabbing", userSelect: "none" },
            "@media (prefers-reduced-motion: reduce)": { transition: "none" }
          }}
        >
          {freebuffFallbackSuggestion && (
            <Alert
              severity="warning"
              onClose={() => setFreebuffFallbackSuggestion(null)}
              sx={{ borderRadius: 0, py: 0.5, px: 2, alignItems: "center", borderBottom: "1px solid", borderColor: "divider" }}
              action={
                <Button
                  size="small"
                  variant="contained"
                  color="warning"
                  sx={{ textTransform: "none", py: 0.25, px: 1, fontSize: 12, fontWeight: 600 }}
                  onClick={async () => {
                    const target = freebuffFallbackSuggestion.suggestedModel.id;
                    if (state.token) {
                      await releaseFreebuffSessionSlot(state.token).catch(() => undefined);
                    }
                    if (activeThreadIdRef.current) setSelectedModel(target);
                    else updateNewConversationRuntimeSelection({ model: target });
                    setFreebuffFallbackSuggestion(null);
                    await refreshFreebuffSession();
                    setSlashNotice({
                      id: `freebuff-switched-${Date.now()}`,
                      title: "已切换模型",
                      message: `已一键切换至 ${freebuffFallbackSuggestion.suggestedModel.name}，可继续发送`,
                      severity: "info"
                    });
                  }}
                >
                  一键切换至 {freebuffFallbackSuggestion.suggestedModel.name} ({freebuffFallbackSuggestion.suggestedModel.price} FB)
                </Button>
              }
            >
              {freebuffFallbackSuggestion.reason}，建议切换至更轻量或限免模型继续：
            </Alert>
          )}
          <Composer
            backendName={composerBackendName}
            cwd={activeWorkspaceCwd}
            mobileLayout={isMobile}
            mobileRelayAction={
              <Tooltip title={`${activeProviderLabel} · ${selectedModel || t("app.model")}`}>
                <span>
                  <IconButton
                    size="small"
                    data-testid="composer-mobile-relay-button"
                    aria-label="relay-settings"
                    disabled={activeConversationReadOnly}
                    onClick={(event: ReactMouseEvent<HTMLButtonElement>) => setRuntimeConfigAnchor(event.currentTarget)}
                    sx={{ width: 32, height: 32, flex: "0 0 32px", border: "1px solid", borderColor: "divider", bgcolor: "background.paper", color: "text.secondary" }}
                  >
                    <CloudQueueIcon fontSize="small" />
                  </IconButton>
                </span>
              </Tooltip>
            }
            additionalRoots={activeWorkspaceAdditionalRoots}
            onAddAdditionalRoot={() => openWorkspacePicker("additional")}
            onRemoveAdditionalRoot={(root: string) => {
              const next = additionalRoots.filter((entry) => entry !== root);
              setAdditionalRoots(next);
              persistWorkspaceForActiveThread(activeWorkspaceCwd, next);
            }}
            permission={permission}
            disabled={activeConversationReadOnly}
            sendBlockedReason={
              activeConversationReadOnly
                ? t("notifications.writerConflict.message")
                : !composerConnected
                  ? connectionStatus.phase !== "connected"
                    ? connectionNotice
                    : t("engine.notReady")
                  : undefined
            }
            sessionToken={state.token}
            pendingMention={pendingMention}
            suggestedPrompt={composerSuggestion}
            activeThemePlugin={activeThemePlugin}
            backgroundImage={composerBackgroundImage}
            t={t}
            modeBadges={modeState}
            dangerBypassConfirmed={dangerBypassPermissionConfirmed}
            permissionScopeLabel={state.activeThreadId ? t("composer.currentConversationPermission") : t("composer.newConversationPermission")}
            running={conversationWorking}
            workingStatus={composerWorkingStatus}
            statusKind={conversationStatus}
            statusLabel={conversationStatusLabel}
            runtimeControls={
              <>
                {composerBackgroundControl}
                {desktopLayout ? runtimeControlSet : (
                  <Button
                    size="small"
                    variant="outlined"
                    startIcon={<TuneIcon />}
                    data-testid="composer-runtime-menu-button"
                    onClick={(event: ReactMouseEvent<HTMLButtonElement>) => setRuntimeConfigAnchor(event.currentTarget)}
                    sx={{ height: 32, maxWidth: 240, justifyContent: "flex-start" }}
                  >
                    {activeProviderLabel} · {selectedModel || t("app.model")}
                  </Button>
                )}
              </>
            }
            compact={immersiveView && immersiveComposerCompact}
            onToggleCompact={immersiveView ? () => setImmersiveComposerCompact((current) => {
              if (current) {
                resetImmersiveComposerOffset();
                setImmersiveComposerHintOpen(false);
              }
              return !current;
            }) : undefined}
            imageChannels={imageChannels}
            selectedImageChannel={imageRuntimeSelection.providerId && imageRuntimeSelection.groupId
              ? `${imageRuntimeSelection.providerId}:${imageRuntimeSelection.groupId}`
              : imageChannels[0] ? `${imageChannels[0].providerId}:${imageChannels[0].groupId}` : ""}
            onImageChannelChange={(providerId: string, groupId: string, model: string) => updateImageRuntimeSelection({ providerId, groupId, model })}
            contextUsage={state.activeThreadId ? {
              usedTokens: ((activeComposerThreadUsage ?? threadTokenUsage[state.activeThreadId])?.contextUsage
                ?? (activeComposerThreadUsage ?? threadTokenUsage[state.activeThreadId])?.last)?.totalTokens ?? 0,
              contextWindow: resolveDisplayedContextWindow(
                activeComposerThreadUsage?.modelContextWindow ?? threadTokenUsage[state.activeThreadId]?.modelContextWindow,
                displayedThreadContextWindow ?? configuredContextWindow,
                displayedContextGroup?.contextWindow,
                stripModelContextVariant(displayedContextModel).contextWindow
              ) ?? DEFAULT_CONTEXT_WINDOW_TOKENS
            } : null}
             contextTrailingAction={<>{composerCliBackendAction}{composerFreeSavingsAction}{composerAgentsAction}</>}
            gitBranch={composerGitBranch}
            gitDirtyCount={composerGitDirtyCount}
            onOpenGit={reviewWaterfallFileChanges}
             vmEnabled={vmEnabled}
             vmPolicy={runtimeSelection.vmPolicy}
              onVmEnabledChange={(enabled: boolean) => {
                updateRuntimeSelection({
                  vmEnabled: enabled,
                  ...(enabled && !runtimeSelection.vmPolicy ? { vmPolicy: createDefaultSaVmPolicyConfig() } : {})
                });
              }}
              onVmPolicyChange={(policy: SaVmPolicyConfig) => updateRuntimeSelection({ vmPolicy: policy })}
              onVmSave={async ({ enabled, policy, cwd: saveCwd }: { enabled: boolean; policy: SaVmPolicyConfig; cwd?: string }) => {
                const activeThread = state.activeThreadId;
                const targetCwd = saveCwd || activeWorkspaceCwd || cwd;
                updateRuntimeSelection({
                  vmEnabled: enabled,
                  vmPolicy: policy
                });
                if (targetCwd) {
                  saveWorkspaceVmPolicy(targetCwd, enabled, policy);
                }
                if (activeThread) {
                  await persistThreadRuntimeSelection({
                    ...selectionForThread(activeThread),
                    threadId: activeThread,
                    vmEnabled: enabled,
                    vmPolicy: policy,
                    ...(targetCwd ? { cwd: targetCwd } : {})
                  });
                } else {
                  updateNewConversationRuntimeSelection({
                    vmEnabled: enabled,
                    vmPolicy: policy
                  });
                }
                if (state.token && targetCwd) {
                  try {
                    await syncSaVmWorkspaceSkill(state.token, {
                      cwd: targetCwd,
                      enabled: Boolean(enabled || hasEnhanceToolsEnabled(policy.tools)),
                      threadId: activeThread,
                      salaRoot: policy.fs?.salaRoot,
                      policy,
                      jevActiveTools: loadJevConfig().allowActiveTools
                    });
                    await loadTooling({ forceSkillReload: true });
                  } catch (error) {
                    console.error("[sa-vm] failed to sync workspace skill on save", error);
                  }
                }
              }}
            allowedPermissions={allowedPermissions}
            onPermissionChange={requestPermissionChange}
            onStop={activeRunningTurn ? () => void stopActiveTurn() : undefined}
            onRelayShareDetected={handleRelayShareText}
            threads={mainThreads}
            skills={state.tooling.skillGroups.flatMap((group) => group.skills).filter((skill) => skill.enabled)}
            apps={state.tooling.apps.filter((app) => app.isAccessible !== false && app.isEnabled !== false)}
            onOpenApps={() => openSettings("plugins", "apps")}
            onMentionConsumed={() => setPendingMention(null)}
            onUserActivity={() => setWelcomeDismissed(true)}
            onSuggestedPromptConsumed={() => setComposerSuggestion(null)}
            onTogglePlanMode={() => updateRuntimeSelection({ planModeEnabled: !planModeEnabled })}
            onSend={sendPrompt}
            onSteer={steerPrompt}
            activeThreadId={state.activeThreadId ?? null}
          />
        </Box>
      </>
    );
}
