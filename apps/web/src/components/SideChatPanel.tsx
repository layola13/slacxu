import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { alpha } from "@mui/material/styles";
import {
  Box,
  ButtonBase,
  Chip,
  IconButton,
  ListItemIcon,
  ListItemText,
  Menu,
  MenuItem,
  Paper,
  Select,
  Stack,
  Switch,
  TextField,
  Tooltip,
  Typography
} from "@mui/material";
import AddIcon from "@mui/icons-material/Add";
import AddCircleOutlineIcon from "@mui/icons-material/AddCircleOutline";
import AttachFileIcon from "@mui/icons-material/AttachFile";
import ChatBubbleOutlineIcon from "@mui/icons-material/ChatBubbleOutline";
import CloseIcon from "@mui/icons-material/Close";
import HandymanIcon from "@mui/icons-material/Handyman";
import ImageIcon from "@mui/icons-material/Image";
import OpenInFullIcon from "@mui/icons-material/OpenInFull";
import PublicIcon from "@mui/icons-material/Public";
import SendIcon from "@mui/icons-material/Send";
import TerminalIcon from "@mui/icons-material/Terminal";
import TuneIcon from "@mui/icons-material/Tune";
import ViewColumnIcon from "@mui/icons-material/ViewColumn";
import type { ComposerImageAttachment, ModelEntry, WorkbenchTurn } from "../state/codexClient";
import { ChatWaterfall } from "../waterfall/ChatWaterfall";
import { buildChatRows } from "../waterfall/chatRows";
import type { TranslateFn } from "../i18n";

export type SideChatTab = {
  id: string;
  title: string;
  threadId: string | null;
  draft: string;
  sending: boolean;
  userMessages: Array<{ id: string; text: string }>;
  /** Per-tab model override; empty means follow the duck default / global. */
  modelOverride?: string | null;
  /** Duck.ai-style server-side web search toggle. */
  webSearch?: boolean;
  /** Pending attachments (uploaded to disk, path-only at send). */
  attachments?: ComposerImageAttachment[];
  /** Generated images rendered under the transcript. */
  generatedImages?: Array<{ id: string; url: string; prompt?: string }>;
  /** Image generation in flight. */
  imageBusy?: boolean;
};

type Props = {
  tabs: SideChatTab[];
  activeTabId: string | null;
  turns: WorkbenchTurn[];
  models: ModelEntry[];
  selectedModel: string;
  sideModels: Array<{ value: string; label: string }>;
  tabModel: string;
  reasoningLabel: string;
  permissionLabel: string;
  connected: boolean;
  engineReady: boolean;
  error: string | null;
  t: TranslateFn;
  onTabChange: (tabId: string) => void;
  onAddTab: () => void;
  onCloseTab: (tabId: string) => void;
  onClosePanel: () => void;
  onDraftChange: (tabId: string, draft: string) => void;
  onModelChange: (tabId: string, model: string) => void;
  onToggleWebSearch: (tabId: string) => void;
  onAttachFiles: (tabId: string, files: File[]) => void;
  onRemoveAttachment: (tabId: string, attachmentId: string) => void;
  onCreateImage: (tabId: string) => void;
  onSend: (tabId: string, text: string) => void;
};

export function SideChatPanel({
  tabs,
  activeTabId,
  turns,
  models,
  selectedModel,
  sideModels,
  tabModel,
  reasoningLabel,
  permissionLabel,
  connected,
  engineReady,
  error,
  onTabChange,
  onAddTab,
  onCloseTab,
  onClosePanel,
  onDraftChange,
  onModelChange,
  onToggleWebSearch,
  onAttachFiles,
  onRemoveAttachment,
  onCreateImage,
  onSend,
  t
}: Props) {
  const activeTab = tabs.find((tab) => tab.id === activeTabId) ?? tabs[0];
  const transcriptRef = useRef<HTMLDivElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [launcherAnchor, setLauncherAnchor] = useState<HTMLElement | null>(null);
  const [toolsAnchor, setToolsAnchor] = useState<HTMLElement | null>(null);
  const visibleTurns = useMemo(
    () => (activeTab?.threadId ? turns.filter((turn) => turn.threadId === activeTab.threadId) : []),
    [activeTab?.threadId, turns]
  );
  // Unified waterfall: same row builder as the main window. In-flight local
  // echoes become synthetic user turns so the whole transcript shares one
  // format; echoes already reflected in a server turn are dropped.
  const sideRows = useMemo(() => {
    const serverTexts = new Set(
      visibleTurns.flatMap((turn) => turn.items ?? [])
        .filter((item) => item?.type === "userMessage" && typeof item?.text === "string")
        .map((item) => (item.text as string).trim())
    );
    const echoTurns: WorkbenchTurn[] = (activeTab?.userMessages ?? [])
      .filter((message) => !serverTexts.has(message.text.trim()))
      .map((message) => ({
        id: `sidechat-echo-${message.id}`,
        threadId: activeTab?.threadId ?? "",
        status: "inProgress",
        items: [{ id: message.id, type: "userMessage", text: message.text } as WorkbenchTurn["items"][number]],
      }));
    return buildChatRows([...echoTurns, ...visibleTurns]);
  }, [activeTab?.threadId, activeTab?.userMessages, visibleTurns]);
  const busy = Boolean(activeTab?.sending) || visibleTurns.some((turn) => turn.status === "inProgress");
  const canSend = Boolean(activeTab?.draft.trim()) && connected && engineReady && !busy;
  const modelLabel = models.find((model) => (model.model ?? model.id ?? "") === selectedModel)?.displayName ?? selectedModel;

  useEffect(() => {
    const element = transcriptRef.current;
    if (element) {
      element.scrollTop = element.scrollHeight;
    }
  }, [activeTab?.id, activeTab?.userMessages.length, visibleTurns]);

  return (
    <Box
      data-testid="sidechat-panel"
      sx={{
        height: "100%",
        minWidth: 0,
        minHeight: 0,
        display: "grid",
        gridTemplateRows: activeTab ? "48px minmax(0, 1fr) auto" : "48px minmax(0, 1fr)",
        borderLeft: "1px solid",
        borderColor: "divider",
        bgcolor: (theme) => alpha(theme.palette.background.default, theme.palette.mode === "dark" ? 0.7 : 0.96)
      }}
    >
      <Box
        sx={{
          display: "flex",
          alignItems: "center",
          gap: 0.5,
          px: 1.25,
          minWidth: 0,
          overflow: "hidden",
          borderBottom: "1px solid",
          borderColor: "divider",
          bgcolor: (theme) => alpha(theme.palette.background.paper, theme.palette.mode === "dark" ? 0.48 : 0.72)
        }}
      >
        <Box
          role="tablist"
          aria-label="Side chat tabs"
          sx={{
            display: "flex",
            alignItems: "center",
            gap: 0.5,
            flex: 1,
            minWidth: 0,
            overflowX: "auto",
            overflowY: "hidden"
          }}
        >
          {tabs.map((tab) => {
            const active = tab.id === activeTab?.id;
            return (
              <Box
                key={tab.id}
                sx={{
                  display: "flex",
                  alignItems: "center",
                  flex: "0 0 auto",
                  minWidth: 0,
                  borderRadius: 999,
                  bgcolor: active ? "action.selected" : "transparent",
                  border: "1px solid",
                  borderColor: active ? "divider" : "transparent"
                }}
              >
                <Box
                  component="button"
                  type="button"
                  role="tab"
                  data-testid={`sidechat-tab-${tab.id}`}
                  aria-selected={active}
                  onClick={() => onTabChange(tab.id)}
                  sx={{
                    display: "flex",
                    alignItems: "center",
                    gap: 0.75,
                    minWidth: 0,
                    height: 34,
                    pl: 1,
                    pr: 0.5,
                    border: 0,
                    bgcolor: "transparent",
                    color: active ? "text.primary" : "text.secondary",
                    font: "inherit",
                    cursor: "pointer"
                  }}
                >
                  <AddCircleOutlineIcon sx={{ fontSize: 16, flex: "0 0 auto" }} />
                  <Typography
                    component="span"
                    variant="body2"
                    sx={{ maxWidth: { xs: 120, lg: 150 }, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
                  >
                    {tab.title}
                  </Typography>
                </Box>
                <Tooltip title={`Close ${tab.title}`}>
                  <IconButton
                    size="small"
                    aria-label={`Close ${tab.title}`}
                    onClick={() => onCloseTab(tab.id)}
                    sx={{ mr: 0.25, color: "text.secondary" }}
                  >
                    <CloseIcon sx={{ fontSize: 16 }} />
                  </IconButton>
                </Tooltip>
              </Box>
            );
          })}
        </Box>
        <Tooltip title="New side chat">
          <IconButton
            size="small"
            aria-label="New side chat"
            onClick={(event) => setLauncherAnchor(event.currentTarget)}
            sx={{ color: "text.secondary", borderRadius: 1.5 }}
          >
            <AddIcon fontSize="small" />
          </IconButton>
        </Tooltip>
        <Box sx={{ flex: 1, minWidth: 8 }} />
        <Tooltip title="Maximize side chat">
          <IconButton size="small" aria-label="Maximize side chat" sx={{ color: "text.secondary", display: { xs: "none", sm: "inline-flex" } }}>
            <OpenInFullIcon fontSize="small" />
          </IconButton>
        </Tooltip>
        <Tooltip title="Hide side chat">
          <IconButton size="small" aria-label="Hide side chat" onClick={onClosePanel} sx={{ color: "text.secondary", borderRadius: 1.5 }}>
            <ViewColumnIcon fontSize="small" />
          </IconButton>
        </Tooltip>
      </Box>
      <Menu
        anchorEl={launcherAnchor}
        open={Boolean(launcherAnchor)}
        onClose={() => setLauncherAnchor(null)}
        PaperProps={{
          sx: {
            mt: 0.75,
            minWidth: 260,
            borderRadius: 2,
            boxShadow: (theme) => theme.customShadows?.dropdown
          }
        }}
      >
        <MenuItem
          onClick={() => {
            setLauncherAnchor(null);
            onAddTab();
          }}
        >
          <ListItemIcon>
            <AddCircleOutlineIcon fontSize="small" />
          </ListItemIcon>
          <ListItemText primary="Side chat" />
          <Typography variant="caption" color="text.secondary">
            Ctrl+Alt+S
          </Typography>
        </MenuItem>
        <MenuItem disabled>
          <ListItemIcon>
            <PublicIcon fontSize="small" />
          </ListItemIcon>
          <ListItemText primary="Browser" />
          <Typography variant="caption" color="text.secondary">
            Ctrl+T
          </Typography>
        </MenuItem>
        <MenuItem disabled>
          <ListItemIcon>
            <TerminalIcon fontSize="small" />
          </ListItemIcon>
          <ListItemText primary="Terminal" />
        </MenuItem>
      </Menu>

      <Box
        ref={transcriptRef}
        data-testid="sidechat-transcript"
        sx={{
          minHeight: 0,
          overflow: "hidden",
          display: "flex",
          flexDirection: "column",
          bgcolor: (theme) => alpha(theme.palette.background.default, theme.palette.mode === "dark" ? 0.2 : 0.1)
        }}
      >
        {!activeTab ? (
          <Box sx={{ minHeight: "100%", display: "grid", placeItems: "center", px: 2 }}>
            <Stack spacing={1.25} sx={{ width: "min(520px, 100%)" }}>
              <LauncherRow icon={<AddCircleOutlineIcon fontSize="small" />} label="Side chat" shortcut="Ctrl+Alt+S" onClick={onAddTab} />
              <LauncherRow icon={<PublicIcon fontSize="small" />} label="Browser" shortcut="Ctrl+T" disabled />
              <LauncherRow icon={<TerminalIcon fontSize="small" />} label="Terminal" disabled />
            </Stack>
          </Box>
        ) : sideRows.length === 0 && !error ? (
          <Box sx={{ display: "grid", placeItems: "center", minHeight: 220, textAlign: "center" }}>
            <Stack spacing={1} alignItems="center">
              <ChatBubbleOutlineIcon sx={{ fontSize: 30, color: "text.disabled" }} />
              <Typography variant="body2" color="text.secondary">
                Start a side chat
              </Typography>
            </Stack>
          </Box>
        ) : (
          <ChatWaterfall
            rows={sideRows}
            t={t}
            resetKey={activeTab.id}
            interactive={false}
            before={error ? (
              <Paper variant="outlined" sx={{ p: 1.25, borderColor: "error.main", color: "error.main" }}>
                <Typography variant="body2">{error}</Typography>
              </Paper>
            ) : undefined}
          />
        )}
      </Box>

      {activeTab && (
        <Box
          sx={{
            px: { xs: 1, sm: 2 },
            pb: { xs: 1, sm: 1.75 },
            pt: 1,
            bgcolor: (theme) => alpha(theme.palette.background.default, theme.palette.mode === "dark" ? 0.24 : 0.1)
          }}
        >
          <Paper
            variant="outlined"
            sx={{
              width: "min(860px, 100%)",
              mx: "auto",
              minHeight: 146,
              display: "grid",
              gridTemplateRows: "minmax(76px, 1fr) auto",
              borderRadius: 3,
              overflow: "hidden",
              bgcolor: "background.paper",
              boxShadow: (theme) => theme.customShadows?.z8
            }}
          >
            <TextField
              fullWidth
              multiline
              variant="standard"
              minRows={2}
              maxRows={6}
              value={activeTab.draft}
              disabled={!connected || !engineReady}
              placeholder="Do anything"
              inputProps={{ "aria-label": "Side chat message" }}
              InputProps={{ disableUnderline: true }}
              onChange={(event) => onDraftChange(activeTab.id, event.target.value)}
              onKeyDown={(event) => {
                if ((event.metaKey || event.ctrlKey) && event.key === "Enter" && canSend) {
                  event.preventDefault();
                  onSend(activeTab.id, activeTab.draft);
                }
              }}
              sx={{
                px: 2,
                pt: 1.75,
                "& textarea": { fontSize: 15, lineHeight: 1.55 }
              }}
            />
            {(activeTab.attachments?.length || activeTab.generatedImages?.length) ? (
              <Stack direction="row" spacing={0.75} sx={{ px: 2, pb: 1, flexWrap: "wrap", rowGap: 0.75 }}>
                {(activeTab.attachments ?? []).map((attachment) => (
                  <Chip
                    key={attachment.id}
                    size="small"
                    icon={<AttachFileIcon />}
                    label={attachment.name}
                    onDelete={() => onRemoveAttachment(activeTab.id, attachment.id)}
                  />
                ))}
                {(activeTab.generatedImages ?? []).map((image) => (
                  <Box
                    key={image.id}
                    component="img"
                    src={image.url}
                    alt={image.prompt ?? "generated image"}
                    sx={{ width: 96, height: 96, objectFit: "cover", borderRadius: 1.5, border: "1px solid", borderColor: "divider" }}
                  />
                ))}
              </Stack>
            ) : null}
            <Stack direction="row" alignItems="center" spacing={0.75} sx={{ px: 1.25, py: 1 }}>
              <Tooltip title="Tools: web search, image creation, attachments">
                <IconButton
                  size="small"
                  aria-label="Side chat tools"
                  data-testid="sidechat-tools-button"
                  disabled={!connected}
                  onClick={(event) => setToolsAnchor(event.currentTarget)}
                  sx={activeTab?.webSearch ? { color: "primary.main" } : undefined}
                >
                  <HandymanIcon fontSize="small" />
                </IconButton>
              </Tooltip>
              <Menu
                anchorEl={toolsAnchor}
                open={Boolean(toolsAnchor)}
                onClose={() => setToolsAnchor(null)}
              >
                <MenuItem
                  data-testid="sidechat-websearch-toggle"
                  onClick={() => { if (activeTab) onToggleWebSearch(activeTab.id); }}
                >
                  <ListItemIcon>
                    <PublicIcon fontSize="small" />
                  </ListItemIcon>
                  <ListItemText primary="Web Search" secondary="Source answers from the web" />
                  <Switch edge="end" checked={Boolean(activeTab?.webSearch)} onClick={(event) => event.stopPropagation()} onChange={() => { if (activeTab) onToggleWebSearch(activeTab.id); }} />
                </MenuItem>
                <MenuItem
                  data-testid="sidechat-create-image"
                  disabled={!activeTab?.draft.trim() || Boolean(activeTab?.imageBusy)}
                  onClick={() => { if (activeTab) { onCreateImage(activeTab.id); setToolsAnchor(null); } }}
                >
                  <ListItemIcon>
                    <ImageIcon fontSize="small" />
                  </ListItemIcon>
                  <ListItemText primary={activeTab?.imageBusy ? "Creating image…" : "Create Image"} secondary="Turn text into images" />
                </MenuItem>
                <MenuItem
                  data-testid="sidechat-attach"
                  onClick={() => { fileInputRef.current?.click(); }}
                >
                  <ListItemIcon>
                    <AttachFileIcon fontSize="small" />
                  </ListItemIcon>
                  <ListItemText primary="Attach file" secondary="Images and files as context" />
                </MenuItem>
              </Menu>
              <input
                ref={fileInputRef}
                type="file"
                multiple
                hidden
                aria-label="Attach files to side chat"
                onChange={(event) => {
                  const files = event.target.files ? Array.from(event.target.files) : [];
                  event.target.value = "";
                  setToolsAnchor(null);
                  if (activeTab && files.length > 0) onAttachFiles(activeTab.id, files);
                }}
              />
              <Tooltip title="Approval policy">
                <Box sx={{ display: "inline-flex", alignItems: "center", color: "text.secondary", minWidth: 0 }}>
                  <TuneIcon sx={{ fontSize: 16, mr: 0.5 }} />
                  <Typography variant="caption" noWrap sx={{ maxWidth: { xs: 120, sm: 180 } }}>
                    {permissionLabel}
                  </Typography>
                </Box>
              </Tooltip>
              <Box sx={{ flex: 1, minWidth: 8 }} />
              {sideModels.length > 0 ? (
                <Select
                  size="small"
                  variant="standard"
                  data-testid="sidechat-model-select"
                  aria-label="Side chat model"
                  value={sideModels.some((entry) => entry.value === tabModel) ? tabModel : ""}
                  displayEmpty
                  disabled={!connected}
                  onChange={(event) => {
                    if (activeTab) onModelChange(activeTab.id, String(event.target.value ?? ""));
                  }}
                  sx={{ maxWidth: { xs: 116, sm: 210 }, fontSize: 12 }}
                >
                  {sideModels.map((entry) => (
                    <MenuItem key={entry.value} value={entry.value}>
                      {entry.label}
                    </MenuItem>
                  ))}
                </Select>
              ) : (
                <Typography variant="caption" color="text.secondary" noWrap sx={{ maxWidth: { xs: 116, sm: 210 } }}>
                  {modelLabel || "Model"}
                </Typography>
              )}
              <Typography variant="caption" color="text.secondary" noWrap>
                {reasoningLabel}
              </Typography>
              <Tooltip title="Send side chat message">
                <span>
                  <IconButton
                    color="primary"
                    aria-label="Send side chat message"
                    disabled={!canSend}
                    onClick={() => onSend(activeTab.id, activeTab.draft)}
                    sx={{
                      bgcolor: "action.selected",
                      "&:hover": { bgcolor: "action.hover" }
                    }}
                  >
                    <SendIcon fontSize="small" />
                  </IconButton>
                </span>
              </Tooltip>
            </Stack>
          </Paper>
        </Box>
      )}
    </Box>
  );
}

function LauncherRow({
  icon,
  label,
  shortcut,
  disabled,
  onClick
}: {
  icon: ReactNode;
  label: string;
  shortcut?: string;
  disabled?: boolean;
  onClick?: () => void;
}) {
  return (
    <ButtonBase
      disabled={disabled}
      onClick={onClick}
      sx={{
        width: "100%",
        minHeight: 48,
        px: 1.5,
        py: 1,
        borderRadius: 1.5,
        justifyContent: "flex-start",
        color: disabled ? "text.disabled" : "text.primary",
        "&:hover": { bgcolor: disabled ? "transparent" : "action.hover" }
      }}
    >
      <Box sx={{ width: 30, display: "inline-flex", color: "text.secondary" }}>{icon}</Box>
      <Typography variant="body2" sx={{ flex: 1, textAlign: "left" }}>
        {label}
      </Typography>
      {shortcut && (
        <Chip
          size="small"
          label={shortcut}
          sx={{
            height: 22,
            color: "text.secondary",
            bgcolor: "action.selected",
            "& .MuiChip-label": { px: 0.75 }
          }}
        />
      )}
    </ButtonBase>
  );
}
