import { Button, Stack, Tooltip } from "@mui/material";
import TuneIcon from "@mui/icons-material/Tune";
import type { Dispatch, MouseEvent as ReactMouseEvent, MutableRefObject, SetStateAction } from "react";
import type { CompactMode, PermissionPresetId, ProviderConfig } from "@codex-ui/shared";
import { TopBarRelayTreeSelector } from "../components/TopBarRelayTreeSelector";
import { ComposerModelSelect } from "../composer/ComposerModelSelect";
import { ComposerQuotaChip } from "../composer/ComposerQuotaChip";
import type { ClineBalanceInfo } from "../state/codexClient";
import { DEFAULT_CLI_BACKEND } from "../app/cli/cliPlugins";
import type { SettingsSectionId } from "../settings/SettingsDrawer";
import type { CodexPluginSettingsTab } from "../components/CodexPluginSettingsPanel";
import type { ThreadRuntimeSelection } from "../app/runtime/useThreadRuntimeSelections";
import type { ClientState, FreebuffSessionStatus, ModelEntry, WorkbenchTurn } from "../state/codexClient";
import type { TranslateFn } from "../i18n";

export interface RuntimeControlSetProps {
  t: TranslateFn;
  activeRunningTurn: WorkbenchTurn | null;
  state: Pick<ClientState, "providers">;
  activeProviderId: string | null;
  activeGroupId: string | null;
  runtimeSelection: ThreadRuntimeSelection;
  selectProviderForCurrentThread: (providerId: string, groupId?: string) => Promise<void>;
  updateImageRuntimeSelection: (patch: Partial<import("../imageRuntime").ImageRuntimeSelection>, threadId?: string) => void;
  setOfficialLoginOpen: Dispatch<SetStateAction<boolean>>;
  openSettings: (section?: SettingsSectionId, pluginTab?: CodexPluginSettingsTab, relayTarget?: { providerId?: string; groupId?: string }) => void;
  selectedModel: string;
  composerModels: ModelEntry[];
  freebuffSession: FreebuffSessionStatus | null;
  setFreebuffSwitchTargetModel: Dispatch<SetStateAction<string>>;
  setFreebuffSwitchDialogOpen: Dispatch<SetStateAction<boolean>>;
  activeThreadIdRef: MutableRefObject<string | null>;
  setSelectedModel: (model: string) => void;
  updateNewConversationRuntimeSelection: (patch: Partial<ThreadRuntimeSelection>) => void;
  clineBalance: ClineBalanceInfo | null;
  refreshFreebuffSession: (token?: string | null) => Promise<FreebuffSessionStatus | null>;
  refreshClineBalance: () => Promise<unknown>;
  handleReleaseFreebuffSlotFromChip: () => Promise<unknown>;
  freebuffAutoFailover: boolean;
  setFreebuffAutoFailover: Dispatch<SetStateAction<boolean>>;
  showReasoningGlow: boolean;
  setRuntimeConfigAnchor: Dispatch<SetStateAction<HTMLElement | null>>;
  setReasoningAnchor: Dispatch<SetStateAction<HTMLElement | null>>;
  selectedReasoningLabel: string;
}

export function RuntimeControlSet(props: RuntimeControlSetProps) {
  const {
    t,
    activeRunningTurn,
    state,
    activeProviderId,
    activeGroupId,
    runtimeSelection,
    selectProviderForCurrentThread,
    updateImageRuntimeSelection,
    setOfficialLoginOpen,
    openSettings,
    selectedModel,
    composerModels,
    freebuffSession,
    setFreebuffSwitchTargetModel,
    setFreebuffSwitchDialogOpen,
    activeThreadIdRef,
    setSelectedModel,
    updateNewConversationRuntimeSelection,
    clineBalance,
    refreshFreebuffSession,
    refreshClineBalance,
    handleReleaseFreebuffSlotFromChip,
    freebuffAutoFailover,
    setFreebuffAutoFailover,
    showReasoningGlow,
    setRuntimeConfigAnchor,
    setReasoningAnchor,
    selectedReasoningLabel,
  } = props;
  return (

    <Tooltip title={activeRunningTurn ? t("app.runtimeChangesNextTurn") : ""} disableHoverListener={!activeRunningTurn}>
      <Stack data-testid="composer-runtime-controls" direction="row" alignItems="center" spacing={0.5} useFlexGap sx={{ width: { xs: "100%", md: "max-content" }, minWidth: 0, flexWrap: "wrap" }}>
        <TopBarRelayTreeSelector
          providers={state.providers}
          activeProviderId={activeProviderId}
          activeGroupId={activeGroupId}
          cliBackend={runtimeSelection.cliBackend ?? DEFAULT_CLI_BACKEND}
          t={t}
          onActivateProvider={(providerId: string) => selectProviderForCurrentThread(providerId)}
          onSelectGroup={(providerId: string, groupId: string) => selectProviderForCurrentThread(providerId, groupId)}
          onSelectImageGroup={(providerId: string, groupId: string, model: string) => updateImageRuntimeSelection({ providerId, groupId, model })}
          onOpenOfficialLogin={() => setOfficialLoginOpen(true)}
          onOpenCreateRelay={() => openSettings("relay")}
          onSelectOfficialAgy={() => selectProviderForCurrentThread("agy-official", undefined)}
          onSelectOfficialGrok={() => selectProviderForCurrentThread("grok-official", undefined)}
          onSelectAgyLaunch={() => selectProviderForCurrentThread("agy-launch", "default")}
        />
        <ComposerModelSelect
          selectedModel={selectedModel}
          models={composerModels}
          activeGroupId={activeGroupId}
          freebuffSession={freebuffSession}
          t={t}
          onChange={(model: string) => {
            if (activeGroupId === "freebuff" && freebuffSession?.active && freebuffSession.model && model !== freebuffSession.model) {
              setFreebuffSwitchTargetModel(model);
              setFreebuffSwitchDialogOpen(true);
              return;
            }
            if (activeThreadIdRef.current) setSelectedModel(model);
            else updateNewConversationRuntimeSelection({ model });
          }}
        />
        <ComposerQuotaChip
          activeGroupId={activeGroupId}
          selectedModel={selectedModel}
          freebuffSession={freebuffSession}
          clineBalance={clineBalance}
          onRefreshFreebuff={refreshFreebuffSession}
          onRefreshCline={refreshClineBalance}
          onReleaseFreebuffSlot={handleReleaseFreebuffSlotFromChip}
          freebuffAutoFailover={freebuffAutoFailover}
          onToggleFreebuffAutoFailover={setFreebuffAutoFailover}
        />
        <Button
          size="small"
          variant={showReasoningGlow ? "contained" : "outlined"}
          startIcon={<TuneIcon />}
          aria-label={t("app.reasoningStrength")}
          data-testid="composer-reasoning-button"
          onClick={(event: ReactMouseEvent<HTMLButtonElement>) => {
            setRuntimeConfigAnchor(null);
            setReasoningAnchor(event.currentTarget);
          }}
          sx={{ height: 32, minWidth: 98, px: 1, whiteSpace: "nowrap" }}
        >
          {selectedReasoningLabel}
        </Button>
      </Stack>
    </Tooltip>
  
  );
}
