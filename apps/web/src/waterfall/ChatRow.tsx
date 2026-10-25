import { memo, useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { Alert, Box, Button, Chip, CircularProgress, Dialog, DialogContent, IconButton, LinearProgress, Menu, MenuItem, Paper, Stack, TextField, Tooltip, Typography } from "@mui/material";
import { alpha } from "@mui/material/styles";
import ChecklistIcon from "@mui/icons-material/Checklist";
import CompressIcon from "@mui/icons-material/Compress";
import CenterFocusStrongIcon from "@mui/icons-material/CenterFocusStrong";
import CloseIcon from "@mui/icons-material/Close";
import DownloadIcon from "@mui/icons-material/Download";
import ImageIcon from "@mui/icons-material/Image";
import InsertDriveFileIcon from "@mui/icons-material/InsertDriveFile";
import HelpOutlineIcon from "@mui/icons-material/HelpOutline";
import OpenInNewIcon from "@mui/icons-material/OpenInNew";
import SideNavigationIcon from "@mui/icons-material/VerticalSplit";
import WebIcon from "@mui/icons-material/Web";
import PersonIcon from "@mui/icons-material/Person";
import AttachMoneyIcon from "@mui/icons-material/AttachMoney";
import SmartToyIcon from "@mui/icons-material/SmartToy";
import UnfoldLessIcon from "@mui/icons-material/UnfoldLess";
import UnfoldMoreIcon from "@mui/icons-material/UnfoldMore";
import ZoomInIcon from "@mui/icons-material/ZoomIn";
import ZoomOutIcon from "@mui/icons-material/ZoomOut";
import type { TranslateFn } from "../i18n";
import { MarkdownMessage } from "../components/MarkdownMessage";
import { GitFileDiffView, UnifiedDiffBlock, diffLineStats, diffTextStats, fileChangeStatsLabel } from "./ChatDiffView";
import type { AssistantUsageDisplayMode, ChatWaterfallRow } from "./types";
import type { WebPreviewMode, WebPreviewState } from "../webPreview";
// SA-VM is Muse's execution engine: its tool-activity model lives in
// the Muse frontend plugin (cross-plugin staging edge).
import { isSaVmToolPayload, saVmToolActivity, unwrapToolArgs } from "../../../../frontends/muse/src/saVmChatActivity";
import { isPerformancePressured, prefersReducedMotion } from "../performance/animationBudget";
// Phase 5: compaction branding resolves through the backend plugins'
// declared waterfall mappings (host catalog), never a local if-chain.
import { waterfallCompactionLabel } from "../app/cli/pluginCatalog";

type Props = {
  row: ChatWaterfallRow;
  t: TranslateFn;
  expanded?: boolean;
  onToggleExpanded?: () => void;
  assistantUsageDisplay?: AssistantUsageDisplayMode;
  onOpenPreview?: (url: string, mode: WebPreviewMode) => void;
  webPreview?: WebPreviewState | null;
  onClosePreview?: () => void;
  sessionToken?: string | null;
  editing?: boolean;
  editText?: string;
  editSubmitting?: boolean;
  onEditTextChange?: (text: string) => void;
  onEditSubmit?: () => void;
  onEditCancel?: () => void;
  onOpenCommandBlacklistSettings?: (providerId?: string, groupId?: string) => void;
  variant?: "workbench" | "official";
  onUndoFileChanges?: (rows: ChatWaterfallRow[]) => void;
  onReviewFileChanges?: (rows: ChatWaterfallRow[]) => void;
};

export const ChatRow = memo(function ChatRow({ row, t, expanded: controlledExpanded, onToggleExpanded: controlledToggleExpanded, assistantUsageDisplay = "summary", onOpenPreview, webPreview, onClosePreview, sessionToken, editing = false, editText = "", editSubmitting = false, onEditTextChange, onEditSubmit, onEditCancel, onOpenCommandBlacklistSettings, variant = "workbench", onUndoFileChanges, onReviewFileChanges }: Props) {
  const [localExpanded, setLocalExpanded] = useState(false);
  const expanded = controlledExpanded ?? localExpanded;
  const onToggleExpanded = controlledToggleExpanded ?? (() => setLocalExpanded((current) => !current));
  switch (row.kind) {
    case "userMessage":
      return <UserMessageRow row={row} t={t} sessionToken={sessionToken} editing={editing} editText={editText} editSubmitting={editSubmitting} onEditTextChange={onEditTextChange} onEditSubmit={onEditSubmit} onEditCancel={onEditCancel} variant={variant} />;
    case "assistantMessage":
      return <AssistantMessageRow row={row} t={t} sessionToken={sessionToken} expanded={expanded} onToggleExpanded={onToggleExpanded} assistantUsageDisplay={assistantUsageDisplay} onOpenPreview={onOpenPreview} webPreview={webPreview} onClosePreview={onClosePreview} variant={variant} />;
    case "plan":
      return <PlanRow row={row} variant={variant} />;
    case "reasoningPreview":
      return <ReasoningPreviewRow row={row} t={t} expanded={expanded} onToggleExpanded={onToggleExpanded} variant={variant} />;
    case "commandExecution":
      return <CommandExecutionRow row={row} expanded={expanded} onToggleExpanded={onToggleExpanded} variant={variant} />;
    case "commandGroup":
      return <CommandGroupRow row={row} expanded={expanded} onToggleExpanded={onToggleExpanded} variant={variant} />;
    case "fileChange":
      return <FileChangeRow row={row} expanded={expanded} onToggleExpanded={onToggleExpanded} variant={variant} />;
    case "fileChangeGroup":
      return <FileChangeGroupRow row={row} expanded={expanded} onToggleExpanded={onToggleExpanded} variant={variant} onUndoFileChanges={onUndoFileChanges} onReviewFileChanges={onReviewFileChanges} />;
    case "imageGeneration":
      return row.item.images?.[0] && !isRenderableImageUrl(row.item.images[0].url)
        ? <LocalImageViewRow row={row} t={t} sessionToken={sessionToken} expanded={expanded} onToggleExpanded={onToggleExpanded} title="Generated image" />
        : <ImageGenerationRow row={row} t={t} expanded={expanded} onToggleExpanded={onToggleExpanded} />;
    case "imageView":
      return <LocalImageViewRow row={row} t={t} sessionToken={sessionToken} expanded={expanded} onToggleExpanded={onToggleExpanded} />;
    case "toolCall":
      return <ToolCallRow row={row} sessionToken={sessionToken} expanded={expanded} onToggleExpanded={onToggleExpanded} variant={variant} />;
    case "toolActivityGroup":
      return <ToolActivityGroupRow row={row} t={t} sessionToken={sessionToken} expanded={expanded} onToggleExpanded={onToggleExpanded} variant={variant} />;
    case "retryErrorGroup":
      return <RetryErrorGroupRow row={row} expanded={expanded} onToggleExpanded={onToggleExpanded} variant={variant} />;
    case "contextCompaction":
      return <ContextCompactionRow row={row} t={t} variant={variant} />;
    case "reviewMode":
      return <ReviewModeRow row={row} expanded={expanded} onToggleExpanded={onToggleExpanded} variant={variant} />;
    default:
      return <StatusRow row={row} t={t} onOpenCommandBlacklistSettings={onOpenCommandBlacklistSettings} variant={variant} />;
  }
}, isSameChatRowProps);

export type ChatRowProps = Props;

export function isSameChatRowProps(previous: Props, next: Props): boolean {
  return (
    previous.row === next.row &&
    previous.t === next.t &&
    previous.expanded === next.expanded &&
    previous.assistantUsageDisplay === next.assistantUsageDisplay &&
    Boolean(previous.onOpenPreview) === Boolean(next.onOpenPreview) &&
    previous.webPreview === next.webPreview &&
    Boolean(previous.onClosePreview) === Boolean(next.onClosePreview) &&
    previous.sessionToken === next.sessionToken &&
    Boolean(previous.onOpenCommandBlacklistSettings) === Boolean(next.onOpenCommandBlacklistSettings) &&
    previous.variant === next.variant &&
    Boolean(previous.onUndoFileChanges) === Boolean(next.onUndoFileChanges) &&
    Boolean(previous.onReviewFileChanges) === Boolean(next.onReviewFileChanges) &&
    previous.editing === next.editing &&
    previous.editText === next.editText &&
    previous.editSubmitting === next.editSubmitting
  );
}

function PlanRow({ row, variant }: { row: ChatWaterfallRow; variant?: "workbench" | "official" }) {
  if (variant === "official") {
    return (
      <Box className="chatgpt-plan-row" data-testid={`workbench-item-${sanitizeTestId(row.item.type)}`} sx={{ width: "100%", minWidth: 0 }}>
        <Stack direction="row" alignItems="center" spacing={0.75} sx={{ color: "text.secondary", minWidth: 0 }}>
          <ChecklistIcon fontSize="small" sx={{ color: row.isLive ? "text.secondary" : "text.disabled" }} />
          <Typography variant="body2" sx={{ fontWeight: 650, color: "text.secondary", minWidth: 0 }}>{row.title}</Typography>
        </Stack>
        {row.text ? <Box sx={{ mt: 0.5, color: "text.primary", "& ul": { pl: 2.4, my: 0.5 }, "& li": { my: 0.35 }, "& p": { my: 0.5 } }}><MarkdownMessage text={row.text} /></Box> : null}
      </Box>
    );
  }
  return (
    <AuditRow
      row={row}
      icon={
        <ChecklistIcon
          fontSize="small"
          sx={{
            color: row.isLive ? "primary.main" : "text.secondary"
          }}
        />
      }
    >
      <Box
        sx={{
          mt: 0.75,
          "& ul": { pl: 2.4, my: 0.5 },
          "& li": { my: 0.35 },
          "& p": { my: 0.5 }
        }}
      >
        {row.text ? <MarkdownMessage text={row.text} /> : null}
      </Box>
    </AuditRow>
  );
}

function UserMessageRow({ row, t, sessionToken, editing, editText, editSubmitting, onEditTextChange, onEditSubmit, onEditCancel, variant }: {
  row: ChatWaterfallRow;
  t: TranslateFn;
  sessionToken?: string | null;
  editing: boolean;
  editText: string;
  editSubmitting: boolean;
  onEditTextChange?: (text: string) => void;
  onEditSubmit?: () => void;
  onEditCancel?: () => void;
  variant?: "workbench" | "official";
}) {
  const [messageExpanded, setMessageExpanded] = useState(false);
  const timestamp = formatMessageTimestamp(row.startedAt);
  const visibleText = userMessageDisplayText(row);
  const messagePreview = collapseUserMessageText(visibleText, 10);
  const displayedText = messagePreview.collapsible && !messageExpanded ? messagePreview.preview : visibleText;
  const pendingMode = row.item.payload && typeof row.item.payload === "object" && !Array.isArray(row.item.payload)
    ? row.item.payload.mode
    : undefined;
  return (
    <Box className={variant === "official" ? "chatgpt-user-message" : undefined} sx={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: variant === "official" ? 0.25 : 0.35, minWidth: 0, maxWidth: "100%" }} data-testid={`workbench-item-${sanitizeTestId(row.item.type)}`}>
      {(row.status === "waiting" || pendingMode === "queuedFailed") && (
        <Chip
          data-testid="pending-append-status"
          size="small"
          variant="outlined"
          color={pendingMode === "queuedFailed" ? "error" : "warning"}
          label={pendingMode === "queuedFailed" ? "Queue failed" : pendingMode === "queued" ? "Queued" : t("chat.waiting")}
          sx={{ height: 24, flex: "0 0 auto", fontWeight: 800, borderRadius: 1 }}
        />
      )}
      <Paper
        variant="outlined"
        data-user-message-bubble={variant === "official" ? true : undefined}
        sx={{
          maxWidth: variant === "official" ? "77%" : { xs: "calc(100% - 8px)", md: "72%" },
          minWidth: 0,
          boxSizing: "border-box",
          overflowWrap: "anywhere",
          wordBreak: "break-word",
          px: variant === "official" ? 1.5 : 1.35,
          py: variant === "official" ? 1 : 1,
          borderRadius: variant === "official" ? 2 : "14px 14px 4px 14px",
          bgcolor: variant === "official"
            ? (theme) => alpha(theme.palette.text.primary, 0.05)
            : (theme) => alpha(theme.palette.primary.main, theme.palette.mode === "dark" ? 0.24 : 0.11),
          border: variant === "official" ? 0 : undefined,
          borderColor: variant === "official" ? "transparent" : (theme) => alpha(theme.palette.primary.main, theme.palette.mode === "dark" ? 0.46 : 0.28),
          boxShadow: variant === "official" ? "none" : (theme) => theme.customShadows?.z1
        }}
      >
        {editing ? (
          <Stack spacing={1} sx={{ minWidth: { xs: "min(78vw, 520px)", sm: 420 }, maxWidth: "min(82vw, 860px)" }}>
            <TextField
              autoFocus
              multiline
              minRows={3}
              maxRows={12}
              fullWidth
              value={editText}
              onChange={(event) => onEditTextChange?.(event.target.value)}
              onKeyDown={(event) => {
                if ((event.ctrlKey || event.metaKey) && event.key === "Enter") {
                  event.preventDefault();
                  onEditSubmit?.();
                }
                if (event.key === "Escape") {
                  event.preventDefault();
                  onEditCancel?.();
                }
              }}
              inputProps={{ "aria-label": "Edit last message", "data-testid": "edit-last-message-input" }}
              sx={{ "& .MuiOutlinedInput-root": { bgcolor: "background.paper", borderRadius: 1.5 } }}
            />
            <Stack direction="row" spacing={0.75} justifyContent="flex-end">
              <Button size="small" variant="outlined" onClick={onEditCancel} disabled={editSubmitting} data-testid="cancel-edit-message">
                Cancel
              </Button>
              <Button size="small" variant="contained" onClick={onEditSubmit} disabled={editSubmitting || !editText.trim()} data-testid="send-edited-message">
                {editSubmitting ? "Sending…" : "Send"}
              </Button>
            </Stack>
          </Stack>
        ) : (
          <>
            {variant !== "official" && (
              <Stack direction="row" spacing={0.75} alignItems="center" sx={{ mb: visibleText ? 0.25 : 0 }}>
                <PersonIcon fontSize="small" color="primary" />
                <Typography variant="caption" sx={{ fontWeight: 850, color: "primary.main" }}>
                  {row.title}
                </Typography>
              </Stack>
            )}
            {displayedText && <MarkdownMessage text={displayedText} />}
            {messagePreview.collapsible && (
              <Stack direction="row" justifyContent="flex-end" sx={{ mt: 0.25 }}>
                <Tooltip title={t(messageExpanded ? "composer.collapse" : "composer.expand")}>
                  <IconButton
                    size="small"
                    aria-label={messageExpanded ? "Collapse user message" : "Expand user message"}
                    aria-expanded={messageExpanded}
                    data-testid="user-message-expand-toggle"
                    onClick={() => setMessageExpanded((current) => !current)}
                    sx={{ width: 28, height: 28 }}
                  >
                    {messageExpanded ? <UnfoldLessIcon fontSize="small" /> : <UnfoldMoreIcon fontSize="small" />}
                  </IconButton>
                </Tooltip>
              </Stack>
            )}
            <ImageAttachments row={row} sessionToken={sessionToken} />
            <FileAttachments row={row} />
          </>
        )}
      </Paper>
      {variant !== "official" && timestamp && (
        <Typography variant="caption" color="text.secondary" sx={{ pr: 0.5, fontVariantNumeric: "tabular-nums" }}>
          {timestamp}
        </Typography>
      )}
    </Box>
  );
}

function userMessageDisplayText(row: ChatWaterfallRow): string {
  if (!row.item.images?.length) return row.text;
  return row.text
    .split(/\r?\n/)
    .filter((line) => line.trim().toLowerCase() !== "[image]")
    .join("\n")
    .trim();
}

function AssistantMessageRow({
  row,
  t,
  sessionToken,
  expanded,
  onToggleExpanded,
  assistantUsageDisplay,
  onOpenPreview,
  webPreview,
  onClosePreview,
  variant
}: {
  row: ChatWaterfallRow;
  t: TranslateFn;
  sessionToken?: string | null;
  expanded: boolean;
  onToggleExpanded: () => void;
  assistantUsageDisplay: AssistantUsageDisplayMode;
  onOpenPreview?: (url: string, mode: WebPreviewMode) => void;
  webPreview?: WebPreviewState | null;
  onClosePreview?: () => void;
  variant?: "workbench" | "official";
}) {
  const reasoningContent = row.reasoning?.trim() ?? "";
  const officialReasoning = variant === "official" && reasoningContent
    ? splitOfficialReasoning(reasoningContent, t("chat.thinking"))
    : null;
  const tinted = row.assistantTone === "tinted";
  // A streamed assistant item receives a fresh updatedAt for each delta. Use
  // it for the visible clock while retaining startedAt for first-token timing.
  const startedAtLabel = formatStartedAt(row.updatedAt ?? row.startedAt);
  const firstTokenLabel = formatFirstToken(row.startedAt, row.firstTokenAt);
  const elapsedLabel = formatElapsed(row.turnStartedAt, row.firstTokenAt, row.startedAt);
  const usageLabel = formatAssistantUsageSummary(row);
  return (
    <Box
      className={variant === "official" ? "chatgpt-assistant-message" : undefined}
      data-testid={`workbench-item-${sanitizeTestId(row.item.type)}`}
      data-assistant-tone={row.assistantTone ?? "plain"}
      sx={{
        position: "relative",
        display: "flex",
        justifyContent: "flex-start",
        minWidth: 0,
        maxWidth: "100%",
        boxSizing: "border-box",
        mx: variant === "official" ? 0 : { xs: 0, sm: -1 },
        px: variant === "official" ? 0 : { xs: 0.5, sm: 1 },
        py: variant === "official" ? 0 : 0.75,
        borderRadius: 1,
        bgcolor: variant === "official" ? "transparent" : tinted
          ? (theme) => alpha(theme.palette.text.primary, theme.palette.mode === "dark" ? 0.07 : 0.045)
          : (theme) => alpha(theme.palette.background.paper, theme.palette.mode === "dark" ? 0.18 : 0.58)
      }}
    >
      {row.compactionMarker && <ContextCompactionMarker row={row} t={t} />}
      <Box
        sx={{
          width: "100%",
          maxWidth: variant === "official" ? "100%" : row.width === "wide" ? { xs: "100%", xl: "min(86vw, 1600px)" } : { xs: "100%", lg: 920 },
          minWidth: 0
        }}
      >
        {(reasoningContent || row.previewUrl || (variant !== "official" && (!row.hideHeader || startedAtLabel || firstTokenLabel || elapsedLabel || usageLabel))) && (
          <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap sx={{ mb: row.hideHeader ? 0.15 : 0.4, color: "text.secondary" }}>
            {variant !== "official" && !row.hideHeader && (
              <>
                <SmartToyIcon
                  data-testid="assistant-message-header"
                  data-live={row.isLive ? "true" : "false"}
                  sx={{
                    fontSize: 17,
                    color: row.isLive ? "primary.main" : "inherit",
                    opacity: row.isLive ? 1 : 0.72,
                    filter: row.isLive ? (theme) => `drop-shadow(0 0 4px ${alpha(theme.palette.primary.main, 0.38)})` : "none"
                  }}
                />
                <Typography variant="caption" sx={{ fontWeight: 850 }}>
                  {row.title}
                </Typography>
                {row.item.agentName && <Chip size="small" label={row.item.agentName} />}
                <StatusChip status={row.status} />
              </>
            )}
            {variant !== "official" && startedAtLabel && (
              <Typography variant="caption" data-testid="assistant-message-started-at" sx={{ fontWeight: 750, color: "text.primary" }}>
                {startedAtLabel}
              </Typography>
            )}
            {variant !== "official" && firstTokenLabel && (
              <Typography variant="caption" data-testid="assistant-first-token" sx={{ fontWeight: 650, color: "text.disabled" }}>
                {firstTokenLabel}
              </Typography>
            )}
            {variant !== "official" && elapsedLabel && (
              <Typography variant="caption" data-testid="assistant-elapsed" sx={{ fontWeight: 650, color: "text.disabled" }}>
                {elapsedLabel}
              </Typography>
            )}
            {variant !== "official" && usageLabel && (
              <Typography variant="caption" data-testid="assistant-token-usage" sx={{ fontWeight: 650, color: "text.disabled" }}>
                {usageLabel}
              </Typography>
            )}
            {variant !== "official" && row.tokenUsage?.billingSnapshot && <BillingTooltip row={row} t={t} />}
            {reasoningContent && (
              <Button
                size="small"
                variant="text"
                startIcon={variant === "official" ? undefined : <SmartToyIcon fontSize="small" />}
                aria-label={expanded ? "Collapse thinking" : "Expand thinking"}
                onClick={onToggleExpanded}
                sx={{
                  borderRadius: 1,
                  ml: row.hideHeader ? 0 : "auto",
                  flex: "0 0 auto",
                  whiteSpace: "nowrap",
                  color: variant === "official" ? "text.secondary" : undefined,
                  textTransform: "none",
                  ...(variant === "official" ? {
                    minWidth: 0,
                    maxWidth: "100%",
                    minHeight: 0,
                    px: 0,
                    py: 0,
                    justifyContent: "flex-start",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    "&:hover": { bgcolor: "transparent", color: "text.primary" }
                  } : {})
                }}
              >
                {officialReasoning?.heading ?? (expanded ? t("chat.thinking") : t("chat.thinking") + "...")}
              </Button>
            )}
            {row.previewUrl && onOpenPreview && (
              <WebPreviewMenu url={row.previewUrl} onSelect={onOpenPreview} t={t} />
            )}
          </Stack>
        )}
        {reasoningContent && expanded && (
          <Paper
            className={variant === "official" ? "chatgpt-reasoning-disclosure-body" : undefined}
            data-testid="completed-thinking-panel"
            variant="outlined"
            sx={{
              mb: 1,
              p: variant === "official" ? 0 : 1,
              borderRadius: 1,
              bgcolor: variant === "official" ? "transparent" : (theme) => alpha(theme.palette.background.default, theme.palette.mode === "dark" ? 0.5 : 0.64),
              borderColor: variant === "official" ? "transparent" : (theme) => alpha(theme.palette.text.primary, theme.palette.mode === "dark" ? 0.16 : 0.12),
              boxShadow: variant === "official" ? "none" : undefined
            }}
          >
            {variant !== "official" && (
              <Stack direction="row" spacing={0.75} alignItems="center" sx={{ mb: 0.5, color: "text.secondary" }}>
                <SmartToyIcon sx={{ fontSize: 16 }} />
                <Typography variant="caption" sx={{ fontWeight: 850 }}>
                  {t("chat.thinking")}
                </Typography>
              </Stack>
            )}
            <Box sx={{ maxHeight: "min(42vh, 420px)", overflow: "auto", pr: 0.5 }}>
              <MarkdownMessage text={officialReasoning?.body ?? reasoningContent} />
            </Box>
          </Paper>
        )}
        <Box
          sx={{
            px: variant === "official" ? 0 : { xs: 0.25, sm: 0.5 },
            py: 0.25,
            "& .code-block": {
              maxWidth: "100%"
            }
          }}
        >
          {row.text && <MarkdownMessage text={row.text} />}
          <ImageAttachments row={row} sessionToken={sessionToken} />
          <FileAttachments row={row} />
          {assistantUsageDisplay === "details" && <AssistantUsageDetails row={row} />}
        </Box>
      </Box>
    </Box>
  );
}

function AssistantUsageDetails({ row }: { row: ChatWaterfallRow }) {
  const details = assistantUsageDetails(row);
  const requests = row.requestUsage ?? [];
  if (!details && requests.length === 0) {
    return null;
  }
  return (
    <Stack
      data-testid="assistant-usage-details"
      spacing={0.75}
      sx={{
        mt: 1,
        pt: 0.75,
        borderTop: "1px solid",
        borderColor: (theme) => alpha(theme.palette.text.primary, theme.palette.mode === "dark" ? 0.12 : 0.1)
      }}
    >
      {details && <Stack direction="row" spacing={0.75} flexWrap="wrap" useFlexGap>
        {details.map((detail) => (
          <Chip key={detail} size="small" variant="outlined" label={detail} sx={{ height: 22, borderRadius: 1, bgcolor: "background.paper" }} />
        ))}
      </Stack>}
      {requests.length > 0 && <Stack data-testid="assistant-request-usage" spacing={0.5}>
        {requests.map((request, index) => {
          const usage = request.usage;
          const label = [
            "Request " + (index + 1),
            "input " + formatCompactNumber(usage.inputTokens),
            "cached " + formatCompactNumber(usage.cachedInputTokens),
            ...(usage.cacheWriteInputTokens > 0 ? ["write " + formatCompactNumber(usage.cacheWriteInputTokens)] : []),
            "output " + formatCompactNumber(usage.outputTokens),
            ...((usage.reasoningOutputTokens ?? 0) > 0 ? ["reasoning " + formatCompactNumber(usage.reasoningOutputTokens ?? 0)] : []),
            ...(usage.estimatedCostUsd != null ? ["cost " + formatUsd(usage.estimatedCostUsd)] : [])
          ].join(" · ");
          return <Box key={request.requestId} data-request-id={request.requestId} sx={{ fontSize: 11, color: "text.disabled", fontFamily: "ui-monospace, SFMono-Regular, Consolas, monospace" }}>{label}</Box>;
        })}
      </Stack>}
    </Stack>
  );
}

function ReasoningPreviewRow({
  row,
  t,
  expanded,
  onToggleExpanded,
  variant
}: {
  row: ChatWaterfallRow;
  t: TranslateFn;
  expanded: boolean;
  onToggleExpanded: () => void;
  variant?: "workbench" | "official";
}) {
  const thinkingText = row.text.trim();
  if (variant === "official") {
    return (
      <Box
        className="chatgpt-reasoning-group"
        data-testid={`workbench-item-${sanitizeTestId(row.item.type)}`}
        data-chat-row-expanded={expanded ? "true" : "false"}
        sx={{ width: "100%", minWidth: 0, color: "text.secondary" }}
      >
        <Box
          role="button"
          tabIndex={0}
          aria-label={expanded ? "Collapse thinking" : "Expand thinking"}
          onClick={onToggleExpanded}
          onKeyDown={(event) => {
            if (event.key === "Enter" || event.key === " ") {
              event.preventDefault();
              onToggleExpanded();
            }
          }}
          sx={{ minWidth: 0, cursor: "pointer", userSelect: "none" }}
        >
          <Typography
            className={!expanded ? "chatgpt-thinking-shimmer" : undefined}
            sx={{
              minWidth: 0,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
              fontSize: "var(--codex-chat-font-size, 16px)",
              lineHeight: "calc(var(--codex-chat-font-size, 16px) + 8px)",
              userSelect: "none"
            }}
          >
            {t("chat.thinking")}
          </Typography>
        </Box>
        {expanded && thinkingText && (
          <Box
            data-testid="thinking-preview"
            sx={{ mt: 0.5, maxHeight: "min(42vh, 420px)", overflow: "auto", color: "text.secondary" }}
            onClick={(event) => event.stopPropagation()}
          >
            <MarkdownMessage text={thinkingText} />
          </Box>
        )}
      </Box>
    );
  }
  return (
    <Box data-testid={`workbench-item-${sanitizeTestId(row.item.type)}`} sx={{ display: "flex", justifyContent: "flex-start", minWidth: 0, maxWidth: "100%" }}>
      <Paper
        variant="outlined"
        data-testid="thinking-preview"
        role="button"
        tabIndex={0}
        aria-label={expanded ? "Collapse thinking" : "Expand thinking"}
        onClick={onToggleExpanded}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            onToggleExpanded();
          }
        }}
        sx={{
          width: "100%",
          maxWidth: { xs: "100%", xl: "min(86vw, 1600px)" },
          minWidth: 0,
          boxSizing: "border-box",
          mx: "auto",
          px: 0.75,
          py: 0.55,
          borderRadius: 1,
          bgcolor: (theme) => alpha(theme.palette.background.default, theme.palette.mode === "dark" ? 0.5 : 0.66),
          borderColor: (theme) => alpha(theme.palette.text.primary, theme.palette.mode === "dark" ? 0.16 : 0.12),
          boxShadow: (theme) => theme.customShadows?.z1,
          cursor: "pointer"
        }}
      >
        <Stack direction="row" alignItems="center" spacing={0.75} sx={{ minWidth: 0 }}>
          <SmartToyIcon fontSize="small" sx={{ color: row.isLive ? "primary.main" : "text.secondary", flex: "0 0 auto" }} />
          <Typography variant="body2" sx={{ minWidth: 0, flex: 1, color: "text.secondary", fontWeight: 850, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {t("chat.thinking")}...
          </Typography>
          <Button
            size="small"
            variant="text"
            aria-label={expanded ? "Collapse thinking" : "Expand thinking"}
            onClick={(event) => { event.stopPropagation(); onToggleExpanded(); }}
            sx={{ borderRadius: 1, flex: "0 0 auto", minWidth: 0, px: 0.75, color: "text.disabled", fontWeight: 650 }}
          >
            {expanded ? "collapse" : "expand"}
          </Button>
        </Stack>
        {expanded && thinkingText && (
          <Box
            sx={{
              mt: 0.75,
              pt: 0.75,
              borderTop: "1px solid",
              borderColor: "divider",
              maxHeight: "min(42vh, 420px)",
              overflow: "auto",
              pr: 0.5
            }}
            onClick={(event) => event.stopPropagation()}
          >
            <MarkdownMessage text={thinkingText} />
          </Box>
        )}
      </Paper>
    </Box>
  );
}

function CommandGroupRow({ row, expanded, onToggleExpanded, variant }: { row: ChatWaterfallRow; expanded: boolean; onToggleExpanded: () => void; variant?: "workbench" | "official" }) {
  const groupedRows = row.groupedRows ?? [];
  const [visibleCommandCount, setVisibleCommandCount] = useState(COMMAND_GROUP_INITIAL_VISIBLE);
  const [expandedCommandKey, setExpandedCommandKey] = useState<string | null>(null);
  const hiddenCommandCount = Math.max(0, groupedRows.length - visibleCommandCount);
  const visibleGroupedRows = hiddenCommandCount > 0 ? groupedRows.slice(-visibleCommandCount) : groupedRows;

  return (
    <Box
      data-testid={`workbench-item-${sanitizeTestId(row.item.type)}`}
      data-grouped-command-count={groupedRows.length}
      data-visible-command-count={visibleGroupedRows.length}
      sx={{ width: "100%" }}
      className={variant === "official" ? "chatgpt-command-group" : undefined}
    >
      <Box
        role="button"
        tabIndex={0}
        aria-label={expanded ? "Collapse folded commands" : "Expand folded commands"}
        onClick={onToggleExpanded}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            onToggleExpanded();
          }
        }}
        sx={{
          display: "flex",
          alignItems: "center",
          gap: 1,
          minHeight: 24,
          py: 0.15,
          color: "text.secondary",
          cursor: "pointer",
          userSelect: "none",
          "&:hover .command-group-label": {
            color: "primary.main"
          }
        }}
      >
        <Stack direction="row" spacing={0.75} alignItems="center" className="command-group-label" sx={{ minWidth: 0, transition: "color 120ms ease" }}>
          <FoldedActivityPulse status={row.status} />
          <Typography variant="caption" sx={{ fontWeight: 850, whiteSpace: "nowrap" }}>
            Ran
          </Typography>
        </Stack>
        <Typography variant="caption" sx={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {groupedRows.length} commands
        </Typography>
        {expanded ? <UnfoldLessIcon sx={{ ml: "auto", fontSize: 16 }} /> : <UnfoldMoreIcon sx={{ ml: "auto", fontSize: 16 }} />}
      </Box>
      {expanded && (
        <Stack spacing={0.5} sx={{ mt: 0.35, ml: 1.25, pl: 1.25, borderLeft: "1px dashed", borderColor: "divider" }}>
          {hiddenCommandCount > 0 && (
            <Button
              size="small"
              variant="text"
              onClick={(event) => {
                event.stopPropagation();
                setVisibleCommandCount((current) => Math.min(groupedRows.length, current + COMMAND_GROUP_VISIBLE_STEP));
              }}
              sx={{ alignSelf: "flex-start", minHeight: 26 }}
            >
              Show {Math.min(COMMAND_GROUP_VISIBLE_STEP, hiddenCommandCount)} earlier commands
            </Button>
          )}
          {expanded && visibleGroupedRows.map((commandRow) => {
            const summary = activitySummary(commandRow);
            const commandExpanded = expandedCommandKey === commandRow.key;
            const hasOutput = Boolean(commandRow.text.trim());
            return (
              <Paper
                key={commandRow.key}
                data-testid={`grouped-command-${sanitizeTestId(commandRow.item.id)}`}
                variant="outlined"
                sx={{ p: 0.75, borderRadius: 1, bgcolor: (theme) => alpha(theme.palette.background.default, theme.palette.mode === "dark" ? 0.32 : 0.56) }}
              >
                <Stack direction="row" spacing={0.75} alignItems="center" sx={{ minWidth: 0 }}>
                  <Box sx={{ width: 7, height: 7, borderRadius: "50%", bgcolor: activityStatus(commandRow.status).color, flex: "0 0 auto" }} />
                  <Typography variant="caption" sx={{ color: "primary.main", fontWeight: 850 }}>
                    {summary.label}
                  </Typography>
                  <Typography variant="caption" title={summary.detail} sx={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace" }}>
                    {summary.detail ? `(${summary.detail})` : ""}
                  </Typography>
                  {hasOutput && (
                    <Tooltip title={commandExpanded ? "Collapse command output" : "Expand command output"}>
                      <IconButton
                        size="small"
                        aria-label={commandExpanded ? "Collapse command output" : "Expand command output"}
                        onClick={(event) => {
                          event.stopPropagation();
                          setExpandedCommandKey((current) => current === commandRow.key ? null : commandRow.key);
                        }}
                        sx={{ width: 26, height: 26, ml: "auto" }}
                      >
                        {commandExpanded ? <UnfoldLessIcon sx={{ fontSize: 16 }} /> : <UnfoldMoreIcon sx={{ fontSize: 16 }} />}
                      </IconButton>
                    </Tooltip>
                  )}
                </Stack>
                {commandExpanded && <CommandOutputBlock output={commandOutputPreview(commandRow.text, true)} compact />}
              </Paper>
            );
          })}
        </Stack>
      )}
    </Box>
  );
}

function DashedRule() {
  return (
    <Box
      aria-hidden
      sx={{
        height: 1,
        minWidth: 0,
        backgroundImage: (theme) => `repeating-linear-gradient(to right, ${alpha(theme.palette.text.secondary, 0.34)} 0 7px, transparent 7px 13px)`
      }}
    />
  );
}

function CommandExecutionRow({ row, expanded, onToggleExpanded, variant }: { row: ChatWaterfallRow; expanded: boolean; onToggleExpanded: () => void; variant?: "workbench" | "official" }) {
  const hasOutput = Boolean(row.text.trim());
  const commandOutput = commandOutputPreview(row.text, expanded, row.isLive);
  const summary = activitySummary(row);
  return (
    <ActivityRow
      row={row}
      label={summary.label}
      detail={summary.detail}
      expandable={hasOutput}
      expanded={expanded}
      onToggleExpanded={onToggleExpanded}
      variant={variant}
    >
      {row.text && expanded && (
        <CommandOutputBlock output={commandOutput} />
      )}
    </ActivityRow>
  );
}

function CommandOutputBlock({ output, compact = false }: { output: CommandOutputPreview; compact?: boolean }) {
  return (
    <Box
      data-testid="command-output"
      data-command-output-total-chars={output.totalChars}
      data-command-output-chars={output.text.length}
      data-command-output-lines={output.renderedLines}
      data-command-output-truncated={output.truncated ? "true" : "false"}
      component="pre"
      sx={{
        mt: 0.75,
        mb: 0,
        maxHeight: compact ? 180 : "min(46vh, 520px)",
        overflow: "auto",
        whiteSpace: "pre-wrap",
        overflowWrap: "anywhere",
        contain: "layout paint style",
        fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
        fontSize: compact ? 11.5 : 12,
        lineHeight: 1.55,
        p: 1,
        borderRadius: 1,
        border: "1px solid",
        borderColor: "divider",
        bgcolor: (theme) => alpha(theme.palette.common.black, theme.palette.mode === "dark" ? 0.22 : 0.035),
        color: "text.primary"
      }}
    >
      {output.text}
    </Box>
  );
}

function ToolActivityGroupRow({
  row,
  t,
  sessionToken,
  expanded,
  onToggleExpanded,
  variant
}: {
  row: ChatWaterfallRow;
  t: TranslateFn;
  sessionToken?: string | null;
  expanded: boolean;
  onToggleExpanded: () => void;
  variant?: "workbench" | "official";
}) {
  const groupedRows = row.groupedRows ?? [];
  // 单条已完成工具调用被折叠成 1 项分组时，分组头只会显示 “Tool calls · 1 tool”，
  // 把工具名与参数（如 vm-read /path、命令、文件）全部藏起来。单条没有折叠收益，
  // 直接渲染子行，保持与未分组时相同的可见详情。
  if (groupedRows.length === 1) {
    return (
      <ChatRow
        row={groupedRows[0]!}
        t={t}
        sessionToken={sessionToken}
        expanded={expanded}
        onToggleExpanded={onToggleExpanded}
        variant={variant}
      />
    );
  }
  const payload = isRecord(row.item.payload) ? row.item.payload : {};
  const commandCount = numberValue(payload.commandCount) ?? groupedRows.filter((entry) => entry.kind === "commandExecution").length;
  const editCount = numberValue(payload.editCount) ?? groupedRows.filter((entry) => entry.kind === "fileChange").length;
  const toolCount = numberValue(payload.toolCount) ?? Math.max(0, groupedRows.length - commandCount - editCount);
  const segments = [
    commandCount > 0 ? `${commandCount} ${commandCount === 1 ? "command" : "commands"}` : "",
    editCount > 0 ? `${editCount} ${editCount === 1 ? "edit" : "edits"}` : "",
    toolCount > 0 ? `${toolCount} ${toolCount === 1 ? "tool" : "tools"}` : ""
  ].filter(Boolean);

  return (
    <Box className={variant === "official" ? "chatgpt-activity-group" : undefined} data-testid="workbench-item-toolActivityGroup" data-grouped-tool-count={groupedRows.length} sx={{ width: "100%" }}>
      <Box
        role="button"
        tabIndex={0}
        aria-label={expanded ? "Collapse tool calls" : "Expand tool calls"}
        onClick={onToggleExpanded}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            onToggleExpanded();
          }
        }}
        sx={{
          display: "flex",
          alignItems: "center",
          gap: 0.75,
          minHeight: 28,
          px: 0.5,
          py: 0.15,
          color: "text.secondary",
          cursor: "pointer",
          userSelect: "none",
          borderRadius: 1,
          "&:hover": { bgcolor: "action.hover" }
        }}
      >
        <FoldedActivityPulse status={row.status} />
        <Typography variant="caption" sx={{ fontWeight: 850, color: "primary.main", whiteSpace: "nowrap" }}>
          Tool calls
        </Typography>
        <Typography variant="caption" sx={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {segments.join(" · ") || `${groupedRows.length} calls`}
        </Typography>
        {expanded ? <UnfoldLessIcon sx={{ ml: "auto", fontSize: 16 }} /> : <UnfoldMoreIcon sx={{ ml: "auto", fontSize: 16 }} />}
      </Box>
      {expanded && (
        <Stack spacing={0.15} sx={{ mt: 0.25, ml: 1, pl: 1, borderLeft: "1px dashed", borderColor: "divider" }}>
          {groupedRows.map((activityRow) => (
            <ChatRow key={activityRow.key} row={activityRow} t={t} sessionToken={sessionToken} variant={variant} />
          ))}
        </Stack>
      )}
    </Box>
  );
}

function WebPreviewMenu({ url, onSelect, t }: { url: string; onSelect: (url: string, mode: WebPreviewMode) => void; t?: TranslateFn }) {
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const choose = (mode: WebPreviewMode) => {
    setAnchor(null);
    onSelect(url, mode);
  };
  return (
    <>
      <Tooltip title={t?.("chat.webPreview") ?? "Web preview"}>
        <IconButton
          size="small"
          aria-label="Web preview options"
          data-testid="web-preview-menu-button"
          onClick={(event) => setAnchor(event.currentTarget)}
          sx={{ ml: "auto", flex: "0 0 auto", color: "#4285F4" }}
        >
          <ChromePreviewIcon />
        </IconButton>
      </Tooltip>
      <Menu anchorEl={anchor} open={Boolean(anchor)} onClose={() => setAnchor(null)}>
        <MenuItem onClick={() => choose("side")}><SideNavigationIcon fontSize="small" sx={{ mr: 1 }} />{t?.("chat.webPreviewSide") ?? "Open in side browser"}</MenuItem>
        <MenuItem onClick={() => choose("window")}><OpenInNewIcon fontSize="small" sx={{ mr: 1 }} />{t?.("chat.webPreviewWindow") ?? "Open preview window"}</MenuItem>
      </Menu>
    </>
  );
}
function ChromePreviewIcon() {
  return <Box aria-hidden sx={{ width: 18, height: 18, borderRadius: "50%", background: "conic-gradient(#DB4437 0 33%, #F4B400 0 50%, #0F9D58 0 67%, #4285F4 0)", position: "relative", "&::after": { content: '""', position: "absolute", inset: 5, borderRadius: "50%", bgcolor: "#4285F4", border: "1px solid rgba(255,255,255,0.85)" } }} />;
}

function ToolCallRow({ row, sessionToken, expanded, onToggleExpanded, variant }: { row: ChatWaterfallRow; sessionToken?: string | null; expanded: boolean; onToggleExpanded: () => void; variant?: "workbench" | "official" }) {
  const fileDetails = toolFileDetails(row);
  const toolImages = toolPayloadImages(row);
  const payload = isRecord(row.item.payload) ? row.item.payload : (isRecord(row.item) ? (row.item as Record<string, unknown>) : {});
  const args = extractToolArguments(payload, row);
  const hasDetails = Boolean(row.text.trim()) || args != null || Boolean(isRecord(row.item.payload)) || fileDetails.length > 0 || toolImages.length > 0;
  const summary = activitySummary(row);
  const detail = toolImages.length > 0 ? [summary.detail, `${toolImages.length} image output${toolImages.length === 1 ? "" : "s"}`].filter(Boolean).join(" · ") : summary.detail;
  return (
    <ActivityRow
      row={row}
      label={summary.label}
      detail={detail}
      expandable={hasDetails}
      expanded={expanded}
      onToggleExpanded={onToggleExpanded}
      variant={variant}
      sessionToken={sessionToken}
      showAttachments={false}
    >
      {hasDetails && expanded && <Box data-testid="tool-audit-details">{renderToolPayload(row, fileDetails, toolImages, sessionToken)}</Box>}
    </ActivityRow>
  );
}

function FileChangeRow({ row, expanded, onToggleExpanded, variant }: { row: ChatWaterfallRow; expanded: boolean; onToggleExpanded: () => void; variant?: "workbench" | "official" }) {
  const summary = fileChangeSummary(row);
  const details = fileChangeDetails(row, summary);
  const activity = activitySummary(row);
  const hasDetails = details.length > 0;
  const compactDetail = compactFileChangeActivityDetail(activity.detail, summary.primaryPath);

  return (
    <ActivityRow
      row={row}
      label={activity.label}
      detail={compactDetail}
      detailTitle={activity.detail}
      expandable={hasDetails}
      expanded={expanded}
      onToggleExpanded={onToggleExpanded}
      variant={variant}
    >
      {hasDetails && expanded && (
        <Box data-testid="file-audit-details" sx={{ mt: 1, pt: 1, borderTop: "1px solid", borderColor: "divider" }}>
          <Stack spacing={1}>
            {details.map((detail, index) => (
              <FileChangeDetailBlock key={`${detail.path ?? "file"}-${index}`} detail={detail} />
            ))}
          </Stack>
        </Box>
      )}
    </ActivityRow>
  );
}

function FileChangeDetailBlock({ detail }: { detail: FileChangeDetail }) {
  const status = detail.status || detail.kind;
  const stats = fileChangeStatsLabel(detail.additions ?? 0, detail.deletions ?? 0);
  return (
    <Paper
      variant="outlined"
      sx={{
        borderRadius: 1,
        overflow: "hidden",
        bgcolor: (theme) => alpha(theme.palette.background.default, theme.palette.mode === "dark" ? 0.34 : 0.56)
      }}
    >
      <Stack
        direction="row"
        spacing={0.75}
        alignItems="center"
        sx={{
          px: 1,
          py: 0.65,
          borderBottom: "1px solid",
          borderColor: "divider",
          minWidth: 0
        }}
      >
        <Typography variant="caption" sx={{ fontWeight: 850, minWidth: 0, overflowWrap: "anywhere" }}>
          {detail.path ?? "File change"}
        </Typography>
        <StatusChip status={status} />
        {stats && (
          <Typography variant="caption" sx={{ color: "text.secondary", fontWeight: 750 }}>
            {stats}
          </Typography>
        )}
      </Stack>
      {detail.beforeText != null || detail.afterText != null ? (
        <GitFileDiffView beforeText={detail.beforeText ?? ""} afterText={detail.afterText ?? ""} filePath={detail.path} />
      ) : detail.unifiedDiff ? (
        <UnifiedDiffBlock text={detail.unifiedDiff} />
      ) : detail.text ? (
        <Box sx={{ p: 1 }}>
          <MarkdownMessage text={detail.text} />
        </Box>
      ) : (
        <Box sx={{ p: 1 }}>
          <Typography variant="caption" color="text.secondary">
            {status ? `Status: ${status}` : "No diff body was included for this file event."}
          </Typography>
        </Box>
      )}
    </Paper>
  );
}

function ActivityRow({
  row,
  label,
  detail,
  detailTitle,
  action,
  children,
  expandable = false,
  expanded = false,
  onToggleExpanded,
  showAttachments = true,
  variant,
  sessionToken
}: {
  row: ChatWaterfallRow;
  label: string;
  detail?: string;
  detailTitle?: string;
  action?: ReactNode;
  children?: ReactNode;
  expandable?: boolean;
  expanded?: boolean;
  onToggleExpanded?: () => void;
  showAttachments?: boolean;
  variant?: "workbench" | "official";
  sessionToken?: string | null;
}) {
  const status = activityStatus(row.status);
  return (
    <Box className={variant === "official" ? "chatgpt-activity-row" : undefined} data-testid={`workbench-item-${sanitizeTestId(row.item.type)}`} sx={{ display: "flex", justifyContent: "flex-start", width: "100%", minWidth: 0, maxWidth: "100%" }}>
      <Box
        sx={{
          width: "100%",
          maxWidth: { xs: "100%", xl: "min(86vw, 1600px)" },
          minWidth: 0,
          mx: row.width === "wide" ? 0 : "auto",
          py: 0.18
        }}
      >
        <Stack
          role={expandable ? "button" : undefined}
          tabIndex={expandable ? 0 : undefined}
          aria-label={expandable ? `${expanded ? "Collapse" : "Expand"} ${label} activity` : undefined}
          direction="row"
          alignItems="center"
          spacing={0.75}
          onClick={expandable ? onToggleExpanded : undefined}
          onKeyDown={expandable ? (event) => {
            if (event.key === "Enter" || event.key === " ") {
              event.preventDefault();
              onToggleExpanded?.();
            }
          } : undefined}
          sx={{
            position: "relative",
            overflow: "hidden",
            minHeight: 28,
            px: 0.5,
            borderRadius: 1,
            cursor: expandable ? "pointer" : "default",
            "&:hover": {
              bgcolor: (theme) => alpha(theme.palette.text.primary, theme.palette.mode === "dark" ? 0.045 : 0.035)
            },
            ...(status.live && row.kind === "commandExecution" ? {
              bgcolor: (theme) => alpha(theme.palette.primary.main, theme.palette.mode === "dark" ? 0.08 : 0.045)
            } : {})
          }}
        >
          <Box
            aria-label={status.label}
            sx={{
              width: 9,
              height: 9,
              borderRadius: "50%",
              flex: "0 0 auto",
              bgcolor: status.color,
              boxShadow: status.live ? (theme) => `0 0 7px ${alpha(theme.palette.warning.main, 0.55)}` : "none"
            }}
          />
          <Typography component="span" variant="body2" sx={{ color: "primary.main", fontWeight: 850, flex: "0 0 auto" }}>
            {label}
          </Typography>
          <Typography
            component="span"
            variant="body2"
            sx={{
              minWidth: 0,
              flex: 1,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
              fontFamily: row.kind === "commandExecution" ? "ui-monospace, SFMono-Regular, Menlo, monospace" : "inherit",
              color: "text.primary"
            }}
            title={detailTitle ?? detail}
          >
            {detail ? <ActivityDetail detail={detail} /> : ""}
          </Typography>
          {row.item.agentName && <Chip size="small" label={row.item.agentName} sx={{ height: 20, borderRadius: 1 }} />}
          {action}
        </Stack>
        {children}
        {showAttachments && <ImageAttachments row={row} sessionToken={sessionToken} />}
        <FileAttachments row={row} />
      </Box>
    </Box>
  );
}

function AuditRow({ row, icon, action, children, sessionToken }: { row: ChatWaterfallRow; icon: ReactNode; action?: ReactNode; children?: ReactNode; sessionToken?: string | null }) {
  return (
    <Box data-testid={`workbench-item-${sanitizeTestId(row.item.type)}`} sx={{ display: "flex", justifyContent: "stretch", minWidth: 0, maxWidth: "100%" }}>
      <Paper
        variant="outlined"
        sx={{
          width: "100%",
          maxWidth: { xs: "100%", xl: "min(86vw, 1600px)" },
          minWidth: 0,
          mx: row.width === "wide" ? 0 : "auto",
          p: 1.15,
          borderRadius: 1,
          bgcolor: (theme) => alpha(theme.palette.background.default, theme.palette.mode === "dark" ? 0.62 : 0.68),
          borderColor: (theme) => alpha(theme.palette.text.primary, theme.palette.mode === "dark" ? 0.14 : 0.12),
          boxShadow: (theme) => theme.customShadows?.z1
        }}
      >
        <Stack direction="row" alignItems="center" spacing={1}>
          {icon}
          <Typography variant="subtitle2" sx={{ fontWeight: 800, minWidth: 0, flex: 1, overflowWrap: "anywhere" }}>
            {row.title}
          </Typography>
          {row.item.agentName && <Chip size="small" label={row.item.agentName} />}
          <StatusChip status={row.status} />
          {action}
        </Stack>
        {children ?? (row.text ? <MarkdownMessage text={row.text} /> : null)}
        <ImageAttachments row={row} sessionToken={sessionToken} />
        <FileAttachments row={row} />
      </Paper>
    </Box>
  );
}

function StatusRow({ row, t, onOpenCommandBlacklistSettings, variant }: { row: ChatWaterfallRow; t: TranslateFn; onOpenCommandBlacklistSettings?: (providerId?: string, groupId?: string) => void; variant?: "workbench" | "official" }) {
  const blacklistTarget = commandBlacklistSettingsTarget(row);
  return (
    <Box className={variant === "official" ? "chatgpt-status-row" : undefined} data-testid={`workbench-item-${sanitizeTestId(row.item.type)}`} sx={{ display: "flex", justifyContent: "center", minWidth: 0, maxWidth: "100%" }}>
      <Paper
        variant="outlined"
        sx={{
          maxWidth: 760,
          minWidth: 0,
          px: 1,
          py: 0.65,
          borderRadius: 1,
          bgcolor: blacklistTarget
            ? (theme) => alpha(theme.palette.error.main, theme.palette.mode === "dark" ? 0.22 : 0.1)
            : (theme) => alpha(theme.palette.background.default, theme.palette.mode === "dark" ? 0.44 : 0.58),
          borderColor: blacklistTarget ? (theme) => alpha(theme.palette.error.main, theme.palette.mode === "dark" ? 0.58 : 0.34) : undefined,
          color: "text.secondary"
        }}
      >
        <Stack direction="row" spacing={0.75} alignItems="center" flexWrap="wrap" useFlexGap>
          <Typography variant="caption" sx={{ fontWeight: 800 }}>
            {row.title}
          </Typography>
          <StatusChip status={row.status} />
          {row.text && <Typography variant="caption">{row.text}</Typography>}
          {blacklistTarget && onOpenCommandBlacklistSettings ? (
            <Tooltip title={t("chat.commandBlacklistSettingsTooltip")} arrow>
              <IconButton
                size="small"
                aria-label={t("chat.commandBlacklistSettings")}
                data-testid={`open-command-blacklist-settings-${sanitizeTestId(row.item.id)}`}
                onClick={(event) => {
                  event.stopPropagation();
                  onOpenCommandBlacklistSettings(blacklistTarget.providerId, blacklistTarget.groupId);
                }}
                sx={{ width: 24, height: 24, ml: 0.25, color: "text.secondary" }}
              >
                <HelpOutlineIcon sx={{ fontSize: 17 }} />
              </IconButton>
            </Tooltip>
          ) : null}
        </Stack>
      </Paper>
    </Box>
  );
}

function splitOfficialReasoning(text: string, fallback: string): { heading: string; body: string } {
  const lines = text.split(/\r?\n/);
  const firstContentIndex = lines.findIndex((line) => line.trim().length > 0);
  if (firstContentIndex < 0) return { heading: fallback, body: "" };
  const firstLine = lines[firstContentIndex]?.trim() ?? "";
  const heading = firstLine
    .replace(/^#{1,6}\s+/, "")
    .replace(/^\*\*(.+)\*\*$/, "$1")
    .replace(/^__(.+)__$/, "$1")
    .trim() || fallback;
  const body = [...lines.slice(0, firstContentIndex), ...lines.slice(firstContentIndex + 1)].join("\n").trim();
  return { heading, body };
}

function ReviewModeRow({ row, expanded, onToggleExpanded, variant }: { row: ChatWaterfallRow; expanded: boolean; onToggleExpanded: () => void; variant?: "workbench" | "official" }) {
  const entered = row.item.type === "enteredReviewMode";
  return (
    <Box className={variant === "official" ? "chatgpt-review-row" : undefined} data-testid={`workbench-item-${sanitizeTestId(row.item.type)}`} sx={{ width: "100%" }}>
      <Paper variant="outlined" sx={{ width: "100%", maxWidth: 920, mx: "auto", borderRadius: 1, overflow: "hidden" }}>
        <Stack
          role="button"
          tabIndex={0}
          aria-expanded={expanded}
          direction="row"
          alignItems="center"
          spacing={0.75}
          onClick={onToggleExpanded}
          onKeyDown={(event) => {
            if (event.key === "Enter" || event.key === " ") {
              event.preventDefault();
              onToggleExpanded();
            }
          }}
          sx={{ px: 1, py: 0.7, cursor: "pointer" }}
        >
          <ChecklistIcon sx={{ fontSize: 18, color: entered ? "warning.main" : "success.main" }} />
          <Typography variant="body2" sx={{ fontWeight: 800, flex: 1 }}>{row.title}</Typography>
          <StatusChip status={row.status} />
          {expanded ? <UnfoldLessIcon fontSize="small" /> : <UnfoldMoreIcon fontSize="small" />}
        </Stack>
        {expanded && row.text ? (
          <Box data-testid="review-mode-details" sx={{ px: 1.25, pb: 1.1, color: "text.secondary" }}>
            <MarkdownMessage text={row.text} />
          </Box>
        ) : null}
      </Paper>
    </Box>
  );
}

function RetryErrorGroupRow({ row, expanded, onToggleExpanded, variant }: { row: ChatWaterfallRow; expanded: boolean; onToggleExpanded: () => void; variant?: "workbench" | "official" }) {
  const groupedRows = row.groupedRows ?? [];
  const payload = isRecord(row.item.payload) ? row.item.payload : {};
  const retrying = payload.retrying === true;
  const isPressured = isPerformancePressured() || (typeof document !== "undefined" && document.documentElement.dataset.performancePressure === "true");
  const shouldAnimate = retrying && !isPressured && !prefersReducedMotion();
  return (
    <Box className={variant === "official" ? "chatgpt-retry-row" : undefined} data-testid="retry-error-group" data-retrying={retrying ? "true" : "false"} sx={{ width: "100%" }}>
      <Paper variant="outlined" sx={{ width: "100%", maxWidth: { xs: "100%", xl: "min(86vw, 1600px)" }, mx: "auto", borderRadius: 1, overflow: "hidden" }}>
        <Stack
          role="button"
          tabIndex={0}
          aria-expanded={expanded}
          aria-label={expanded ? "Collapse retry errors" : "Expand retry errors"}
          direction="row"
          alignItems="center"
          spacing={0.75}
          onClick={onToggleExpanded}
          onKeyDown={(event) => {
            if (event.key === "Enter" || event.key === " ") {
              event.preventDefault();
              onToggleExpanded();
            }
          }}
          sx={{ px: 1, py: 0.65, cursor: "pointer", color: retrying ? "warning.main" : "error.main" }}
        >
          <CloseIcon
            data-testid="retry-error-pulse"
            sx={{
              fontSize: 18,
              ...(shouldAnimate ? {
                animation: "retry-error-breathe 1.6s ease-in-out infinite",
                "@media (prefers-reduced-motion: reduce)": { animation: "none" },
                "[data-performance-pressure='true'] &": { animation: "none" }
              } : {})
            }}
          />
          <Typography variant="body2" sx={{ fontWeight: 850, flex: 1, color: "text.primary" }}>{row.title}</Typography>
          <StatusChip status={row.status} />
          {expanded ? <UnfoldLessIcon fontSize="small" /> : <UnfoldMoreIcon fontSize="small" />}
        </Stack>
        {expanded && (
          <Stack data-testid="retry-error-details" spacing={0.75} sx={{ px: 1, pb: 1 }}>
            {groupedRows.map((entry, index) => {
              const entryPayload = isRecord(entry.item.payload) ? entry.item.payload : {};
              const details = typeof entryPayload.additionalDetails === "string" ? entryPayload.additionalDetails : "";
              return (
                <Paper key={entry.key} variant="outlined" sx={{ p: 0.85, borderRadius: 1 }}>
                  <Stack direction="row" spacing={0.75} alignItems="center">
                    <Typography variant="caption" sx={{ fontWeight: 850 }}>#{index + 1}</Typography>
                    <Chip size="small" label={entryPayload.retrySource === "app" ? "App retry" : entryPayload.retrySource === "mini" ? "Mini retry" : "Codex retry"} sx={{ height: 20 }} />
                    <StatusChip status={entry.status} />
                  </Stack>
                  <Typography variant="body2" sx={{ mt: 0.5, overflowWrap: "anywhere" }}>{entry.text}</Typography>
                  {details && <Typography variant="caption" color="text.secondary" sx={{ display: "block", mt: 0.4, whiteSpace: "pre-wrap" }}>{details}</Typography>}
                </Paper>
              );
            })}
          </Stack>
        )}
      </Paper>
    </Box>
  );
}

function BillingTooltip({ row, t }: { row: ChatWaterfallRow; t: TranslateFn }) {
  const usage = row.tokenUsage;
  const billing = usage?.billingSnapshot;
  if (!usage || !billing || usage.estimatedCostUsd == null) return null;
  const standardInputTokens = Math.max(0, usage.inputTokens - usage.cachedInputTokens - usage.cacheWriteInputTokens);
  const inputRate = billing.inputUsdPerMillion * billing.inputMultiplier;
  const cachedRate = billing.cachedInputUsdPerMillion * billing.cacheReadMultiplier;
  const cacheWriteRate = billing.cacheWriteUsdPerMillion * billing.cacheWriteMultiplier;
  const outputRate = billing.outputUsdPerMillion * billing.outputMultiplier;
  const formulaTerms = [
    `${standardInputTokens} tokens / 1M * ${formatRate(inputRate)}`,
    `${usage.cachedInputTokens} cached / 1M * ${formatRate(cachedRate)}`,
    ...(usage.cacheWriteInputTokens > 0 ? [`${usage.cacheWriteInputTokens} cache write / 1M * ${formatRate(cacheWriteRate)}`] : []),
    `${usage.outputTokens} tokens / 1M * ${formatRate(outputRate)}`
  ];
  const title = (
    <Box data-testid="assistant-billing-tooltip" sx={{ maxWidth: 520, py: 0.5 }}>
      <Typography variant="caption" component="div" sx={{ fontWeight: 800 }}>
        {t("chat.billing.cachedTokens", { value: usage.cachedInputTokens })}
      </Typography>
      <Typography variant="caption" component="div" sx={{ mt: 0.5 }}>
        {t("chat.billing.multipliers", {
          model: formatMultiplier(billing.modelMultiplier),
          cache: formatMultiplier(billing.cacheReadMultiplier),
          output: formatMultiplier(billing.outputMultiplier),
          group: formatMultiplier(billing.groupRatio)
        })}
      </Typography>
      <Typography variant="caption" component="div" sx={{ mt: 0.75, fontWeight: 800 }}>
        {t("chat.billing.process")}
      </Typography>
      <Typography variant="caption" component="div" sx={{ whiteSpace: "pre-line", mt: 0.35 }}>
        {t("chat.billing.inputRate", { base: formatRate(billing.inputUsdPerMillion), effective: formatRate(inputRate), multiplier: formatMultiplier(billing.inputMultiplier) })}
        {"\n"}
        {t("chat.billing.outputRate", { base: formatRate(billing.outputUsdPerMillion), effective: formatRate(outputRate), multiplier: formatMultiplier(billing.outputMultiplier) })}
        {"\n"}
        {t("chat.billing.cacheRate", { base: formatRate(billing.cachedInputUsdPerMillion), effective: formatRate(cachedRate), multiplier: formatMultiplier(billing.cacheReadMultiplier) })}
        {usage.cacheWriteInputTokens > 0 ? `\n${t("chat.billing.cacheWriteRate", { base: formatRate(billing.cacheWriteUsdPerMillion), effective: formatRate(cacheWriteRate), multiplier: formatMultiplier(billing.cacheWriteMultiplier) })}` : ""}
      </Typography>
      <Typography variant="caption" component="div" sx={{ mt: 0.75, whiteSpace: "normal" }}>
        {`(${formulaTerms.join(" + ")}) * ${t("chat.billing.groupRatio")} ${formatMultiplier(billing.groupRatio)} = ${formatUsd(usage.estimatedCostUsd)}`}
      </Typography>
    </Box>
  );
  return (
    <Tooltip title={title} arrow placement="bottom">
      <IconButton
        size="small"
        aria-label={t("chat.billing.details")}
        data-testid="assistant-billing-details"
        sx={{ width: 18, height: 18, p: 0, color: "text.disabled" }}
      >
        <AttachMoneyIcon sx={{ fontSize: 15 }} />
      </IconButton>
    </Tooltip>
  );
}

export function collapseUserMessageText(text: string, maxLines = 10): { preview: string; collapsible: boolean; lineCount: number } {
  const lines = text.split(/\r?\n/);
  const safeMaxLines = Math.max(1, Math.floor(maxLines));
  return {
    preview: lines.slice(0, safeMaxLines).join("\n"),
    collapsible: lines.length > safeMaxLines,
    lineCount: lines.length
  };
}

function commandBlacklistSettingsTarget(row: ChatWaterfallRow): { providerId?: string; groupId?: string } | null {
  if (row.kind !== "error" && row.item.type.toLowerCase() !== "error") return null;
  const itemRecord = row.item as unknown as Record<string, unknown>;
  const payload = isRecord(row.item.payload) ? row.item.payload : {};
  const marker = isRecord(payload.commandBlacklist)
    ? payload.commandBlacklist
    : isRecord(itemRecord.commandBlacklist)
      ? itemRecord.commandBlacklist
      : null;
  if (!marker) return null;
  const providerId = typeof marker.providerId === "string" && marker.providerId.trim() ? marker.providerId : undefined;
  const groupId = typeof marker.groupId === "string" && marker.groupId.trim() ? marker.groupId : undefined;
  return { providerId, groupId };
}

export function compactFileChangeActivityDetail(detail?: string, fullPath?: string): string | undefined {
  if (!detail || !fullPath || !detail.startsWith(fullPath)) return detail;
  const normalized = fullPath.replace(/[\\/]+$/, "");
  const fileName = normalized.split(/[\\/]/).pop() || fullPath;
  return `${fileName}${detail.slice(fullPath.length)}`;
}

function FileChangeGroupRow({ row, expanded, onToggleExpanded, variant, onUndoFileChanges, onReviewFileChanges }: { row: ChatWaterfallRow; expanded: boolean; onToggleExpanded: () => void; variant?: "workbench" | "official"; onUndoFileChanges?: (rows: ChatWaterfallRow[]) => void; onReviewFileChanges?: (rows: ChatWaterfallRow[]) => void }) {
  const groupedRows = row.groupedRows ?? [];
  const summary = groupedFileChangeSummary(groupedRows);
  return (
    <Paper
      className={variant === "official" ? "chatgpt-file-change-card" : undefined}
      data-testid={`workbench-item-${sanitizeTestId(row.item.type)}`}
      data-grouped-file-change-count={groupedRows.length}
      variant="outlined"
      sx={{ width: "100%", maxWidth: { xs: "100%", xl: "min(86vw, 1600px)" }, mx: "auto", borderRadius: 1.5, overflow: "hidden", bgcolor: "background.paper" }}
    >
      <Box
        role="button"
        tabIndex={0}
        aria-label={expanded ? "Collapse folded edits" : "Expand folded edits"}
        onClick={onToggleExpanded}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            onToggleExpanded();
          }
        }}
        sx={{
          display: "flex",
          alignItems: "center",
          gap: 1.25,
          minHeight: 58,
          px: 1.5,
          py: 0.9,
          cursor: "pointer",
          userSelect: "none",
          "&:hover": { bgcolor: "action.hover" }
        }}
      >
        <Box sx={{ width: 38, height: 38, borderRadius: 1.25, display: "grid", placeItems: "center", bgcolor: "action.hover", color: "text.secondary", flex: "0 0 auto" }}>
          <InsertDriveFileIcon sx={{ fontSize: 21 }} />
        </Box>
        <Box sx={{ minWidth: 0, flex: 1 }}>
          <Typography variant="body2" sx={{ fontWeight: 850, color: "text.primary" }}>
            Edited {summary.files.length} {summary.files.length === 1 ? "file" : "files"}
          </Typography>
          <Stack direction="row" spacing={0.75} alignItems="center">
            <Typography variant="caption" sx={{ color: summary.additions > 0 ? "success.main" : "text.disabled", fontWeight: 800 }}>+{summary.additions}</Typography>
            <Typography variant="caption" sx={{ color: summary.deletions > 0 ? "error.main" : "text.disabled", fontWeight: 800 }}>-{summary.deletions}</Typography>
          </Stack>
        </Box>
        {expanded ? <UnfoldLessIcon sx={{ ml: "auto", fontSize: 16 }} /> : <UnfoldMoreIcon sx={{ ml: "auto", fontSize: 16 }} />}
      </Box>
      {expanded && (
        <Stack spacing={0} sx={{ borderTop: "1px solid", borderColor: "divider", py: 0.5 }}>
          {summary.files.map((file) => (
            <Stack key={file.path} direction="row" spacing={1} alignItems="center" sx={{ minHeight: 36, px: 1.75, py: 0.4 }}>
              <Typography variant="body2" title={file.path} sx={{ minWidth: 0, flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: "text.secondary" }}>
                {file.displayPath}
              </Typography>
              <Stack direction="row" spacing={0.5} sx={{ flex: "0 0 auto" }}>
                <Typography variant="body2" sx={{ color: file.additions > 0 ? "success.main" : "text.disabled", fontVariantNumeric: "tabular-nums" }}>+{file.additions}</Typography>
                <Typography variant="body2" sx={{ color: file.deletions > 0 ? "error.main" : "text.disabled", fontVariantNumeric: "tabular-nums" }}>-{file.deletions}</Typography>
              </Stack>
            </Stack>
          ))}
        </Stack>
      )}
      {variant === "official" && (onUndoFileChanges || onReviewFileChanges) && (
        <Stack direction="row" spacing={1} justifyContent="flex-end" sx={{ borderTop: "1px solid", borderColor: "divider", px: 1.5, py: 1 }}>
          {onUndoFileChanges && <Button size="small" onClick={() => onUndoFileChanges(groupedRows)}>Undo</Button>}
          {onReviewFileChanges && <Button size="small" variant="contained" onClick={() => onReviewFileChanges(groupedRows)}>Review</Button>}
        </Stack>
      )}
    </Paper>
  );
}

type GroupedFileSummary = { path: string; displayPath: string; additions: number; deletions: number };

function groupedFileChangeSummary(rows: ChatWaterfallRow[]): { files: GroupedFileSummary[]; additions: number; deletions: number } {
  const files = new Map<string, Omit<GroupedFileSummary, "displayPath">>();
  let additions = 0;
  let deletions = 0;
  for (const row of rows) {
    const summary = fileChangeSummary(row);
    additions += summary.additions;
    deletions += summary.deletions;
    const changes = summary.changes.length > 0
      ? summary.changes
      : summary.primaryPath
        ? [{ path: summary.primaryPath, additions: summary.additions, deletions: summary.deletions }]
        : [];
    for (const change of changes) {
      const current = files.get(change.path) ?? { path: change.path, additions: 0, deletions: 0 };
      current.additions += change.additions ?? 0;
      current.deletions += change.deletions ?? 0;
      files.set(change.path, current);
    }
  }
  const entries = [...files.values()];
  const displayPaths = compactCommonPathPrefix(entries.map((entry) => entry.path));
  return {
    files: entries.map((entry, index) => ({ ...entry, displayPath: displayPaths[index] ?? entry.path })),
    additions,
    deletions
  };
}

function compactCommonPathPrefix(paths: string[]): string[] {
  if (paths.length === 0) return [];
  const segments = paths.map((path) => path.split(/[\\/]+/).filter(Boolean));
  let commonLength = 0;
  const maxCommon = Math.min(...segments.map((parts) => Math.max(0, parts.length - 1)));
  while (commonLength < maxCommon && segments.every((parts) => parts[commonLength]?.toLowerCase() === segments[0]?.[commonLength]?.toLowerCase())) {
    commonLength += 1;
  }
  return segments.map((parts) => parts.slice(commonLength).join("/"));
}

function FoldedActivityPulse({ status }: { status?: string }) {
  const color = activityStatus(status).color;
  return (
    <Box
      aria-label={status === "failed" ? "Folded activity contains failures" : "Folded activity"}
      sx={{
        width: 8,
        height: 8,
        borderRadius: "50%",
        bgcolor: color,
        flex: "0 0 auto",
        animation: "foldedActivityPulse 1.8s ease-in-out infinite",
        "@keyframes foldedActivityPulse": {
          "0%, 100%": { opacity: 0.58, transform: "scale(0.88)" },
          "50%": { opacity: 1, transform: "scale(1.16)" }
        },
        "@media (prefers-reduced-motion: reduce)": { animation: "none", opacity: 1 }
      }}
    />
  );
}

function ActivityDetail({ detail }: { detail: string }) {
  const match = detail.match(/^(.*?)(?:\s*\(\+(\d+)(?:[,，]?\s*|\s+)-(\d+)\))$/);
  if (!match) return <>({detail})</>;
  const additions = Number(match[2]);
  const deletions = Number(match[3]);
  const prefix = match[1] ? `${match[1]} ` : "";
  return (
    <>
      ({prefix}<Box component="span" sx={{ color: additions === 0 ? "inherit" : "success.main" }}>+{additions}</Box>,{" "}
      <Box component="span" sx={{ color: deletions === 0 ? "inherit" : "error.main" }}>-{deletions}</Box>)
    </>
  );
}

function ContextCompactionRow({ row, t, variant }: { row: ChatWaterfallRow; t: TranslateFn; variant?: "workbench" | "official" }) {
  const completed = row.status === "completed" || !row.isLive;
  const free = row.compactionSource === "free";
  const cliName = waterfallCompactionLabel(row.compactionBackend);
  const sourceTitle = free ? t("chat.compaction.freeTitle") : cliName ? t("chat.compaction.nativeTitle", { cli: cliName }) : t("chat.compaction.genericTitle");
  const description = completed
    ? t("chat.compaction.completedDescription")
    : cliName ? t("chat.compaction.inProgressDescription", { cli: cliName }) : t("chat.compaction.genericInProgress");
  const routeDetail = free ? [row.compactionProviderId, row.compactionModel].filter(Boolean).join(" / ") : "";
  if (variant === "official") {
    return (
      <Box className="chatgpt-context-compaction" data-testid="context-compaction-progress" data-state={completed ? "completed" : "in-progress"}>
        {completed ? "Context automatically compacted" : "Compacting context…"}
      </Box>
    );
  }
  return (
    <Box
      data-testid="context-compaction-progress"
      data-state={completed ? "completed" : "in-progress"}
      data-compaction-source={free ? "free" : "native"}
      data-compaction-backend={row.compactionBackend}
      sx={{ display: "flex", justifyContent: "center", minWidth: 0, maxWidth: "100%" }}
    >
      <Paper
        variant="outlined"
        sx={{
          width: "100%",
          maxWidth: 760,
          minWidth: 0,
          px: 1.25,
          py: 1,
          borderRadius: 1,
          bgcolor: (theme) => alpha(free ? theme.palette.success.main : theme.palette.primary.main, theme.palette.mode === "dark" ? 0.1 : 0.055),
          borderColor: (theme) => alpha(free ? theme.palette.success.main : theme.palette.primary.main, theme.palette.mode === "dark" ? 0.32 : 0.2)
        }}
      >
        <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 0.8 }}>
          {free ? <AttachMoneyIcon color="success" fontSize="small" /> : <CompressIcon color={completed ? "success" : "primary"} fontSize="small" />}
          <Box sx={{ minWidth: 0, flex: 1 }}>
            <Typography variant="subtitle2" sx={{ fontWeight: 850 }}>
              {sourceTitle}
            </Typography>
            <Typography variant="caption" color="text.secondary">
              {routeDetail || description}
            </Typography>
          </Box>
          <Chip
            size="small"
            color={completed ? "success" : "primary"}
            variant="outlined"
            label={t(completed ? "chat.compaction.completedStatus" : "chat.compaction.inProgressStatus")}
          />
        </Stack>
        <LinearProgress
          data-testid="context-compaction-linear-progress"
          aria-label={t(completed ? "chat.compaction.completedTitle" : "chat.compaction.inProgressTitle")}
          color={completed ? "success" : "primary"}
          variant={completed ? "determinate" : "indeterminate"}
          value={completed ? 100 : undefined}
          sx={{ height: 6, borderRadius: 999 }}
        />
      </Paper>
    </Box>
  );
}

function ContextCompactionMarker({ row, t }: { row: ChatWaterfallRow; t: TranslateFn }) {
  const free = row.compactionSource === "free";
  const cliName = waterfallCompactionLabel(row.compactionBackend);
  const tooltip = free ? t("chat.compaction.freeMarkerTooltip") : cliName ? t("chat.compaction.nativeMarkerTooltip", { cli: cliName }) : t("chat.compaction.genericTitle");
  return (
    <Tooltip title={tooltip} arrow>
      <Box
        data-testid="context-compaction-marker"
        data-compaction-source={free ? "free" : "native"}
        data-compaction-backend={row.compactionBackend}
        aria-label={tooltip}
        sx={{
          position: "absolute", top: 4, right: 4, zIndex: 1,
          width: 18, height: 18, borderRadius: "50%", display: "grid", placeItems: "center",
          color: free ? "success.main" : "primary.main",
          bgcolor: (theme) => alpha(free ? theme.palette.success.main : theme.palette.primary.main, theme.palette.mode === "dark" ? 0.16 : 0.1),
          animation: "compaction-marker-pulse 2.2s ease-out infinite",
          "html[data-performance-pressure=\"true\"] &": { animation: "none" },
          "html[data-software-rendering=\"true\"] &": { animation: "none" },
          "@keyframes compaction-marker-pulse": {
            "0%": { boxShadow: "0 0 0 0 currentColor" },
            "70%": { boxShadow: "0 0 0 5px transparent" },
            "100%": { boxShadow: "0 0 0 0 transparent" }
          },
          "@media (prefers-reduced-motion: reduce)": { animation: "none" }
        }}
      >
        {free ? <AttachMoneyIcon sx={{ fontSize: 12 }} /> : <CompressIcon sx={{ fontSize: 12 }} />}
      </Box>
    </Tooltip>
  );
}

function ImageGenerationRow({ row, t, expanded, onToggleExpanded }: { row: ChatWaterfallRow; t: TranslateFn; expanded: boolean; onToggleExpanded: () => void }) {
  const image = row.item.images?.[0];
  const [previewOpen, setPreviewOpen] = useState(false);
  if (!image) {
    return (
      <Box data-testid={`workbench-item-${sanitizeTestId(row.item.type)}`} sx={{ display: "flex", justifyContent: "center", minWidth: 0, maxWidth: "100%" }}>
        <Paper
          variant="outlined"
          sx={{
            width: "100%",
            maxWidth: { xs: "100%", xl: "min(86vw, 1240px)" },
            minWidth: 0,
            p: 1,
            borderRadius: 1,
            bgcolor: (theme) => alpha(theme.palette.background.paper, theme.palette.mode === "dark" ? 0.54 : 0.86),
            borderColor: (theme) => alpha(theme.palette.primary.main, theme.palette.mode === "dark" ? 0.28 : 0.2),
            overflow: "hidden"
          }}
        >
          <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 1 }}>
            <ImageIcon fontSize="small" color="primary" />
            <Box sx={{ minWidth: 0, flex: 1 }}>
              <Typography variant="subtitle2" sx={{ fontWeight: 850 }}>
                {t("chat.imageGeneratingTitle")}
              </Typography>
              <Typography variant="caption" color="text.secondary" sx={{ display: "block", overflowWrap: "anywhere" }}>
                {row.text}
              </Typography>
            </Box>
            <CircularProgress size={18} />
          </Stack>
          <Box
            sx={{
              position: "relative",
              minHeight: { xs: 240, sm: 360 },
              borderRadius: 1,
              overflow: "hidden",
              bgcolor: (theme) => alpha(theme.palette.primary.main, theme.palette.mode === "dark" ? 0.1 : 0.06),
              border: "1px solid",
              borderColor: "divider",
              display: "grid",
              placeItems: "center",
              contain: "layout paint"
            }}
          >
            <Stack spacing={1} alignItems="center" sx={{ position: "relative", zIndex: 1 }}>
              <CircularProgress />
              <Typography variant="body2" sx={{ fontWeight: 800 }}>
                {t("chat.imageGenerating")}
              </Typography>
            </Stack>
          </Box>
        </Paper>
      </Box>
    );
  }
  const priceText = image.estimatedCostUsd != null ? formatUsd(image.estimatedCostUsd) : null;
  const unitPriceText = image.unitPriceUsd != null ? `${formatUsd(image.unitPriceUsd)} / image` : null;
  const detailBits = [image.providerName, image.model, image.detail, priceText, unitPriceText].filter(Boolean).join(" · ");
  const prompt = image.revisedPrompt?.trim() || row.text.trim();
  return (
    <Box data-testid={`workbench-item-${sanitizeTestId(row.item.type)}`} sx={{ display: "flex", justifyContent: "center", minWidth: 0, maxWidth: "100%" }}>
      <Paper
        variant="outlined"
        sx={{
          width: "100%",
          maxWidth: { xs: "100%", xl: "min(86vw, 1240px)" },
          minWidth: 0,
          p: 1,
          borderRadius: 1,
          bgcolor: (theme) => alpha(theme.palette.background.paper, theme.palette.mode === "dark" ? 0.54 : 0.86),
          borderColor: (theme) => alpha(theme.palette.primary.main, theme.palette.mode === "dark" ? 0.24 : 0.16),
          boxShadow: (theme) => theme.customShadows?.z1
        }}
      >
        <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 1 }}>
          <ImageIcon fontSize="small" color="primary" />
          <Box sx={{ minWidth: 0, flex: 1 }}>
            <Typography variant="subtitle2" sx={{ fontWeight: 850, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {row.title}
            </Typography>
            <Typography variant="caption" color="text.secondary" sx={{ display: "block", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {detailBits || image.revisedPrompt || row.text}
            </Typography>
          </Box>
          <StatusChip status={row.status} />
          <Tooltip title={expanded ? "Collapse image" : "Expand image"}>
            <IconButton size="small" aria-label={expanded ? "Collapse generated image" : "Expand generated image"} onClick={onToggleExpanded}>
              {expanded ? <UnfoldLessIcon fontSize="small" /> : <UnfoldMoreIcon fontSize="small" />}
            </IconButton>
          </Tooltip>
          <Tooltip title="Download image">
            <IconButton
              size="small"
              aria-label="Download generated image"
              component="a"
              href={image.url}
              download={image.name ?? "generated-image.png"}
              onClick={(event) => event.stopPropagation()}
            >
              <DownloadIcon fontSize="small" />
            </IconButton>
          </Tooltip>
        </Stack>
        {expanded && prompt && (
          <Typography variant="body2" sx={{ mb: 1, color: "text.secondary", overflowWrap: "anywhere" }}>
            {prompt}
          </Typography>
        )}
        <Box
          component="img"
          src={image.url}
          alt={image.name ?? "Generated image"}
          loading="lazy"
          decoding="async"
          onClick={() => setPreviewOpen(true)}
          sx={{
            width: expanded ? "100%" : { xs: 144, sm: 200 },
            height: expanded ? "auto" : { xs: 108, sm: 150 },
            maxHeight: expanded ? "min(70vh, 880px)" : 150,
            objectFit: "contain",
            display: "block",
            borderRadius: 1,
            bgcolor: "background.default",
            cursor: "zoom-in"
          }}
        />
        <ImagePreviewDialog open={previewOpen} image={image} prompt={prompt} onClose={() => setPreviewOpen(false)} t={t} />
      </Paper>
    </Box>
  );
}

function LocalImageViewRow({ row, t, sessionToken, expanded, onToggleExpanded, title = "Image view" }: { row: ChatWaterfallRow; t: TranslateFn; sessionToken?: string | null; expanded: boolean; onToggleExpanded: () => void; title?: string }) {
  const source = row.item.images?.[0];
  const path = source?.url ?? stringValue(isRecord(row.item.payload) ? row.item.payload.path : undefined) ?? "";
  const [thumbnailUrl, setThumbnailUrl] = useState<string | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const thumbnailUrlRef = useRef<string | null>(null);
  const previewUrlRef = useRef<string | null>(null);

  useEffect(() => {
    if (!expanded) return;
    if (!path || !sessionToken) {
      setError(path ? "Image preview is unavailable without an active session" : "Image path is unavailable");
      return;
    }
    const controller = new AbortController();
    setError(null);
    void fetchLocalImage(path, sessionToken, controller.signal)
      .then((blob) => createImageThumbnail(blob, 480))
      .then((blob) => {
        if (controller.signal.aborted) return;
        const url = URL.createObjectURL(blob);
        thumbnailUrlRef.current = url;
        setThumbnailUrl(url);
      })
      .catch((reason) => {
        if (!controller.signal.aborted) setError(attachmentPreviewError(reason));
      });
    return () => {
      controller.abort();
      if (thumbnailUrlRef.current) URL.revokeObjectURL(thumbnailUrlRef.current);
      thumbnailUrlRef.current = null;
      if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current);
      previewUrlRef.current = null;
    };
  }, [expanded, path, sessionToken]);

  function toggleExpanded() {
    if (expanded) {
      closePreview();
      if (thumbnailUrlRef.current) URL.revokeObjectURL(thumbnailUrlRef.current);
      thumbnailUrlRef.current = null;
      setThumbnailUrl(null);
    }
    onToggleExpanded();
  }

  async function openPreview() {
    if (!path || !sessionToken) return;
    if (!previewUrlRef.current) {
      try {
        const blob = await fetchLocalImage(path, sessionToken);
        previewUrlRef.current = URL.createObjectURL(blob);
        setPreviewUrl(previewUrlRef.current);
      } catch (reason) {
        setError(attachmentPreviewError(reason));
        return;
      }
    }
    setPreviewOpen(true);
  }

  function closePreview() {
    setPreviewOpen(false);
  }

  function releasePreviewUrl() {
    if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current);
    previewUrlRef.current = null;
    setPreviewUrl(null);
  }

  return (
    <Box data-testid="workbench-item-imageView" sx={{ display: "flex", justifyContent: "center", minWidth: 0, maxWidth: "100%" }}>
      <Paper variant="outlined" sx={{ width: "100%", maxWidth: 720, minWidth: 0, p: 1, borderRadius: 1 }}>
        <Stack
          component="button"
          type="button"
          aria-label={expanded ? "Collapse image preview" : "Expand image preview"}
          direction="row"
          spacing={1}
          alignItems="center"
          onClick={toggleExpanded}
          sx={{ mb: expanded ? 1 : 0, width: "100%", p: 0, color: "inherit", bgcolor: "transparent", border: 0, font: "inherit", textAlign: "left", borderRadius: 1, cursor: "pointer", "&:hover": { bgcolor: "action.hover" } }}
        >
          <Box sx={{ minWidth: 0, flex: 1, display: "flex", alignItems: "center", gap: 1 }}>
            <ImageIcon fontSize="small" color="primary" />
            <Box sx={{ minWidth: 0, flex: 1 }}>
              <Typography variant="subtitle2" sx={{ fontWeight: 850 }}>{title}</Typography>
              <Typography variant="caption" color="text.secondary" title={path} sx={{ display: "block", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {path}
              </Typography>
            </Box>
          </Box>
          <Box sx={{ width: 34, height: 34, display: "grid", placeItems: "center", flex: "0 0 auto" }}>
            {expanded ? <UnfoldLessIcon fontSize="small" /> : <UnfoldMoreIcon fontSize="small" />}
          </Box>
        </Stack>
        {expanded && (thumbnailUrl ? (
          <Box component="img" src={thumbnailUrl} alt={source?.name ?? path} onClick={() => void openPreview()} loading="lazy" decoding="async" sx={{ width: "100%", maxHeight: 360, objectFit: "contain", display: "block", borderRadius: 1, bgcolor: "background.default", cursor: "zoom-in" }} />
        ) : error ? (
          <Alert severity="warning">{error}</Alert>
        ) : (
          <Box sx={{ height: 180, position: "relative", overflow: "hidden", display: "grid", placeItems: "center", borderRadius: 1, bgcolor: "action.hover", contain: "layout paint" }}>
            <Stack spacing={1} alignItems="center" sx={{ position: "relative", zIndex: 1 }}>
              <CircularProgress size={24} />
              <Typography variant="caption" color="text.secondary">Reading image preview...</Typography>
            </Stack>
          </Box>
        ))}
        {previewUrl && <ImagePreviewDialog open={previewOpen} image={{ url: previewUrl, name: source?.name ?? path, detail: source?.detail }} prompt={path} onClose={closePreview} onExited={releasePreviewUrl} t={t} />}
      </Paper>
    </Box>
  );
}

async function fetchLocalImage(path: string, sessionToken: string, signal?: AbortSignal): Promise<Blob> {
  const response = await fetch("/api/workspace/image", {
    method: "POST",
    headers: { "content-type": "application/json", "x-codex-ui-token": sessionToken },
    body: JSON.stringify({ path }),
    signal
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({})) as { error?: string };
    throw new Error(body.error ?? `Image preview failed (${response.status})`);
  }
  return response.blob();
}

async function createImageThumbnail(blob: Blob, maxWidth: number): Promise<Blob> {
  const bitmap = await createImageBitmap(blob, { resizeWidth: maxWidth, resizeQuality: "high" });
  try {
    const canvas = document.createElement("canvas");
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const context = canvas.getContext("2d", { alpha: false });
    if (!context) throw new Error("Image thumbnail canvas is unavailable");
    context.drawImage(bitmap, 0, 0);
    return await new Promise<Blob>((resolve, reject) => canvas.toBlob((result) => result ? resolve(result) : reject(new Error("Image thumbnail encoding failed")), "image/webp", 0.78));
  } finally {
    bitmap.close();
  }
}

function attachmentPreviewError(error: unknown): string {
  return error instanceof Error && error.message ? error.message : "Image preview failed";
}

function ImagePreviewDialog({
  open,
  image,
  prompt,
  onClose,
  onExited,
  closeAriaLabel,
  t
}: {
  open: boolean;
  image: NonNullable<ChatWaterfallRow["item"]["images"]>[number];
  prompt: string;
  onClose: () => void;
  onExited?: () => void;
  closeAriaLabel?: string;
  t?: TranslateFn;
}) {
  const [zoom, setZoom] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [dragStart, setDragStart] = useState<{ pointerId: number; x: number; y: number; offsetX: number; offsetY: number } | null>(null);

  function reset() {
    setZoom(1);
    setOffset({ x: 0, y: 0 });
  }

  return (
    <Dialog open={open} onClose={onClose} TransitionProps={{ onExited }} maxWidth={false} fullWidth PaperProps={{ sx: { width: "min(96vw, 1440px)", height: "92vh", borderRadius: 1, overflow: "hidden" } }}>
      <Stack direction="row" spacing={1} alignItems="center" sx={{ px: 1.25, py: 1, borderBottom: "1px solid", borderColor: "divider" }}>
        <ImageIcon fontSize="small" color="primary" />
        <Box sx={{ minWidth: 0, flex: 1 }}>
          <Typography variant="subtitle2" sx={{ fontWeight: 850, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {image.name ?? t?.("chat.generatedImage") ?? "Image preview"}
          </Typography>
          <Typography variant="caption" color="text.secondary" sx={{ display: "block", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {prompt}
          </Typography>
        </Box>
        <Tooltip title={t?.("chat.zoomOut") ?? "Zoom out"}>
          <IconButton size="small" onClick={() => setZoom((value) => Math.max(0.25, Number((value - 0.25).toFixed(2))))}>
            <ZoomOutIcon fontSize="small" />
          </IconButton>
        </Tooltip>
        <Chip size="small" label={`${Math.round(zoom * 100)}%`} sx={{ minWidth: 58 }} />
        <Tooltip title={t?.("chat.zoomIn") ?? "Zoom in"}>
          <IconButton size="small" onClick={() => setZoom((value) => Math.min(6, Number((value + 0.25).toFixed(2))))}>
            <ZoomInIcon fontSize="small" />
          </IconButton>
        </Tooltip>
        <Tooltip title={t?.("chat.fitImage") ?? "Fit image"}>
          <IconButton size="small" onClick={reset}>
            <CenterFocusStrongIcon fontSize="small" />
          </IconButton>
        </Tooltip>
        <Tooltip title={t?.("chat.closePreview") ?? "Close preview"}>
          <IconButton size="small" aria-label={closeAriaLabel ?? t?.("chat.closePreview") ?? "Close preview"} onClick={onClose}>
            <CloseIcon fontSize="small" />
          </IconButton>
        </Tooltip>
      </Stack>
      <DialogContent
        sx={{
          p: 0,
          bgcolor: (theme) => alpha(theme.palette.background.default, theme.palette.mode === "dark" ? 0.94 : 0.98),
          overflow: "hidden",
          cursor: zoom > 1 ? (dragStart ? "grabbing" : "grab") : "default",
          touchAction: "none"
        }}
        onPointerDown={(event) => {
          if (zoom <= 1) return;
          event.currentTarget.setPointerCapture(event.pointerId);
          setDragStart({ pointerId: event.pointerId, x: event.clientX, y: event.clientY, offsetX: offset.x, offsetY: offset.y });
        }}
        onPointerMove={(event) => {
          if (!dragStart || dragStart.pointerId !== event.pointerId) return;
          setOffset({
            x: dragStart.offsetX + event.clientX - dragStart.x,
            y: dragStart.offsetY + event.clientY - dragStart.y
          });
        }}
        onPointerUp={(event) => {
          if (dragStart?.pointerId === event.pointerId) {
            setDragStart(null);
          }
        }}
        onWheel={(event) => {
          event.preventDefault();
          const delta = event.deltaY > 0 ? -0.15 : 0.15;
          setZoom((value) => Math.min(6, Math.max(0.25, Number((value + delta).toFixed(2)))));
        }}
      >
        <Box sx={{ width: "100%", height: "100%", display: "grid", placeItems: "center" }}>
          <Box
            component="img"
            src={image.url}
            alt={image.name ?? "Generated image"}
            draggable={false}
            sx={{
              maxWidth: "100%",
              maxHeight: "100%",
              objectFit: "contain",
              transform: `translate(${offset.x}px, ${offset.y}px) scale(${zoom})`,
              transformOrigin: "center",
              transition: dragStart ? "none" : "transform 120ms ease"
            }}
          />
        </Box>
      </DialogContent>
    </Dialog>
  );
}

function ImageAttachments({ row, sessionToken }: { row: ChatWaterfallRow; sessionToken?: string | null }) {
  const images = row.item.images ?? [];
  const [previewImage, setPreviewImage] = useState<(typeof images)[number] | null>(null);
  const [previewOpen, setPreviewOpen] = useState(false);
  if (images.length === 0) {
    return null;
  }
  return (
    <Stack direction="row" spacing={1} sx={{ mt: 1, overflowX: "auto" }}>
      {images.map((image, index) => (
        <Paper key={`${image.url}-${index}`} variant="outlined" sx={{ width: 160, flex: "0 0 auto", overflow: "hidden" }}>
          {isRenderableImageUrl(image.url) ? (
            <Box
              component="img"
              src={image.url}
              alt={image.name ?? `Attached image ${index + 1}`}
              loading="lazy"
              decoding="async"
              onClick={() => {
                setPreviewImage(image);
                setPreviewOpen(true);
              }}
              sx={{ width: "100%", aspectRatio: "4 / 3", objectFit: "cover", display: "block", cursor: "zoom-in" }}
            />
          ) : isLocalDiskPath(image.url) && sessionToken ? (
            <LocalPathImage
              path={image.url}
              name={image.name ?? `Attached image ${index + 1}`}
              detail={image.detail}
              sessionToken={sessionToken}
              onPreview={(blobUrl) => {
                setPreviewImage({ ...image, url: blobUrl });
                setPreviewOpen(true);
              }}
            />
          ) : (
            <Box sx={{ p: 1.25 }}>
              <Typography variant="caption" sx={{ overflowWrap: "anywhere" }}>
                {image.name ?? image.url}
              </Typography>
            </Box>
          )}
        </Paper>
      ))}
      {previewImage && (
        <ImagePreviewDialog
          open={previewOpen}
          image={previewImage}
          prompt={row.text}
          onClose={() => setPreviewOpen(false)}
          onExited={() => setPreviewImage(null)}
          closeAriaLabel="Close attachment preview"
        />
      )}
    </Stack>
  );
}

function isLocalDiskPath(url: string): boolean {
  const value = url.trim();
  if (!value || value.startsWith("[") || value.startsWith("data:") || value.startsWith("blob:")) return false;
  if (/^https?:\/\//i.test(value)) return false;
  return true;
}

function LocalPathImage({ path, name, detail, sessionToken, onPreview }: { path: string; name: string; detail?: string; sessionToken: string; onPreview?: (blobUrl: string) => void }) {
  const [objectUrl, setObjectUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const urlRef = useRef<string | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    setFailed(false);
    setObjectUrl(null);
    void fetchLocalImage(path, sessionToken, controller.signal)
      .then((blob) => {
        if (controller.signal.aborted) return;
        const url = URL.createObjectURL(blob);
        urlRef.current = url;
        setObjectUrl(url);
      })
      .catch(() => {
        if (!controller.signal.aborted) setFailed(true);
      });
    return () => {
      controller.abort();
      if (urlRef.current) URL.revokeObjectURL(urlRef.current);
      urlRef.current = null;
    };
  }, [path, sessionToken]);
  if (failed || !sessionToken) {
    return (
      <Box sx={{ p: 1.25 }}>
        <Typography variant="caption" sx={{ overflowWrap: "anywhere" }}>
          {name ?? path}
        </Typography>
      </Box>
    );
  }
  if (!objectUrl) {
    return (
      <Box sx={{ width: "100%", aspectRatio: "4 / 3", display: "grid", placeItems: "center", bgcolor: "action.hover" }}>
        <CircularProgress size={20} />
      </Box>
    );
  }
  return (
    <Box
      component="img"
      src={objectUrl}
      alt={name}
      title={detail ?? path}
      loading="lazy"
      decoding="async"
      onClick={() => onPreview?.(objectUrl)}
      sx={{ width: "100%", aspectRatio: "4 / 3", objectFit: "cover", display: "block", cursor: "zoom-in" }}
    />
  );
}

function FileAttachments({ row }: { row: ChatWaterfallRow }) {
  const files = row.item.files ?? [];
  if (files.length === 0) {
    return null;
  }
  return (
    <Stack spacing={0.75} sx={{ mt: 1 }}>
      {files.map((file, index) => (
        <Paper
          key={`${file.path ?? file.url ?? file.name}-${index}`}
          variant="outlined"
          sx={{
            display: "flex",
            alignItems: "center",
            gap: 1,
            maxWidth: 520,
            p: 1,
            borderRadius: 1,
            bgcolor: (theme) => alpha(theme.palette.background.default, theme.palette.mode === "dark" ? 0.36 : 0.72)
          }}
        >
          <InsertDriveFileIcon color="action" />
          <Box sx={{ minWidth: 0, flex: 1 }}>
            <Typography variant="body2" sx={{ fontWeight: 750, overflowWrap: "anywhere" }}>
              {file.name}
            </Typography>
            <Typography variant="caption" color="text.secondary" sx={{ display: "block", overflowWrap: "anywhere" }}>
              {[file.mediaType, file.size != null ? formatBytes(file.size) : null, file.path ?? file.url].filter(Boolean).join(" · ")}
            </Typography>
          </Box>
        </Paper>
      ))}
    </Stack>
  );
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  const units = ["KiB", "MiB", "GiB"];
  let value = bytes / 1024;
  let unit = units[0]!;
  for (let index = 1; index < units.length && value >= 1024; index += 1) {
    value /= 1024;
    unit = units[index]!;
  }
  return `${value.toFixed(value >= 10 ? 0 : 1)} ${unit}`;
}

type FileChangeSummary = {
  primaryPath?: string;
  status?: string;
  additions: number;
  deletions: number;
  changes: Array<{ path: string; status?: string; additions?: number; deletions?: number }>;
};

type FileChangeDetail = {
  path?: string;
  status?: string;
  kind?: string;
  additions?: number;
  deletions?: number;
  beforeText?: string;
  afterText?: string;
  unifiedDiff?: string;
  text?: string;
};

type FileMutationAction = "edit" | "write" | "create" | "delete";

function fileChangeSummary(row: ChatWaterfallRow): FileChangeSummary {
  const payload = isRecord(row.item.payload) ? row.item.payload : {};
  const changes = Array.isArray(payload.changes)
    ? payload.changes
        .flatMap((entry) => {
          const change = isRecord(entry) ? entry : {};
          const path = stringValue(change.path) ?? stringValue(change.filePath) ?? stringValue(change.name);
          return path
            ? [
                {
                  path,
                  status: stringValue(change.status) ?? stringValue(change.kind) ?? stringValue(change.type),
                  additions: numberValue(change.additions) ?? numberValue(change.added) ?? numberValue(change.addedLines),
                  deletions: numberValue(change.deletions) ?? numberValue(change.deleted) ?? numberValue(change.removedLines)
                }
              ]
            : [];
        })
    : [];
  const primaryPath = stringValue(payload.path) ?? stringValue(payload.filePath) ?? stringValue(payload.name) ?? changes[0]?.path;
  const details = extractFileChangeDetails(row, payload, primaryPath, changes);
  const payloadAdditions = numberValue(payload.additions) ?? numberValue(payload.added) ?? numberValue(payload.addedLines);
  const payloadDeletions = numberValue(payload.deletions) ?? numberValue(payload.deleted) ?? numberValue(payload.removedLines);
  const detailAdditions = sumNumbers(details.map((detail) => detail.additions));
  const detailDeletions = sumNumbers(details.map((detail) => detail.deletions));
  const changeAdditions = sumNumbers(changes.map((change) => change.additions));
  const changeDeletions = sumNumbers(changes.map((change) => change.deletions));
  const detailChanges = details.flatMap((detail) => (detail.path ? [{ path: detail.path, status: detail.status ?? detail.kind, additions: detail.additions, deletions: detail.deletions }] : []));
  return {
    primaryPath,
    status: row.status ?? stringValue(payload.status) ?? changes[0]?.status,
    additions: payloadAdditions ?? changeAdditions ?? detailAdditions ?? 0,
    deletions: payloadDeletions ?? changeDeletions ?? detailDeletions ?? 0,
    changes: changes.length > 0 ? changes : detailChanges
  };
}

function parseIfJsonString(value: unknown): unknown {
  if (typeof value !== "string") return value;
  const trimmed = value.trim();
  if ((trimmed.startsWith("{") && trimmed.endsWith("}")) || (trimmed.startsWith("[") && trimmed.endsWith("]"))) {
    try {
      return JSON.parse(trimmed);
    } catch {
      return value;
    }
  }
  return value;
}

function extractToolArguments(payload: Record<string, unknown> | null | undefined, row?: ChatWaterfallRow): unknown {
  let parsed: unknown = undefined;
  const argKeys = ["arguments", "input", "parameters", "args", "tool_input", "toolInput", "rawInput", "tool_args", "toolArgs"];
  if (payload) {
    for (const key of argKeys) {
      if (key in payload && payload[key] !== undefined) {
        parsed = parseIfJsonString(payload[key]);
        break;
      }
    }
  }
  if (parsed === undefined) {
    const item = row?.item as Record<string, unknown> | undefined;
    if (item) {
      for (const key of argKeys) {
        if (key in item && item[key] !== undefined) {
          parsed = parseIfJsonString(item[key]);
          break;
        }
      }
    }
  }
  if (isRecord(parsed)) {
    const record: Record<string, unknown> = { ...parsed };
    for (const nestedKey of ["Arguments", ...argKeys]) {
      if (nestedKey in record && typeof record[nestedKey] === "string") {
        record[nestedKey] = parseIfJsonString(record[nestedKey]);
      }
      const nestedVal = record[nestedKey];
      if (isRecord(nestedVal)) {
        Object.assign(record, nestedVal);
      }
    }
    if (isRecord(record.tool_input)) {
      Object.assign(record, record.tool_input as Record<string, unknown>);
    }
    return record;
  }
  return parsed;
}

function extractToolArgumentsRecord(payload: Record<string, unknown> | null | undefined, row?: ChatWaterfallRow): Record<string, unknown> | null {
  const args = extractToolArguments(payload, row);
  return isRecord(args) ? args : null;
}

function fileChangeDetails(row: ChatWaterfallRow, summary: FileChangeSummary): FileChangeDetail[] {
  const payload = isRecord(row.item.payload) ? row.item.payload : {};
  const details = extractFileChangeDetails(row, payload, summary.primaryPath, summary.changes);
  if (details.length > 0) {
    return details;
  }
  if (summary.changes.length > 0) {
    return summary.changes.map((change) => ({ ...change, kind: change.status }));
  }
  return row.text.trim() ? [{ path: summary.primaryPath, status: summary.status, text: row.text.trim() }] : [];
}

function extractFileChangeDetails(
  row: ChatWaterfallRow,
  payload: Record<string, unknown>,
  primaryPath?: string,
  changes: Array<{ path: string; status?: string; additions?: number; deletions?: number }> = []
): FileChangeDetail[] {
  const details: FileChangeDetail[] = [];

  function addDetail(detail: FileChangeDetail | null) {
    if (!detail) {
      return;
    }
    const hasBody = detail.beforeText != null || detail.afterText != null || Boolean(detail.unifiedDiff?.trim()) || Boolean(detail.text?.trim());
    if (!hasBody && !detail.path && !detail.status && !detail.kind) {
      return;
    }
    details.push(detail);
  }

  addDetail(detailFromRecord(payload, primaryPath));

  const args = extractToolArgumentsRecord(payload, row);
  if (args) {
    addDetail(detailFromRecord(args, primaryPath));
  }

  for (const key of ["changes", "fileChanges", "files", "edits", "patches"]) {
    const entries = payload[key];
    if (!Array.isArray(entries)) {
      continue;
    }
    for (const entry of entries) {
      if (isRecord(entry)) {
        const fallback = firstStringValue(entry, ["path", "filePath", "file_path", "name"]) ?? primaryPath;
        addDetail(detailFromRecord(entry, fallback));
      }
    }
  }

  const rowBody = bodyFromText(row.text);
  if (rowBody) {
    const stats = rowBody.unifiedDiff ? diffLineStats(rowBody.unifiedDiff) : undefined;
    const target = details.find((detail) => !detail.beforeText && !detail.afterText && !detail.unifiedDiff && !detail.text && (detail.path === primaryPath || !detail.path));
    const bodyDetail: FileChangeDetail = {
      path: primaryPath,
      status: row.status,
      additions: stats?.additions,
      deletions: stats?.deletions,
      ...rowBody
    };
    if (target) {
      Object.assign(target, bodyDetail, { path: target.path ?? bodyDetail.path, status: target.status ?? bodyDetail.status });
    } else if (!details.some((detail) => sameDetailBody(detail, bodyDetail))) {
      addDetail(bodyDetail);
    }
  }

  if (details.length === 0 && changes.length > 0) {
    for (const change of changes) {
      addDetail({ ...change, kind: change.status });
    }
  }

  return mergeFileDetails(details, primaryPath);
}

function detailFromRecord(record: Record<string, unknown>, fallbackPath?: string, action?: FileMutationAction): FileChangeDetail | null {
  const path = toolFilePath(record) ?? fallbackPath;
  const status = firstStringValue(record, ["status", "kind", "type", "operation"]);
  const beforeText = firstStringValue(record, [
    "beforeText", "oldText", "old_text", "oldContent", "previousText", "originalText",
    "old_string", "oldString", "before", "original",
    "TargetContent", "targetContent", "target_content"
  ]);
  const afterText =
    action === "delete"
      ? undefined
      : firstStringValue(record, [
          "afterText", "newText", "new_text", "newContent", "updatedText", "content",
          "new_source", "newString", "new_string", "after", "replacement",
          "ReplacementContent", "replacementContent", "replacement_content",
          "CodeContent", "codeContent", "code_content"
        ]);
  const deleteBeforeText = action === "delete" ? beforeText ?? firstStringValue(record, ["content", "source", "fileContent"]) : undefined;
  const rawDiff = firstStringValue(record, ["diff", "patch", "unifiedDiff", "gitDiff"]);
  const rawText = firstStringValue(record, ["text", "body", "message"]);
  const diffBody = rawDiff ? normalizeDiffText(rawDiff) : null;
  const textBody = rawText ? bodyFromText(rawText) : null;
  const stats = deleteBeforeText != null || beforeText != null || afterText != null
    ? diffTextStats(deleteBeforeText ?? beforeText ?? "", action === "delete" ? "" : afterText ?? "", path)
    : diffBody
      ? diffLineStats(diffBody)
      : textBody?.unifiedDiff
        ? diffLineStats(textBody.unifiedDiff)
        : undefined;

  const detail: FileChangeDetail = {
    path,
    status,
    additions: numberValue(record.additions) ?? numberValue(record.added) ?? numberValue(record.addedLines) ?? stats?.additions,
    deletions: numberValue(record.deletions) ?? numberValue(record.deleted) ?? numberValue(record.removedLines) ?? stats?.deletions
  };
  if (deleteBeforeText != null) {
    detail.beforeText = deleteBeforeText;
    detail.afterText = "";
  } else if (beforeText != null || afterText != null) {
    detail.beforeText = beforeText ?? "";
    detail.afterText = afterText ?? "";
  } else if (diffBody) {
    detail.unifiedDiff = diffBody;
  } else if (textBody) {
    Object.assign(detail, textBody);
  }
  return detail;
}

function bodyFromText(text: string): Pick<FileChangeDetail, "unifiedDiff" | "text"> | null {
  const normalized = normalizeDiffText(text);
  if (!normalized) {
    return null;
  }
  if (looksLikeDiff(normalized)) {
    return { unifiedDiff: normalized };
  }
  return { text: normalized };
}

function normalizeDiffText(text: string): string | null {
  const trimmed = text.trim();
  if (!trimmed) {
    return null;
  }
  const fenced = /^```(?:diff|patch)?\s*\n([\s\S]*?)\n```$/i.exec(trimmed);
  return (fenced?.[1] ?? trimmed).trimEnd();
}

function looksLikeDiff(text: string): boolean {
  if (/^(diff --git|@@ |index |--- |\+\+\+ )/m.test(text)) {
    return true;
  }
  const stats = diffLineStats(text);
  return stats.additions > 0 || stats.deletions > 0;
}

function mergeFileDetails(details: FileChangeDetail[], primaryPath?: string): FileChangeDetail[] {
  const merged: FileChangeDetail[] = [];
  for (const detail of details) {
    const path = detail.path ?? primaryPath;
    const existingSamePath = merged.find((entry) => (entry.path ?? primaryPath) === path);
    const detailHasBody = detail.beforeText != null || detail.afterText != null || Boolean(detail.unifiedDiff) || Boolean(detail.text);
    const existingHasBody = existingSamePath && (existingSamePath.beforeText != null || existingSamePath.afterText != null || Boolean(existingSamePath.unifiedDiff) || Boolean(existingSamePath.text));
    if (existingSamePath && detailHasBody && !existingHasBody) {
      Object.assign(existingSamePath, detail, { path, status: existingSamePath.status ?? detail.status, kind: existingSamePath.kind ?? detail.kind });
      continue;
    }
    if (existingSamePath && !detailHasBody) {
      existingSamePath.status = existingSamePath.status ?? detail.status;
      existingSamePath.kind = existingSamePath.kind ?? detail.kind;
      existingSamePath.additions = existingSamePath.additions ?? detail.additions;
      existingSamePath.deletions = existingSamePath.deletions ?? detail.deletions;
      continue;
    }
    merged.push({ ...detail, path });
  }
  return merged;
}

function sameDetailBody(left: FileChangeDetail, right: FileChangeDetail): boolean {
  return left.unifiedDiff === right.unifiedDiff && left.text === right.text && left.beforeText === right.beforeText && left.afterText === right.afterText;
}

export function toolFileDetails(row: ChatWaterfallRow): FileChangeDetail[] {
  const payload = isRecord(row.item.payload) ? row.item.payload : (isRecord(row.item) ? (row.item as Record<string, unknown>) : {});
  const action = fileMutationAction(row, payload);
  if (!action) {
    return [];
  }

  const args = isSaVmToolPayload(payload, row) ? unwrapToolArgs(payload, row) : extractToolArgumentsRecord(payload, row);
  const result = isRecord(payload.result)
    ? payload.result
    : (isRecord((row.item as any)?.result)
        ? (row.item as any).result
        : payload.output != null || (row.item as any)?.output != null
          ? { content: payload.output ?? (row.item as any)?.output }
          : null);
  const structuredContent = result && isRecord(result.structuredContent) ? result.structuredContent : null;
  const fallbackPath =
    toolFilePath(args) ??
    toolFilePath(structuredContent) ??
    toolFilePath(result) ??
    toolFilePath(payload);
  const details: FileChangeDetail[] = [];

  function addRecord(record: Record<string, unknown> | null) {
    if (!record) {
      return;
    }
    const detail = detailFromRecord(record, fallbackPath, action ?? undefined);
    if (!detail) {
      return;
    }
    const normalized = normalizeToolDetailPath(detail, fallbackPath, row, payload);
    if (details.some((existing) => existing.path === normalized.path && sameDetailBody(existing, normalized))) {
      return;
    }
    details.push(normalized);
  }

  addRecord(args);
  addRecord(structuredContent);
  addRecord(result);

  for (const source of [args, structuredContent, result]) {
    if (!source) {
      continue;
    }
    for (const key of ["changes", "fileChanges", "files", "edits", "patches"]) {
      const entries = source[key];
      if (!Array.isArray(entries)) {
        continue;
      }
      for (const entry of entries) {
        if (isRecord(entry)) {
          addRecord(entry);
        }
      }
    }
  }

  return mergeFileDetails(details, fallbackPath);
}

function normalizeToolDetailPath(
  detail: FileChangeDetail,
  fallbackPath: string | undefined,
  row: ChatWaterfallRow,
  payload: Record<string, unknown>
): FileChangeDetail {
  const toolName = toolNameParts(row, payload).map(normalizeToolToken);
  const pathLooksLikeToolName = detail.path ? toolName.includes(normalizeToolToken(detail.path)) : false;
  return pathLooksLikeToolName && fallbackPath ? { ...detail, path: fallbackPath } : detail;
}

function toolFilePath(record: Record<string, unknown> | null): string | undefined {
  if (!record) {
    return undefined;
  }
  const direct = firstStringValue(record, [
    "TargetFile",
    "targetFile",
    "target_file",
    "AbsolutePath",
    "absolutePath",
    "absolute_path",
    "path",
    "filePath",
    "file_path",
    "filename",
    "file_name",
    "fileName",
    "file",
    "target",
    "destination",
    "dest",
    "notebook_path"
  ]) ?? firstStringValue(isRecord(record.file) ? record.file : {}, ["path", "name", "TargetFile", "targetFile"]);
  if (direct) return direct;
  for (const key of ["Arguments", "arguments", "input"]) {
    const nested = parseIfJsonString(record[key]);
    if (isRecord(nested)) {
      const nestedPath = toolFilePath(nested);
      if (nestedPath) return nestedPath;
    }
  }
  return undefined;
}

function fileMutationSummary(row: ChatWaterfallRow, payload: Record<string, unknown>): { path?: string; additions: number; deletions: number } | null {
  if (!fileMutationAction(row, payload)) {
    return null;
  }
  const details = toolFileDetails(row);
  const args = isSaVmToolPayload(payload, row) ? unwrapToolArgs(payload, row) : extractToolArgumentsRecord(payload, row);
  const path = details.find((detail) => detail.path)?.path
    ?? toolFilePath(args)
    ?? toolFilePath(payload)
    ?? toolFilePath(isRecord((row.item as any)?.input) ? (row.item as any).input : null);
  const additions = sumNumbers(details.map((detail) => detail.additions)) ?? 0;
  const deletions = sumNumbers(details.map((detail) => detail.deletions)) ?? 0;
  return path || additions > 0 || deletions > 0 ? { path, additions, deletions } : null;
}

function fileMutationAction(row: ChatWaterfallRow, payload: Record<string, unknown>): FileMutationAction | null {
  const names = toolNameParts(row, payload).map(normalizeToolToken).filter(Boolean);
  if (names.length === 0) {
    return null;
  }
  if (names.some((name) => /(^|_)(delete|remove|unlink|erase|rm)($|_)/.test(name))) {
    return "delete";
  }
  if (names.some((name) => /(^|_)(edit|patch|modify|replace|apply_patch|notebookedit)($|_)/.test(name))) {
    return "edit";
  }
  if (names.some((name) => /(^|_)(create|new|add)($|_)/.test(name))) {
    return "create";
  }
  if (names.some((name) => /(^|_)(write|save|append)($|_)/.test(name))) {
    return "write";
  }
  return null;
}

function toolNameParts(row: ChatWaterfallRow, payload: Record<string, unknown>): string[] {
  const item = row.item as Record<string, unknown> | undefined;
  const args = isSaVmToolPayload(payload, row) ? unwrapToolArgs(payload, row) : extractToolArgumentsRecord(payload, row);
  const parts = [
    firstStringValue(payload, ["tool", "name", "method", "namespace", "action"]),
    firstStringValue(isRecord(payload.function) ? payload.function : {}, ["name"]),
    item ? firstStringValue(item, ["tool", "name", "toolName", "method"]) : undefined,
    row.title,
    args ? firstStringValue(args, ["action", "Action"]) : undefined,
    args ? firstStringValue(args, ["ToolName", "toolName", "tool_name", "tool"]) : undefined
  ];
  return parts.filter((part): part is string => Boolean(part));
}

function normalizeToolToken(value: string): string {
  return value
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .replace(/[^A-Za-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .toLowerCase();
}

type ToolPayloadImage = NonNullable<ChatWaterfallRow["item"]["images"]>[number];

function renderToolPayload(row: ChatWaterfallRow, fileDetails: FileChangeDetail[] = [], toolImages: ToolPayloadImage[] = [], sessionToken?: string | null) {
  const payload = isRecord(row.item.payload) ? row.item.payload : (isRecord(row.item) ? (row.item as Record<string, unknown>) : null);
  if (!payload) {
    return (
      <Box sx={{ mt: 1, pt: 1, borderTop: "1px solid", borderColor: "divider" }}>
        {toolImages.length > 0 && <ToolImagePreviewStrip images={toolImages} sessionToken={sessionToken} />}
        {row.text ? <MarkdownMessage text={row.text} /> : null}
      </Box>
    );
  }
  const args = extractToolArguments(payload, row);
  const result = isRecord(payload.result)
    ? payload.result
    : (isRecord((row.item as any)?.result)
        ? (row.item as any).result
        : payload.output != null || (row.item as any)?.output != null
          ? { content: payload.output ?? (row.item as any)?.output }
          : null);
  const errorMessage = payload.error == null
    ? ((row.item as any)?.error == null ? undefined : formatErrorText((row.item as any).error))
    : formatErrorText(payload.error);

  return (
    <Box sx={{ mt: 1, pt: 1, borderTop: "1px solid", borderColor: "divider" }}>
      {fileDetails.length > 0 && (
        <Box data-testid="tool-file-diff-details" sx={{ mb: 1 }}>
          <Stack spacing={1}>
            {fileDetails.map((detail, index) => (
              <FileChangeDetailBlock key={`${detail.path ?? "tool-file"}-${index}`} detail={detail} />
            ))}
          </Stack>
        </Box>
      )}
      {toolImages.length > 0 && <ToolImagePreviewStrip images={toolImages} sessionToken={sessionToken} />}
      {row.text && <MarkdownMessage text={row.text} />}
      {args != null && (
        <Box sx={{ mb: 1 }}>
          <Typography variant="caption" color="text.secondary">
            Arguments
          </Typography>
          <Typography component="pre" sx={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere", fontSize: 12, m: 0, mt: 0.5 }}>
            {prettyToolJson(args)}
          </Typography>
        </Box>
      )}
      {errorMessage && (
        <Alert severity="error" sx={{ mb: 1 }}>
          {errorMessage}
        </Alert>
      )}
      {result && (
        <Box>
          <Typography variant="caption" color="text.secondary">
            Result
          </Typography>
          {result.content != null && (
            <Typography component="pre" sx={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere", fontSize: 12, m: 0, mt: 0.5 }}>
              {prettyToolJson(result.content)}
            </Typography>
          )}
          {result.structuredContent != null && (
            <Typography component="pre" sx={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere", fontSize: 12, m: 0, mt: 0.5 }}>
              {prettyToolJson(result.structuredContent)}
            </Typography>
          )}
        </Box>
      )}
    </Box>
  );
}

function ToolImagePreviewStrip({ images, sessionToken }: { images: ToolPayloadImage[]; sessionToken?: string | null }) {
  const visibleImages = images.slice(0, MAX_TOOL_IMAGE_PREVIEWS);
  const hiddenCount = images.length - visibleImages.length;
  return (
    <Box sx={{ mb: 1 }}>
      <Typography variant="caption" color="text.secondary">
        Image output
      </Typography>
      <Stack direction="row" spacing={1} sx={{ mt: 0.75, overflowX: "auto", pb: 0.25 }}>
        {visibleImages.map((image, index) => (
          <Paper
            key={`${image.url}-${index}`}
            variant="outlined"
            sx={{
              width: { xs: 180, sm: 220 },
              flex: "0 0 auto",
              overflow: "hidden",
              borderRadius: 1,
              bgcolor: (theme) => alpha(theme.palette.background.default, theme.palette.mode === "dark" ? 0.36 : 0.72)
            }}
          >
            {isRenderableImageUrl(image.url) ? (
              <Box
                component="img"
                src={image.url}
                alt={image.name ?? `Tool image ${index + 1}`}
                loading="lazy"
                decoding="async"
                sx={{ width: "100%", aspectRatio: "16 / 10", objectFit: "contain", display: "block", bgcolor: "background.default" }}
              />
            ) : isLocalDiskPath(image.url) && sessionToken ? (
              <LocalPathImage
                path={image.url}
                name={image.name ?? `Tool image ${index + 1}`}
                detail={image.detail}
                sessionToken={sessionToken}
              />
            ) : (
              <Box sx={{ p: 1.25 }}>
                <Typography variant="caption" sx={{ overflowWrap: "anywhere" }}>
                  {image.name ?? image.url}
                </Typography>
              </Box>
            )}
            {(image.name || image.detail) && (
              <Typography variant="caption" sx={{ display: "block", px: 0.75, py: 0.5, color: "text.secondary", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {image.name ?? image.detail}
              </Typography>
            )}
          </Paper>
        ))}
        {hiddenCount > 0 && (
          <Paper variant="outlined" sx={{ width: 120, flex: "0 0 auto", display: "grid", placeItems: "center", borderRadius: 1 }}>
            <Typography variant="caption" color="text.secondary">
              +{hiddenCount} more
            </Typography>
          </Paper>
        )}
      </Stack>
    </Box>
  );
}

const MAX_TOOL_IMAGE_PREVIEWS = 8;
const MAX_TOOL_IMAGE_OUTPUTS = 24;
const MAX_TOOL_IMAGE_SCAN_NODES = 700;
const MAX_TOOL_JSON_DEPTH = 8;
const MAX_TOOL_JSON_ARRAY_ITEMS = 80;
const MAX_TOOL_JSON_OBJECT_KEYS = 80;
const MAX_TOOL_JSON_STRING_LENGTH = 12000;
const IMAGE_DATA_STRING_THRESHOLD = 1024;

function toolPayloadImages(row: ChatWaterfallRow): ToolPayloadImage[] {
  const images: ToolPayloadImage[] = [];
  const seenUrls = new Set<string>();
  const scanState = { nodes: 0 };
  for (const image of row.item.images ?? []) {
    addToolImage(images, seenUrls, image);
  }
  if (isRecord(row.item.payload)) {
    collectToolImages(row.item.payload, images, seenUrls, scanState, 0);
  }
  return images;
}

function collectToolImages(value: unknown, images: ToolPayloadImage[], seenUrls: Set<string>, scanState: { nodes: number }, depth: number) {
  if (images.length >= MAX_TOOL_IMAGE_OUTPUTS || depth > MAX_TOOL_JSON_DEPTH || scanState.nodes >= MAX_TOOL_IMAGE_SCAN_NODES) {
    return;
  }
  if (!value || typeof value !== "object") {
    return;
  }
  scanState.nodes += 1;
  if (Array.isArray(value)) {
    for (const entry of value.slice(0, MAX_TOOL_JSON_ARRAY_ITEMS)) {
      collectToolImages(entry, images, seenUrls, scanState, depth + 1);
      if (images.length >= MAX_TOOL_IMAGE_OUTPUTS || scanState.nodes >= MAX_TOOL_IMAGE_SCAN_NODES) {
        break;
      }
    }
    return;
  }
  const record = value as Record<string, unknown>;
  addToolImage(images, seenUrls, toolImageFromRecord(record));
  for (const entry of Object.values(record).slice(0, MAX_TOOL_JSON_OBJECT_KEYS)) {
    collectToolImages(entry, images, seenUrls, scanState, depth + 1);
    if (images.length >= MAX_TOOL_IMAGE_OUTPUTS || scanState.nodes >= MAX_TOOL_IMAGE_SCAN_NODES) {
      break;
    }
  }
}

function toolImageFromRecord(record: Record<string, unknown>): ToolPayloadImage | null {
  const type = stringValue(record.type)?.toLowerCase();
  const mimeType = firstStringValue(record, ["mimeType", "mime_type", "mediaType", "media_type"]);
  const name = firstStringValue(record, ["name", "filename", "fileName", "path"]);
  const detail = firstStringValue(record, ["detail", "image_detail", "imageDetail", "output_hint", "outputHint"]);
  const directUrl = firstImageUrl(record);
  if (directUrl && (type == null || type.includes("image") || isRenderableImageUrl(directUrl))) {
    return { url: directUrl, name, detail };
  }
  // Path-only persisted image records (localImage blocks, image_generation
  // savedPath) carry no url: only image-typed records may fall back to
  // disk-path keys — typeless tool args routinely carry `path`/`filePath`
  // (read_file/edit_file) and must never become "images".
  if (type?.includes("image")) {
    const diskPath = firstDiskPath(record);
    if (diskPath) return { url: diskPath, name, detail };
  }
  if (mimeType?.toLowerCase().startsWith("image/")) {
    const data = firstStringValue(record, ["data", "b64_json", "b64Json", "base64", "image"]);
    if (data) {
      return { url: data.startsWith("data:image/") ? data : `data:${mimeType};base64,${data}`, name, detail };
    }
  }
  return null;
}

function firstImageUrl(record: Record<string, unknown>): string | undefined {
  for (const key of ["url", "image_url", "imageUrl", "uri"]) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
    if (isRecord(value)) {
      const nestedUrl = firstStringValue(value, ["url", "image_url", "imageUrl"]);
      if (nestedUrl) {
        return nestedUrl;
      }
    }
  }
  // Path-only persisted image records (localImage blocks, image_generation
  // savedPath) carry no url: resolved only for image-typed records via
  // firstDiskPath so typeless tool args with `path` keys are never images.
  return undefined;
}

function firstDiskPath(record: Record<string, unknown>): string | undefined {
  for (const key of ["savedPath", "saved_path", "path", "filePath", "file_path"]) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }
  return undefined;
}

function addToolImage(images: ToolPayloadImage[], seenUrls: Set<string>, image?: ToolPayloadImage | null) {
  if (!image?.url || seenUrls.has(image.url) || images.length >= MAX_TOOL_IMAGE_OUTPUTS) {
    return;
  }
  seenUrls.add(image.url);
  images.push(image);
}

function sanitizeTestId(value: string): string {
  return value.replace(/[^A-Za-z0-9_-]+/g, "-");
}

const expandHintButtonSx = {
  borderRadius: 1,
  minWidth: 0,
  px: 0.75,
  color: "text.disabled",
  fontWeight: 650,
  "&:hover": {
    color: "text.secondary",
    bgcolor: "action.hover"
  }
};

function StatusChip({ status }: { status?: string }) {
  if (!status || isSilentStatus(status)) {
    return null;
  }
  return <Chip size="small" label={status} />;
}

function activityStatus(status?: string): { label: string; color: string; live: boolean } {
  const normalized = status?.trim().toLowerCase() ?? "";
  if (["inprogress", "in_progress", "running", "pending", "started", "pendinginit"].includes(normalized)) {
    return { label: "running", color: "#f59e0b", live: true };
  }
  if (["failed", "error", "cancelled", "canceled", "interrupted"].includes(normalized)) {
    return { label: normalized || "failed", color: "#ef4444", live: false };
  }
  return { label: normalized || "completed", color: "#22c55e", live: false };
}

export function activitySummary(row: ChatWaterfallRow): { label: string; detail?: string } {
  const payload = isRecord(row.item.payload) ? row.item.payload : (isRecord(row.item) ? (row.item as Record<string, unknown>) : {});
  if (row.kind === "commandExecution") {
    return commandActivitySummary(payload, row);
  }
  if (row.kind === "fileChange") {
    const summary = fileChangeSummary(row);
    const label = fileActivityLabel(row, payload);
    const path = summary.primaryPath ?? firstStringValue(payload, ["path", "filePath", "name"]) ?? compactText(row.text);
    const stats = fileChangeStatsLabel(summary.additions, summary.deletions);
    return { label, detail: path ? `${path}${stats ? ` ${stats}` : ""}` : stats };
  }
  if (isSaVmToolPayload(payload, row)) {
    const act = saVmToolActivity(payload, row);
    const isEdit = act.label === "vm-edit" || act.label === "mcptool-edit" || act.label.endsWith("-edit");
    if (isEdit) {
      const summary = fileMutationSummary(row, payload);
      const targetPath = act.detail || summary?.path;
      if (summary && targetPath) {
        const stats = fileChangeStatsLabel(summary.additions, summary.deletions);
        if (stats && !targetPath.includes(stats)) {
          return {
            label: act.label,
            detail: `${targetPath} ${stats}`
          };
        }
      }
    }
    return act;
  }
  const label = toolActivityLabel(row, payload);
  if (row.kind === "toolCall") {
    const summary = fileMutationSummary(row, payload);
    if (summary) {
      const stats = fileChangeStatsLabel(summary.additions, summary.deletions);
      return {
        label: fileMutationActivityLabel(row, payload),
        detail: summary.path ? `${summary.path}${stats ? ` ${stats}` : ""}` : stats
      };
    }
  }
  return { label, detail: toolActivityDetail(payload, row) };
}

function commandActivitySummary(payload: Record<string, unknown>, row: ChatWaterfallRow): { label: string; detail?: string } {
  const terminalInteraction = isRecord(payload.terminalInteraction) ? payload.terminalInteraction : null;
  if (terminalInteraction) {
    const stdin = typeof terminalInteraction.stdin === "string" ? terminalInteraction.stdin : "";
    return {
      label: stdin.length === 0 ? "Waited for background terminal" : "Interacted with background terminal",
      detail: commandSummary(payload, row)
    };
  }

  const rawActions = Array.isArray(payload.commandActions)
    ? payload.commandActions
    : Array.isArray(payload.command_actions)
      ? payload.command_actions
      : [];
  const actions = rawActions.filter(isRecord);
  const actionTypes = actions.map((action) => normalizeCommandActionType(firstStringValue(action, ["type", "kind"]) ?? "unknown"));
  const live = activityStatus(row.status).live;

  if (actions.length > 0 && actionTypes.every((type) => type === "read")) {
    const names = uniqueStrings(actions.map((action) => firstStringValue(action, ["name", "path", "command"])));
    return { label: "Read", detail: names.join(", ") || commandSummary(payload, row) };
  }
  if (actions.length === 1 && actionTypes[0] === "listfiles") {
    return { label: "List", detail: firstStringValue(actions[0]!, ["path", "command"]) ?? commandSummary(payload, row) };
  }
  if (actions.length === 1 && actionTypes[0] === "search") {
    const query = firstStringValue(actions[0]!, ["query"]);
    const path = firstStringValue(actions[0]!, ["path"]);
    const detail = query && path ? `${query} in ${path}` : query ?? path ?? firstStringValue(actions[0]!, ["command"]);
    return { label: "Search", detail: detail ?? commandSummary(payload, row) };
  }
  if (actions.length > 0 && actionTypes.every((type) => ["read", "listfiles", "search"].includes(type))) {
    return { label: live ? "Exploring" : "Explored", detail: commandSummary(payload, row) };
  }
  return { label: live ? "Running" : "Ran", detail: commandSummary(payload, row) };
}

function commandSummary(payload: Record<string, unknown>, row: ChatWaterfallRow): string | undefined {
  const command = firstStringValue(payload, ["command", "cmd", "commands", "commandLine"]);
  if (command) {
    return commandForDisplay(command);
  }
  const action = isRecord(payload.action) ? payload.action : {};
  const actionCommand = firstStringValue(action, ["command", "cmd"]);
  if (actionCommand) {
    return commandForDisplay(actionCommand);
  }
  if (Array.isArray(payload.command)) {
    return commandForDisplay(payload.command.map(String).join(" "));
  }
  return compactText(row.text) || row.title;
}

function fileActivityLabel(row: ChatWaterfallRow, payload: Record<string, unknown>): string {
  const type = [row.title, row.status, firstStringValue(payload, ["type", "kind", "status"])].join(" ").toLowerCase();
  if (activityStatus(row.status).live) return "Editing";
  if (type.includes("new") || type.includes("create") || type.includes("add")) return "Added";
  if (type.includes("delete") || type.includes("remove")) return "Deleted";
  if (type.includes("read")) return "Read";
  return "Edited";
}

function fileMutationActivityLabel(row: ChatWaterfallRow, payload: Record<string, unknown>): string {
  const action = fileMutationAction(row, payload);
  const live = activityStatus(row.status).live;
  if (action === "delete") return live ? "Deleting" : "Deleted";
  if (action === "create") return live ? "Adding" : "Added";
  if (action === "write") return live ? "Writing" : "Wrote";
  return live ? "Editing" : "Edited";
}

function toolActivityLabel(row: ChatWaterfallRow, payload: Record<string, unknown>): string {
  const item = row.item as Record<string, unknown> | undefined;
  const args = extractToolArgumentsRecord(payload, row);
  const innerName = args ? firstStringValue(args, ["tool_name", "toolName", "ToolName", "tool", "action"]) : undefined;
  const detectedRaw = firstStringValue(payload, ["tool", "name", "method", "namespace", "action"])
    ?? firstStringValue(isRecord(payload.function) ? payload.function : {}, ["name"])
    ?? (item ? firstStringValue(item, ["tool", "name", "toolName", "method"]) : undefined)
    ?? row.title ?? "";
  const raw = (detectedRaw && detectedRaw.toLowerCase() !== "use_tool" ? detectedRaw : (innerName ?? detectedRaw)) || "";
  const normalized = normalizeToolToken(raw);
  if (normalized.includes("search") || normalized.includes("grep") || normalized.includes("rg")) return "Search";
  if (normalized.includes("find")) return "Find";
  if (normalized.includes("read") || normalized.includes("view")) return "Read";
  if (normalized.includes("write")) return "Write";
  if (normalized.includes("edit") || normalized.includes("patch") || normalized.includes("replace")) return "Edit";
  if (normalized.includes("delete") || normalized.includes("remove") || normalized.includes("unlink")) return "Delete";
  if (normalized.includes("new") || normalized.includes("create")) return "New";
  if (normalized.includes("command") || normalized.includes("bash") || normalized.includes("shell") || normalized.includes("exec") || normalized.includes("run")) return "Command";
  if (normalized.includes("list") || normalized.includes("dir")) return "List";
  if (normalized.includes("task") || normalized.includes("agent")) return "ManageTask";
  if (normalized.includes("question") || normalized.includes("ask")) return "AskQuestion";
  return toPascalLabel(raw || "Tool");
}

function toolActivityDetail(payload: Record<string, unknown>, row: ChatWaterfallRow): string | undefined {
  const args = extractToolArgumentsRecord(payload, row) ?? (isRecord(payload) ? payload : null);
  const toolTokens = toolNameParts(row, payload).map(normalizeToolToken);

  if (args) {
    const filePath = toolFilePath(args);
    const startLine = args.StartLine ?? args.startLine ?? args.start_line;
    const endLine = args.EndLine ?? args.endLine ?? args.end_line;
    if (filePath) {
      if (startLine != null && endLine != null) {
        return `${filePath}:${startLine}-${endLine}`;
      }
      if (startLine != null) {
        return `${filePath}:${startLine}`;
      }
      return filePath;
    }

    const query = firstStringValue(args, ["Query", "query", "pattern", "Pattern", "search"]);
    const searchDir = firstStringValue(args, [
      "SearchDirectory", "searchDirectory", "search_directory",
      "SearchPath", "searchPath", "search_path",
      "DirectoryPath", "directoryPath", "directory_path",
      "dir", "directory", "cwd"
    ]);
    if (query && searchDir) {
      return `"${query}" in ${searchDir}`;
    }
    if (query) {
      return `"${query}"`;
    }

    const command = firstStringValue(args, ["CommandLine", "commandLine", "command_line", "cmd", "command", "commands"]);
    if (command) {
      return commandForDisplay(command);
    }

    // Some CLIs batch shell invocations (e.g. cline run_commands).
    const commandsValue = (args as Record<string, unknown>)["commands"];
    if (typeof commandsValue === "string" && commandsValue.trim()) {
      return commandForDisplay(commandsValue);
    }
    if (Array.isArray(commandsValue)) {
      const list = commandsValue.filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0);
      if (list.length > 0) {
        return commandForDisplay(list.join(" && "));
      }
    }

    const url = firstStringValue(args, ["Url", "url", "uri", "endpoint"]);
    if (url) {
      return url;
    }

    if (searchDir) {
      return searchDir;
    }

    if (Array.isArray(args.questions) && args.questions.length > 0) {
      const firstQ = args.questions[0];
      const qText = isRecord(firstQ) ? firstStringValue(firstQ, ["question", "title"]) : String(firstQ);
      if (qText) return compactText(qText);
    }

    const prompt = firstStringValue(args, ["Prompt", "prompt", "Instruction", "instruction", "Description", "description", "message", "text"]);
    if (prompt) {
      return compactText(prompt);
    }

    const action = firstStringValue(args, ["Action", "action"]);
    const taskId = firstStringValue(args, ["TaskId", "taskId", "task_id", "id"]);
    if (action && taskId) {
      return `${action} ${taskId}`;
    }
    if (action) {
      return action;
    }

    if (Array.isArray(args.Subagents) && args.Subagents.length > 0) {
      const firstSub = args.Subagents[0];
      const subRole = isRecord(firstSub) ? firstStringValue(firstSub, ["Role", "TypeName", "role", "name"]) : undefined;
      return subRole ? `${subRole} (${args.Subagents.length} agent${args.Subagents.length > 1 ? "s" : ""})` : `${args.Subagents.length} subagents`;
    }
  }

  const text = compactText(row.text);
  if (text && !toolTokens.includes(normalizeToolToken(text))) {
    return text;
  }
  return undefined;
}

function firstStringValue(record: Record<string, unknown>, keys: string[]): string | undefined {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }
  return undefined;
}

function compactText(value: string): string | undefined {
  const compact = value.trim().split(/\r?\n/).find((line) => line.trim())?.trim();
  return compact || undefined;
}

function uniqueStrings(values: Array<string | undefined>): string[] {
  return [...new Set(values.filter((value): value is string => Boolean(value)))];
}

function normalizeCommandActionType(value: string): string {
  return normalizeToolToken(value).replaceAll("_", "");
}

function toPascalLabel(value: string): string {
  return value
    .replace(/^[^A-Za-z0-9]+|[^A-Za-z0-9]+$/g, "")
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean)
    .slice(-2)
    .map((part) => `${part.slice(0, 1).toUpperCase()}${part.slice(1)}`)
    .join("") || "Tool";
}

function isSilentStatus(status: string): boolean {
  return ["completed", "complete", "done", "success", "shutdown"].includes(status.trim().toLowerCase());
}

function isRenderableImageUrl(url: string): boolean {
  return isImageLikeDataUrl(url) || url.startsWith("blob:") || url.startsWith("http://") || url.startsWith("https://");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function numberValue(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.max(0, Math.floor(value));
  }
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? Math.max(0, Math.floor(parsed)) : undefined;
  }
  return undefined;
}

function sumNumbers(values: Array<number | undefined>): number | undefined {
  const present = values.filter((value): value is number => value != null);
  return present.length > 0 ? present.reduce((total, value) => total + value, 0) : undefined;
}

function prettyJson(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }
  try {
    return JSON.stringify(value, null, 2) ?? "";
  } catch {
    return String(value);
  }
}

function prettyToolJson(value: unknown): string {
  try {
    const safeValue = sanitizeToolJsonValue(value, undefined, new WeakSet<object>(), 0);
    return typeof safeValue === "string" ? safeValue : JSON.stringify(safeValue, null, 2) ?? "";
  } catch {
    return "[tool payload omitted]";
  }
}

function sanitizeToolJsonValue(value: unknown, key: string | undefined, seen: WeakSet<object>, depth: number): unknown {
  if (typeof value === "string") {
    return sanitizeToolJsonString(value, key);
  }
  if (!value || typeof value !== "object") {
    return value;
  }
  if (seen.has(value)) {
    return "[circular reference omitted]";
  }
  if (depth >= MAX_TOOL_JSON_DEPTH) {
    return Array.isArray(value) ? "[array depth omitted]" : "[object depth omitted]";
  }
  seen.add(value);
  if (Array.isArray(value)) {
    const safeItems = value.slice(0, MAX_TOOL_JSON_ARRAY_ITEMS).map((entry) => sanitizeToolJsonValue(entry, key, seen, depth + 1));
    if (value.length > MAX_TOOL_JSON_ARRAY_ITEMS) {
      safeItems.push(`[${value.length - MAX_TOOL_JSON_ARRAY_ITEMS} more items omitted]`);
    }
    return safeItems;
  }
  const safeRecord: Record<string, unknown> = {};
  const entries = Object.entries(value as Record<string, unknown>);
  for (const [entryKey, entryValue] of entries.slice(0, MAX_TOOL_JSON_OBJECT_KEYS)) {
    safeRecord[entryKey] = sanitizeToolJsonValue(entryValue, entryKey, seen, depth + 1);
  }
  if (entries.length > MAX_TOOL_JSON_OBJECT_KEYS) {
    safeRecord.__omitted = `${entries.length - MAX_TOOL_JSON_OBJECT_KEYS} more keys`;
  }
  return safeRecord;
}

function sanitizeToolJsonString(value: string, key?: string): string {
  if (isImageLikeDataUrl(value)) {
    return `[image data URL omitted, about ${formatByteCount(estimatedBase64Bytes(dataUrlPayload(value)))}]`;
  }
  if (value.length > IMAGE_DATA_STRING_THRESHOLD && isLikelyImagePayloadKey(key) && looksLikeBase64Payload(value)) {
    return `[image data omitted, about ${formatByteCount(estimatedBase64Bytes(value))}]`;
  }
  if (value.length > MAX_TOOL_JSON_STRING_LENGTH) {
    return `${value.slice(0, MAX_TOOL_JSON_STRING_LENGTH)}\n[truncated ${formatByteCount(value.length - MAX_TOOL_JSON_STRING_LENGTH)} of text]`;
  }
  return value;
}

function isLikelyImagePayloadKey(key?: string): boolean {
  if (!key) {
    return false;
  }
  return /image|img|b64|base64|data|screenshot|snapshot|thumbnail/i.test(key);
}

function isImageLikeDataUrl(value: string): boolean {
  return /^data:(image\/[a-z0-9.+-]+|application\/octet-stream);base64,/i.test(value);
}

function dataUrlPayload(value: string): string {
  const commaIndex = value.indexOf(",");
  return commaIndex >= 0 ? value.slice(commaIndex + 1) : value;
}

function looksLikeBase64Payload(value: string): boolean {
  if (value.length < 4096) {
    return false;
  }
  return /^[A-Za-z0-9+/=\r\n]+$/.test(value.slice(0, 768));
}

function estimatedBase64Bytes(value: string): number {
  const compactLength = value.replace(/\s/g, "").length;
  return Math.max(0, Math.floor((compactLength * 3) / 4));
}

function formatByteCount(bytes: number): string {
  if (bytes >= 1024 * 1024) {
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }
  if (bytes >= 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`;
  }
  return `${bytes} B`;
}

function formatErrorText(error: unknown): string {
  if (typeof error === "string") {
    return error;
  }
  if (error instanceof Error) {
    return error.message;
  }
  if (isRecord(error)) {
    for (const key of ["message", "error", "detail", "reason"]) {
      const value = error[key];
      if (typeof value === "string" && value.trim()) {
        return value;
      }
      if (isRecord(value)) {
        return formatErrorText(value);
      }
    }
    return prettyJson(error);
  }
  return String(error);
}

const COMMAND_GROUP_INITIAL_VISIBLE = 24;
const COMMAND_GROUP_VISIBLE_STEP = 24;
const COMMAND_OUTPUT_MAX_LINES = 160;
const LIVE_COMMAND_OUTPUT_MAX_LINES = 80;
const COMMAND_OUTPUT_MAX_CHARS = 20_000;
const LIVE_COMMAND_OUTPUT_MAX_CHARS = 12_000;

export type CommandOutputPreview = {
  text: string;
  collapsible: boolean;
  totalChars: number;
  totalLines: number;
  renderedLines: number;
  omittedLines: number;
  omittedChars: number;
  truncated: boolean;
};

export function commandOutputPreview(text: string, expanded: boolean, live = false): CommandOutputPreview {
  const normalized = text.trimEnd();
  const lines = normalized ? normalized.split(/\r?\n/) : [];
  const previewLineCount = 1;
  const collapsible = lines.length > previewLineCount || normalized.length > 240;
  if (!collapsible) {
    return {
      text: normalized,
      collapsible,
      totalChars: normalized.length,
      totalLines: Math.max(1, lines.length),
      renderedLines: Math.max(1, lines.length),
      omittedLines: 0,
      omittedChars: 0,
      truncated: false
    };
  }
  if (expanded) {
    return boundedExpandedCommandOutput(normalized, lines, collapsible, live);
  }
  const previewLines = lines.slice(0, previewLineCount);
  return {
    text: previewLines.join("\n"),
    collapsible,
    totalChars: normalized.length,
    totalLines: lines.length,
    renderedLines: previewLines.length,
    omittedLines: Math.max(0, lines.length - previewLines.length),
    omittedChars: Math.max(0, normalized.length - previewLines.join("\n").length),
    truncated: true
  };
}

export function commandForDisplay(command: string): string {
  const trimmed = command.trim();
  const launcher = /^(?:&\s*)?(?:\(\s*)?["']([A-Za-z]:\\[^"']*?\\(?:pwsh|powershell)\.exe)["']\s*/i;
  const match = trimmed.match(launcher);
  if (!match) return trimmed;
  let rest = trimmed.slice(match[0].length).trim();
  rest = rest.replace(/^-(?:NoLogo|NoProfile|NonInteractive)\b\s*/i, "").trim();
  rest = rest.replace(/^-(?:Command|EncodedCommand|File)\b\s*/i, "").trim();
  if (trimmed.startsWith("(") && rest.endsWith(")")) rest = rest.slice(0, -1).trim();
  if ((rest.startsWith('\"') && rest.endsWith('\"')) || (rest.startsWith("'") && rest.endsWith("'"))) rest = rest.slice(1, -1);
  return rest || trimmed;
}

function boundedExpandedCommandOutput(
  normalized: string,
  lines: string[],
  collapsible: boolean,
  live: boolean,
): CommandOutputPreview {
  const maxLines = live ? LIVE_COMMAND_OUTPUT_MAX_LINES : COMMAND_OUTPUT_MAX_LINES;
  const maxChars = live ? LIVE_COMMAND_OUTPUT_MAX_CHARS : COMMAND_OUTPUT_MAX_CHARS;
  if (lines.length <= maxLines && normalized.length <= maxChars) {
    return {
      text: normalized,
      collapsible,
      totalChars: normalized.length,
      totalLines: lines.length,
      renderedLines: lines.length,
      omittedLines: 0,
      omittedChars: 0,
      truncated: false
    };
  }

  if (lines.length <= maxLines) {
    const contentBudget = Math.max(1_000, maxChars - 160);
    const headBudget = Math.floor(contentBudget * 0.3);
    const tailBudget = contentBudget - headBudget;
    const head = normalized.slice(0, headBudget);
    const tail = normalized.slice(-tailBudget);
    const omittedChars = Math.max(0, normalized.length - head.length - tail.length);
    const marker = `[... ${omittedChars} characters omitted from rendering ...]`;
    const renderedText = [head, marker, tail].join("\n");
    return {
      text: renderedText,
      collapsible,
      totalChars: normalized.length,
      totalLines: lines.length,
      renderedLines: renderedText.split("\n").length,
      omittedLines: 0,
      omittedChars,
      truncated: true
    };
  }

  const headLineCount = Math.min(lines.length, Math.max(12, Math.floor(maxLines * 0.25)));
  const tailLineCount = Math.min(
    Math.max(0, lines.length - headLineCount),
    Math.max(24, maxLines - headLineCount),
  );
  let head = lines.slice(0, headLineCount).join("\n");
  let tail = lines.slice(lines.length - tailLineCount).join("\n");
  const contentBudget = Math.max(1_000, maxChars - 160);
  const headBudget = Math.floor(contentBudget * 0.3);
  const tailBudget = contentBudget - headBudget;
  if (head.length > headBudget) {
    head = head.slice(0, headBudget);
  }
  if (tail.length > tailBudget) {
    tail = tail.slice(-tailBudget);
  }
  const omittedLines = Math.max(0, lines.length - headLineCount - tailLineCount);
  const omittedChars = Math.max(0, normalized.length - head.length - tail.length);
  const omittedSummary = [
    omittedLines > 0 ? `${omittedLines} lines` : null,
    omittedChars > 0 ? `${omittedChars} characters` : null,
  ].filter(Boolean).join(", ");
  const marker = `[... ${omittedSummary || "output"} omitted from rendering ...]`;
  const renderedText = [head, marker, tail].filter(Boolean).join("\n");
  return {
    text: renderedText,
    collapsible,
    totalChars: normalized.length,
    totalLines: lines.length,
    renderedLines: renderedText.split("\n").length,
    omittedLines,
    omittedChars,
    truncated: true
  };
}

function formatStartedAt(startedAt?: number): string | null {
  if (!startedAt) {
    return null;
  }
  const milliseconds = startedAt > 1_000_000_000_000 ? startedAt : startedAt * 1000;
  const date = new Date(milliseconds);
  if (Number.isNaN(date.getTime())) {
    return null;
  }
  return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false });
}

function formatMessageTimestamp(startedAt?: number): string | null {
  if (!startedAt) return null;
  const milliseconds = startedAt > 1_000_000_000_000 ? startedAt : startedAt * 1000;
  const date = new Date(milliseconds);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleString([], {
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit"
  });
}

export function formatFirstToken(startedAt?: number, firstTokenAt?: number): string | null {
  const startedAtMs = timestampMilliseconds(startedAt);
  const firstTokenAtMs = timestampMilliseconds(firstTokenAt);
  if (startedAtMs == null || firstTokenAtMs == null) {
    return null;
  }
  const seconds = Math.max(0, (firstTokenAtMs - startedAtMs) / 1000);
  return `first ${seconds < 10 ? seconds.toFixed(1) : Math.round(seconds).toString()}s`;
}

export function formatElapsed(turnStartedAt?: number, firstTokenAt?: number, itemStartedAt?: number): string | null {
  const turnStartedAtMs = timestampMilliseconds(turnStartedAt);
  const firstTokenAtMs = timestampMilliseconds(firstTokenAt);
  if (turnStartedAtMs == null || firstTokenAtMs == null) {
    return null;
  }
  const itemStartedAtMs = timestampMilliseconds(itemStartedAt);
  if (itemStartedAtMs != null && Math.abs(itemStartedAtMs - turnStartedAtMs) < 1) {
    return null;
  }
  const seconds = Math.max(0, (firstTokenAtMs - turnStartedAtMs) / 1000);
  return `elapsed ${seconds < 10 ? seconds.toFixed(1) : Math.round(seconds).toString()}s`;
}

function formatAssistantUsageSummary(row: ChatWaterfallRow): string | null {
  const usage = row.tokenUsage;
  if (!usage) {
    return null;
  }
  const cacheHitRate = usage.inputTokens > 0 ? usage.cachedInputTokens / usage.inputTokens : 0;
  const parts = [`in ${formatCompactNumber(usage.inputTokens)}`, `out ${formatCompactNumber(usage.outputTokens)}`, `hit ${(cacheHitRate * 100).toFixed(1)}%`];
  const startedAtMs = timestampMilliseconds(row.startedAt);
  if (!row.isLive && startedAtMs != null && usage.outputTokens > 0) {
    const completedAtMs = timestampMilliseconds(row.completedAt) ?? Date.now();
    const durationSeconds = Math.max(1, (completedAtMs - startedAtMs) / 1000);
    const tokensPerSecond = usage.outputTokens / durationSeconds;
    parts.push(`${tokensPerSecond.toFixed(tokensPerSecond >= 10 ? 1 : 2)} tok/s`);
  }
  if (usage.estimatedCostUsd != null) {
    parts.push(`cost ${formatUsd(usage.estimatedCostUsd)}`);
  }
  if (usage.totalEstimatedCostUsd != null) {
    parts.push(`total ${formatUsd(usage.totalEstimatedCostUsd)}`);
  }
  return parts.join(" · ");
}

function formatRate(value: number): string {
  return `$${value.toFixed(6)}`;
}

function formatMultiplier(value: number): string {
  return Number.isInteger(value) ? value.toString() : value.toFixed(4).replace(/0+$/, "").replace(/\.$/, "");
}

function timestampMilliseconds(value?: number): number | null {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) return null;
  return value >= 1_000_000_000_000 ? value : value * 1000;
}

function assistantUsageDetails(row: ChatWaterfallRow): string[] | null {
  const usage = row.tokenUsage;
  if (!usage) {
    return null;
  }
  const inputBillable = Math.max(0, usage.inputTokens - usage.cachedInputTokens - usage.cacheWriteInputTokens);
  const cacheHitRate = usage.inputTokens > 0 ? usage.cachedInputTokens / usage.inputTokens : 0;
  const details = [
    `input ${formatCompactNumber(usage.inputTokens)}`,
    `output ${formatCompactNumber(usage.outputTokens)}`,
    `cached ${formatCompactNumber(usage.cachedInputTokens)}`,
    `cache write ${formatCompactNumber(usage.cacheWriteInputTokens)}`,
    `cache hit ${(cacheHitRate * 100).toFixed(1)}%`,
    `billable input ${formatCompactNumber(inputBillable)}`,
    speedDetail(row)
  ].filter((detail): detail is string => Boolean(detail));
  if (usage.estimatedCostUsd != null) {
    if (usage.costBreakdownUsd) {
      details.push(`input cost ${formatUsd(usage.costBreakdownUsd.input)}`);
      details.push(`cached cost ${formatUsd(usage.costBreakdownUsd.cachedInput)}`);
      details.push(`write cost ${formatUsd(usage.costBreakdownUsd.cacheWrite)}`);
      details.push(`output cost ${formatUsd(usage.costBreakdownUsd.output)}`);
    }
    details.push(`turn cost ${formatUsd(usage.estimatedCostUsd)}`);
    if (usage.totalEstimatedCostUsd != null) details.push(`thread total ${formatUsd(usage.totalEstimatedCostUsd)}`);
  }
  return details;
}

function speedDetail(row: ChatWaterfallRow): string | null {
  const usage = row.tokenUsage;
  if (!usage || row.isLive || !row.startedAt || usage.outputTokens <= 0) {
    return null;
  }
  const completedAt = row.completedAt ?? Date.now() / 1000;
  const durationSeconds = Math.max(1, completedAt - row.startedAt);
  const tokensPerSecond = usage.outputTokens / durationSeconds;
  return `speed ${tokensPerSecond.toFixed(tokensPerSecond >= 10 ? 1 : 2)} tok/s`;
}

function formatCompactNumber(value: number): string {
  return new Intl.NumberFormat(undefined, { maximumFractionDigits: 0 }).format(value);
}

function formatUsd(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return "$0";
  return `$${value.toFixed(4)}`;
}
