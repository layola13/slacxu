import { useEffect, useMemo, useState } from "react";
import {
  Avatar,
  Box,
  Button,
  Chip,
  Divider,
  IconButton,
  LinearProgress,
  List,
  ListItemButton,
  ListItemIcon,
  ListItemText,
  Menu,
  MenuItem,
  Popover,
  Stack,
  TextField,
  Tooltip,
  ToggleButton,
  ToggleButtonGroup,
  Typography
} from "@mui/material";
import ArchiveOutlinedIcon from "@mui/icons-material/ArchiveOutlined";
import CheckIcon from "@mui/icons-material/Check";
import CloseIcon from "@mui/icons-material/Close";
import DeleteOutlineIcon from "@mui/icons-material/DeleteOutline";
import DownloadIcon from "@mui/icons-material/Download";
import DriveFileRenameOutlineIcon from "@mui/icons-material/DriveFileRenameOutline";
import EventIcon from "@mui/icons-material/Event";
import KeyboardArrowLeftIcon from "@mui/icons-material/KeyboardArrowLeft";
import KeyboardArrowRightIcon from "@mui/icons-material/KeyboardArrowRight";
import SearchIcon from "@mui/icons-material/Search";
import SettingsIcon from "@mui/icons-material/Settings";
import AutoAwesomeIcon from "@mui/icons-material/AutoAwesome";
import ViewAgendaIcon from "@mui/icons-material/ViewAgenda";
import ViewListIcon from "@mui/icons-material/ViewList";
import TableRowsIcon from "@mui/icons-material/TableRows";
import TerminalIcon from "@mui/icons-material/Terminal";
import { alpha } from "@mui/material/styles";
import type { ThreadEntry } from "../state/codexClient";
import type { TranslateFn } from "../i18n";
import { ThreadStatusDot } from "../components/ThreadStatusDot";
import { CliBackendIcon } from "../components/CliBackendIcon";
import { isSshThread, sshThreadTooltip } from "../app/threads/threadCatalog";

export type HistoryThreadUsageSummary = {
  totalTokens: number;
  inputTokens: number;
  cachedInputTokens: number;
  cacheWriteInputTokens: number;
  outputTokens: number;
  estimatedCostUsd?: number;
};

export type HistoryLoadProgress = {
  value: number;
  label: string;
};

export type HistoryDateRangeFilter = {
  from: string;
  to: string;
};

export type HistoryViewMode = "auto" | "large" | "list" | "details";
export type HistoryWorkspaceFilter = "all" | "local" | "ssh";
export type HistoryBackendFilter = "codex" | "claude" | "agy" | "auggie" | "cline" | "command-code" | "grok" | "muse" | "pi" | "opencode" | "opencode-v2" | "mini";

const HISTORY_VIEW_STORAGE_KEY = "codex-ultra.history-view";
const HISTORY_WORKSPACE_FILTER_STORAGE_KEY = "codex-ultra.history-workspace-filter";
const HISTORY_PAGE_SIZE = 10;
const EMPTY_RUNNING_THREAD_IDS: ReadonlySet<string> = new Set();

type Props = {
  threads: ThreadEntry[];
  activeThreadId: string | null;
  runningThreadIds?: ReadonlySet<string>;
  providerLabel: string;
  threadUsage?: Record<string, HistoryThreadUsageSummary>;
  searchTerm: string;
  loading?: boolean;
  loadProgress?: HistoryLoadProgress | null;
  dateRange?: HistoryDateRangeFilter;
  totalThreadCount?: number;
  installAvailable?: boolean;
  backgroundImage?: string;
  viewMode?: HistoryViewMode;
  backendFilter: HistoryBackendFilter;
  t: TranslateFn;
  onSearchChange: (value: string) => void;
  onDateRangeChange?: (value: HistoryDateRangeFilter) => void;
  onViewModeChange?: (value: HistoryViewMode) => void;
  onBackendFilterChange: (value: HistoryBackendFilter) => void;
  onRefresh: () => void;
  onSelect: (threadId: string) => void;
  onRename: (threadId: string, name: string) => void | Promise<void>;
  onArchive: (threadId: string) => void | Promise<void>;
  onExport: (threadId: string) => void | Promise<void>;
  onDelete: (threadId: string) => void | Promise<void>;
  onInstallApp?: () => void;
  onOpenSettings: () => void;
};

export function HistorySidebar({
  threads,
  activeThreadId,
  runningThreadIds = EMPTY_RUNNING_THREAD_IDS,
  providerLabel,
  threadUsage = {},
  searchTerm,
  loading = false,
  loadProgress = null,
  dateRange = { from: "", to: "" },
  totalThreadCount = threads.length,
  installAvailable = false,
  backgroundImage,
  viewMode: controlledViewMode,
  backendFilter,
  t,
  onSearchChange,
  onDateRangeChange,
  onViewModeChange,
  onBackendFilterChange,
  onRefresh,
  onSelect,
  onRename,
  onArchive,
  onExport,
  onDelete,
  onInstallApp,
  onOpenSettings
}: Props) {
  const [editingThreadId, setEditingThreadId] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState("");
  const [busyThreadId, setBusyThreadId] = useState<string | null>(null);
  const [viewMenuAnchor, setViewMenuAnchor] = useState<HTMLElement | null>(null);
  const [dateFilterAnchor, setDateFilterAnchor] = useState<HTMLElement | null>(null);
  const [localViewMode, setLocalViewMode] = useState<HistoryViewMode>(() => readHistoryViewMode());
  const [workspaceFilter, setWorkspaceFilter] = useState<HistoryWorkspaceFilter>(() => readHistoryWorkspaceFilter());
  const viewMode = controlledViewMode ?? localViewMode;
  const [page, setPage] = useState(0);
  const backendCounts = useMemo(() => {
    const counts: Record<HistoryBackendFilter, number> = {
      codex: 0,
      claude: 0,
      agy: 0,
      auggie: 0,
      cline: 0,
      "command-code": 0,
      grok: 0,
      muse: 0,
      pi: 0,
      opencode: 0,
      "opencode-v2": 0,
      mini: 0,
    };
    for (const thread of threads) {
      const backend = (thread.cliBackend ?? "mini") as HistoryBackendFilter;
      if (backend in counts) {
        counts[backend]++;
      }
    }
    return counts;
  }, [threads]);
  const backendTabs: Array<{ value: HistoryBackendFilter; label: string }> = [
    { value: "mini", label: t("history.backendMini") || "Mini" },
    { value: "codex", label: t("history.backendCodex") },
    { value: "claude", label: t("history.backendClaude") },
    { value: "agy", label: t("history.backendAgy") || "Antigravity" },
    { value: "auggie", label: t("history.backendAuggie") || "Auggie" },
    { value: "cline", label: t("history.backendCline") || "Cline" },
    { value: "command-code", label: t("history.backendCommandCode") || "Command Code" },
    { value: "grok", label: t("history.backendGrok") || "Grok" },
    { value: "muse", label: t("history.backendMuse") || "Muse" },
    { value: "pi", label: t("history.backendPi") || "Pi" },
    { value: "opencode", label: t("history.backendOpencode") || "OpenCode" },
    { value: "opencode-v2", label: t("history.backendOpencodeV2") || "OpenCode v2" },
  ];
  const dateFilterActive = Boolean(dateRange.from || dateRange.to);
  const backendThreads = useMemo(
    () => threads.filter((thread) => (thread.cliBackend ?? "mini") === backendFilter),
    [backendFilter, threads]
  );
  const workspaceThreads = useMemo(
    () => backendThreads.filter((thread) => workspaceFilter === "all" || (workspaceFilter === "ssh") === (thread.workspaceMode === "ssh")),
    [backendThreads, workspaceFilter]
  );
  const totalPages = Math.max(1, Math.ceil(workspaceThreads.length / HISTORY_PAGE_SIZE));
  const currentPage = Math.min(page, totalPages - 1);
  const pagedThreads = useMemo(
    () => workspaceThreads.slice(currentPage * HISTORY_PAGE_SIZE, currentPage * HISTORY_PAGE_SIZE + HISTORY_PAGE_SIZE),
    [currentPage, workspaceThreads]
  );
  const effectiveViewMode: Exclude<HistoryViewMode, "auto"> = viewMode === "auto"
    ? pagedThreads.length <= 6 ? "large" : backendThreads.length <= 24 ? "list" : "details"
    : viewMode;

  useEffect(() => {
    setPage(0);
  }, [backendFilter, dateRange.from, dateRange.to, searchTerm, workspaceFilter]);

  useEffect(() => {
    setPage((current) => Math.min(current, totalPages - 1));
  }, [totalPages]);

  const selectViewMode = (mode: HistoryViewMode) => {
    setLocalViewMode(mode);
    onViewModeChange?.(mode);
    setViewMenuAnchor(null);
  };

  const beginRename = (thread: ThreadEntry) => {
    setEditingThreadId(thread.id);
    setRenameDraft(threadTitle(thread));
  };

  const saveRename = async (threadId: string) => {
    const nextName = renameDraft.trim();
    if (!nextName) {
      return;
    }
    setBusyThreadId(threadId);
    try {
      await onRename(threadId, nextName);
      setEditingThreadId(null);
      setRenameDraft("");
    } catch {
      // App owns the visible error surface.
    } finally {
      setBusyThreadId(null);
    }
  };

  const archiveThread = async (threadId: string) => {
    setBusyThreadId(threadId);
    try {
      await onArchive(threadId);
    } catch {
      // App owns the visible error surface.
    } finally {
      setBusyThreadId(null);
    }
  };

  const exportThread = async (thread: ThreadEntry) => {
    if (thread.cliBackend !== "codex") return;
    setBusyThreadId(thread.id);
    try {
      await onExport(thread.id);
    } catch {
      // App owns the visible error surface.
    } finally {
      setBusyThreadId(null);
    }
  };

  const deleteThread = async (thread: ThreadEntry) => {
    if (!window.confirm(t("history.deleteConfirm", { title: threadTitle(thread) }))) {
      return;
    }
    setBusyThreadId(thread.id);
    try {
      await onDelete(thread.id);
    } catch {
      // App owns the visible error surface.
    } finally {
      setBusyThreadId(null);
    }
  };

  return (
    <Box
      data-testid="history-sidebar"
      sx={{
        borderRight: "1px solid",
        borderColor: "divider",
        height: "100%",
        minHeight: 0,
        overflow: "hidden",
        display: "flex",
        flexDirection: "column",
        bgcolor: (theme) => alpha(theme.palette.background.default, theme.palette.mode === "dark" ? 0.46 : 0.36),
        backgroundImage: backgroundImage
          ? (theme) =>
              [
                `linear-gradient(${alpha(theme.palette.background.default, theme.palette.mode === "dark" ? 0.68 : 0.72)}, ${alpha(theme.palette.background.default, theme.palette.mode === "dark" ? 0.68 : 0.72)})`,
                `url("${backgroundImage}")`
              ].join(", ")
          : undefined,
        backgroundSize: backgroundImage ? "cover" : undefined,
        backgroundPosition: backgroundImage ? "center" : undefined
      }}
    >
      <Stack direction="row" alignItems="center" spacing={1} sx={{ px: 2, py: 1.5 }}>
        <Typography variant="subtitle2" sx={{ flex: 1, fontWeight: 800 }}>
          {t("history.conversations")}
        </Typography>
        <Tooltip title={t("history.dateFilter")}>
          <IconButton
            size="small"
            color={dateFilterActive ? "primary" : "default"}
            aria-label={t("history.dateFilter")}
            onClick={(event) => setDateFilterAnchor(event.currentTarget)}
          >
            <EventIcon fontSize="small" />
          </IconButton>
        </Tooltip>
        <Tooltip title={t("history.viewMode")}>
          <IconButton size="small" aria-label={t("history.viewMode")} onClick={(event) => setViewMenuAnchor(event.currentTarget)}>
            {effectiveViewMode === "large" ? <ViewAgendaIcon fontSize="small" /> : effectiveViewMode === "details" ? <TableRowsIcon fontSize="small" /> : <ViewListIcon fontSize="small" />}
          </IconButton>
        </Tooltip>
        <Button size="small" onClick={onRefresh} disabled={loading}>
          {loading ? t("history.loading") : t("history.refresh")}
        </Button>
      </Stack>
      <ToggleButtonGroup
        exclusive
        size="small"
        value={backendFilter}
        onChange={(_event, value: HistoryBackendFilter | null) => {
          if (value) onBackendFilterChange(value);
        }}
        aria-label={t("history.backendFilter")}
        sx={{
          px: 1.25,
          pb: 1,
          display: "flex",
          flexWrap: "wrap",
          gap: 0.5,
          "& .MuiToggleButtonGroup-grouped": {
            margin: 0,
            border: "1px solid !important",
            borderColor: "divider !important",
            borderRadius: "8px !important",
            "&.Mui-selected": {
              borderColor: (theme) => `${theme.palette.primary.main} !important`,
              backgroundColor: (theme) => alpha(theme.palette.primary.main, 0.12),
              "&:hover": {
                backgroundColor: (theme) => alpha(theme.palette.primary.main, 0.18),
              },
            },
            "&:hover": {
              backgroundColor: "action.hover",
            },
          },
          "& .MuiToggleButton-root": {
            flex: "0 0 32px",
            minWidth: 32,
            width: 32,
            height: 32,
            p: 0,
          },
        }}
      >
        {backendTabs.map((tab) => {
          const count = backendCounts[tab.value];
          const title = count > 0 ? `${tab.label} · ${count}` : tab.label;
          return (
            <Tooltip key={tab.value} title={title} placement="top" arrow>
              <ToggleButton value={tab.value} aria-label={title}>
                <CliBackendIcon cliBackend={tab.value} size={18} />
              </ToggleButton>
            </Tooltip>
          );
        })}
      </ToggleButtonGroup>
      <Stack direction="row" spacing={0.75} sx={{ px: 1.25, pb: 1 }}>
        {([
          ["all", t("history.workspaceAll")],
          ["local", t("history.workspaceLocal")],
          ["ssh", t("history.workspaceSsh")]
        ] as const).map(([value, label]) => (
          <Chip
            key={value}
            size="small"
            label={label}
            color={workspaceFilter === value ? "primary" : "default"}
            variant={workspaceFilter === value ? "filled" : "outlined"}
            onClick={() => { setWorkspaceFilter(value); window.localStorage.setItem(HISTORY_WORKSPACE_FILTER_STORAGE_KEY, value); }}
            sx={{ cursor: "pointer" }}
          />
        ))}
      </Stack>
      <Menu anchorEl={viewMenuAnchor} open={Boolean(viewMenuAnchor)} onClose={() => setViewMenuAnchor(null)}>
        {([
          ["auto", t("history.viewAuto"), <AutoAwesomeIcon fontSize="small" />],
          ["large", t("history.viewLarge"), <ViewAgendaIcon fontSize="small" />],
          ["list", t("history.viewList"), <ViewListIcon fontSize="small" />],
          ["details", t("history.viewDetails"), <TableRowsIcon fontSize="small" />]
        ] as const).map(([mode, label, icon]) => (
          <MenuItem key={mode} selected={viewMode === mode} onClick={() => selectViewMode(mode)}>
            <ListItemIcon>{icon}</ListItemIcon>
            <ListItemText>{label}</ListItemText>
            {viewMode === mode ? <CheckIcon fontSize="small" /> : null}
          </MenuItem>
        ))}
      </Menu>
      <Popover
        anchorEl={dateFilterAnchor}
        open={Boolean(dateFilterAnchor)}
        onClose={() => setDateFilterAnchor(null)}
        anchorOrigin={{ vertical: "bottom", horizontal: "left" }}
        transformOrigin={{ vertical: "top", horizontal: "left" }}
        PaperProps={{ sx: { width: 280, p: 1.5, borderRadius: 2 } }}
      >
        <Stack spacing={1.25}>
          <Typography variant="subtitle2" sx={{ fontWeight: 800 }}>
            {t("history.dateFilter")}
          </Typography>
          <TextField
            size="small"
            type="date"
            label={t("history.dateFrom")}
            value={dateRange.from}
            onChange={(event) => {
              setPage(0);
              onDateRangeChange?.({ ...dateRange, from: event.target.value });
            }}
            InputLabelProps={{ shrink: true }}
            fullWidth
          />
          <TextField
            size="small"
            type="date"
            label={t("history.dateTo")}
            value={dateRange.to}
            onChange={(event) => {
              setPage(0);
              onDateRangeChange?.({ ...dateRange, to: event.target.value });
            }}
            InputLabelProps={{ shrink: true }}
            fullWidth
          />
          <Stack direction="row" spacing={1} justifyContent="space-between">
            <Button
              size="small"
              variant="outlined"
              disabled={!dateFilterActive}
              onClick={() => {
                setPage(0);
                onDateRangeChange?.({ from: "", to: "" });
              }}
            >
              {t("history.clearDateFilter")}
            </Button>
            <Button size="small" variant="contained" onClick={() => setDateFilterAnchor(null)}>
              {t("history.applyDateFilter")}
            </Button>
          </Stack>
        </Stack>
      </Popover>
      <Divider />
      <Box sx={{ px: 1.25, py: 1 }}>
        <Stack spacing={1}>
          <TextField
            size="small"
            fullWidth
            value={searchTerm}
            onChange={(event) => onSearchChange(event.target.value)}
            placeholder={t("history.search")}
            inputProps={{ "aria-label": t("history.search") }}
            InputProps={{
              startAdornment: <SearchIcon fontSize="small" color="disabled" sx={{ mr: 0.75 }} />
            }}
          />
          {dateFilterActive ? (
            <Stack direction="row" spacing={0.75} alignItems="center" sx={{ minWidth: 0 }}>
              <Chip
                size="small"
                color="primary"
                variant="outlined"
                label={historyDateRangeLabel(dateRange, t)}
                onDelete={() => {
                  setPage(0);
                  onDateRangeChange?.({ from: "", to: "" });
                }}
                sx={{ maxWidth: "100%", borderRadius: 1 }}
              />
              <Typography variant="caption" color="text.secondary" sx={{ flexShrink: 0 }}>
                {t("history.filterCount", { shown: workspaceThreads.length, total: totalThreadCount })}
              </Typography>
            </Stack>
          ) : null}
        </Stack>
      </Box>
      {loading ? (
        <Box sx={{ px: 1.25, pb: 1 }}>
          <Stack spacing={0.5}>
            <LinearProgress
              variant={loadProgress ? "determinate" : "indeterminate"}
              value={loadProgress ? clampProgress(loadProgress.value) : undefined}
              sx={{ height: 6, borderRadius: 999 }}
            />
            <Typography variant="caption" color="text.secondary">
              {loadProgress?.label ?? t("history.loading")}
              {loadProgress ? ` ${Math.round(clampProgress(loadProgress.value))}%` : ""}
            </Typography>
          </Stack>
        </Box>
      ) : null}
      <List data-testid="history-thread-list" data-history-view={effectiveViewMode} dense sx={{ overflow: "auto", flex: "1 1 0", minHeight: 0, p: 1.25 }}>
        {workspaceThreads.length === 0 && (
          <Box sx={{ p: 1.25, color: "text.secondary" }}>
            <Typography variant="body2" sx={{ fontWeight: 700 }}>
              {loading ? t("history.loading") : backendFilter === "codex" || backendFilter === "mini" ? t("history.empty") : t("history.engineEmpty")}
            </Typography>
            <Typography variant="caption">{searchTerm || dateFilterActive ? t("history.emptySearch") : backendFilter === "codex" || backendFilter === "mini" ? t("history.emptyDescription") : t("history.engineEmptyDescription")}</Typography>
          </Box>
        )}
        {pagedThreads.map((thread) => {
          const title = threadTitle(thread);
          const usage = threadUsage[thread.id];
          const isEditing = editingThreadId === thread.id;
          const disabled = busyThreadId === thread.id;
          const running = runningThreadIds.has(thread.id);
          return (
            <ListItemButton
              key={thread.id}
              selected={activeThreadId === thread.id}
              onClick={() => {
                if (!isEditing) {
                  onSelect(thread.id);
                }
              }}
              aria-label={t("history.openAria", { title })}
              sx={{
                border: effectiveViewMode === "list" ? 0 : "1px solid",
                borderBottom: effectiveViewMode === "list" ? "1px solid" : undefined,
                borderColor: activeThreadId === thread.id ? "primary.main" : "divider",
                bgcolor: activeThreadId === thread.id ? "action.selected" : "background.paper",
                alignItems: effectiveViewMode === "list" ? "center" : "flex-start",
                gap: 0.75,
                py: effectiveViewMode === "large" ? 1.15 : effectiveViewMode === "details" ? 0.65 : 0.35,
                px: effectiveViewMode === "list" ? 0.75 : 1,
                "& + &": { mt: effectiveViewMode === "large" ? 1 : effectiveViewMode === "details" ? 0.5 : 0 },
                "&:hover .history-actions, &:focus-within .history-actions": { opacity: 1 }
              }}
            >
              <Box sx={{ mt: effectiveViewMode === "list" ? 0 : 1.25, flex: "0 0 auto" }}>
                <ThreadStatusDot
                  active={activeThreadId === thread.id}
                  running={running}
                  runningLabel={t("composer.running")}
                  threadId={thread.id}
                />
              </Box>
              {isSshThread(thread) ? (
                <Tooltip title={sshThreadTooltip(thread) ?? "SSH"}>
                  <TerminalIcon
                    data-testid="ssh-thread-indicator"
                    aria-label={sshThreadTooltip(thread) ?? "SSH"}
                    color="primary"
                    sx={{ mt: effectiveViewMode === "list" ? 0 : 0.85, fontSize: 17, flex: "0 0 auto" }}
                  />
                </Tooltip>
              ) : null}
              {isEditing ? (
                <Stack
                  direction="row"
                  spacing={0.5}
                  alignItems="center"
                  sx={{ minWidth: 0, flex: 1 }}
                  onClick={(event) => event.stopPropagation()}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      event.preventDefault();
                      void saveRename(thread.id);
                    }
                    if (event.key === "Escape") {
                      event.preventDefault();
                      setEditingThreadId(null);
                      setRenameDraft("");
                    }
                  }}
                >
                  <TextField
                    size="small"
                    value={renameDraft}
                    onChange={(event) => setRenameDraft(event.target.value)}
                    inputProps={{ "aria-label": t("history.renameLabel") }}
                    autoFocus
                    fullWidth
                  />
                  <Tooltip title={t("history.saveRename")}>
                    <span>
                      <IconButton size="small" aria-label={t("history.saveRename")} disabled={!renameDraft.trim() || disabled} onClick={() => void saveRename(thread.id)}>
                        <CheckIcon fontSize="small" />
                      </IconButton>
                    </span>
                  </Tooltip>
                  <Tooltip title={t("history.cancelRename")}>
                    <IconButton
                      size="small"
                      aria-label={t("history.cancelRename")}
                      disabled={disabled}
                      onClick={() => {
                        setEditingThreadId(null);
                        setRenameDraft("");
                      }}
                    >
                      <CloseIcon fontSize="small" />
                    </IconButton>
                  </Tooltip>
                </Stack>
              ) : (
                <>
                  <ListItemText
                    primary={title}
                    secondary={<HistoryThreadMetadata thread={thread} usage={usage} mode={effectiveViewMode} t={t} />}
                    primaryTypographyProps={{ noWrap: true, fontWeight: activeThreadId === thread.id ? 700 : 500 }}
                    sx={{ minWidth: 0, flex: 1 }}
                  />
                  <Stack
                    className="history-actions"
                    direction="row"
                    spacing={0.25}
                    onClick={(event) => event.stopPropagation()}
                    sx={{ flexShrink: 0, opacity: effectiveViewMode === "large" ? 1 : 0.35 }}
                  >
                    <Tooltip title={t("history.rename")}>
                      <IconButton size="small" aria-label={t("history.renameAria", { title })} disabled={disabled} onClick={() => beginRename(thread)}>
                        <DriveFileRenameOutlineIcon fontSize="small" />
                      </IconButton>
                    </Tooltip>
                    <Tooltip title={t("history.archive")}>
                      <IconButton size="small" aria-label={t("history.archiveAria", { title })} disabled={disabled} onClick={() => void archiveThread(thread.id)}>
                        <ArchiveOutlinedIcon fontSize="small" />
                      </IconButton>
                    </Tooltip>
                    {thread.cliBackend === "codex" ? (
                      <Tooltip title={t("history.export")}>
                        <IconButton size="small" aria-label={t("history.exportAria", { title })} disabled={disabled} onClick={() => void exportThread(thread)}>
                          <DownloadIcon fontSize="small" />
                        </IconButton>
                      </Tooltip>
                    ) : null}
                    <Tooltip title={t("history.delete")}>
                      <IconButton size="small" aria-label={t("history.deleteAria", { title })} disabled={disabled} onClick={() => void deleteThread(thread)}>
                        <DeleteOutlineIcon fontSize="small" />
                      </IconButton>
                    </Tooltip>
                  </Stack>
                </>
              )}
            </ListItemButton>
          );
        })}
      </List>
      {workspaceThreads.length > HISTORY_PAGE_SIZE ? (
        <>
          <Divider />
          <Stack direction="row" spacing={1} alignItems="center" justifyContent="space-between" sx={{ px: 1.25, py: 0.75 }}>
            <Typography variant="caption" color="text.secondary">
              {t("history.pagination", {
                start: currentPage * HISTORY_PAGE_SIZE + 1,
                end: Math.min((currentPage + 1) * HISTORY_PAGE_SIZE, workspaceThreads.length),
                total: workspaceThreads.length
              })}
            </Typography>
            <Stack direction="row" spacing={0.5}>
              <IconButton
                size="small"
                aria-label={t("history.previousPage")}
                disabled={currentPage <= 0}
                onClick={() => setPage((value) => Math.max(0, value - 1))}
              >
                <KeyboardArrowLeftIcon fontSize="small" />
              </IconButton>
              <Chip size="small" variant="outlined" label={t("history.pageCount", { page: currentPage + 1, pages: totalPages })} sx={{ borderRadius: 1 }} />
              <IconButton
                size="small"
                aria-label={t("history.nextPage")}
                disabled={currentPage >= totalPages - 1}
                onClick={() => setPage((value) => Math.min(totalPages - 1, value + 1))}
              >
                <KeyboardArrowRightIcon fontSize="small" />
              </IconButton>
            </Stack>
          </Stack>
        </>
      ) : null}
      <Divider />
      <Box data-testid="left-bottom-account-area" sx={{ p: 1.25, flex: "0 0 auto" }}>
        <Stack
          direction="row"
          spacing={1}
          alignItems="center"
          sx={{
            p: 1,
            border: "1px solid",
            borderColor: "divider",
            borderRadius: 1.5,
            bgcolor: "background.paper"
          }}
        >
          <Avatar sx={{ width: 34, height: 34, fontSize: 13, fontWeight: 850 }}>CU</Avatar>
          <Box sx={{ minWidth: 0, flex: 1 }}>
            <Typography variant="body2" sx={{ fontWeight: 800, lineHeight: 1.25 }} noWrap>
              Codex UI
            </Typography>
            <Typography variant="caption" color="text.secondary" title={providerLabel} sx={{ display: "block" }} noWrap>
              {providerLabel}
            </Typography>
          </Box>
          {installAvailable && (
            <Tooltip title={t("history.installApp")}>
              <IconButton size="small" onClick={onInstallApp} aria-label={t("history.installApp")}>
                <DownloadIcon fontSize="small" />
              </IconButton>
            </Tooltip>
          )}
        </Stack>
        <Button size="small" fullWidth startIcon={<SettingsIcon />} onClick={onOpenSettings} aria-label={t("history.openSettings")} sx={{ mt: 1, justifyContent: "flex-start" }}>
          {t("history.settings")}
        </Button>
      </Box>
    </Box>
  );
}

function readHistoryViewMode(): HistoryViewMode {
  try {
    const value = window.localStorage.getItem(HISTORY_VIEW_STORAGE_KEY);
    if (value === "auto" || value === "large" || value === "list" || value === "details") {
      return value;
    }
  } catch {
    // Use automatic density when storage is unavailable.
  }
  return "auto";
}

function readHistoryWorkspaceFilter(): HistoryWorkspaceFilter {
  try {
    const value = window.localStorage.getItem(HISTORY_WORKSPACE_FILTER_STORAGE_KEY);
    if (value === "local" || value === "ssh" || value === "all") return value;
  } catch {
    // Storage may be unavailable in embedded/private contexts.
  }
  return "all";
}

function clampProgress(value: number): number {
  return Number.isFinite(value) ? Math.min(100, Math.max(0, value)) : 0;
}

function historyDateRangeLabel(dateRange: HistoryDateRangeFilter, t: TranslateFn): string {
  if (dateRange.from && dateRange.to) {
    return t("history.dateRangeBoth", { from: dateRange.from, to: dateRange.to });
  }
  if (dateRange.from) {
    return t("history.dateRangeFrom", { from: dateRange.from });
  }
  if (dateRange.to) {
    return t("history.dateRangeTo", { to: dateRange.to });
  }
  return t("history.dateFilter");
}

function HistoryThreadMetadata({
  thread,
  usage,
  mode,
  t
}: {
  thread: ThreadEntry;
  usage?: HistoryThreadUsageSummary;
  mode: Exclude<HistoryViewMode, "auto">;
  t: TranslateFn;
}) {
  const source = threadSourceLabel(thread, t);
  const cost = historyCostLabel(usage, t);
  if (mode === "list") {
    return (
      <Typography variant="caption" color="text.secondary" noWrap>
        {[source, cost, thread.cwd ? shortCwd(thread.cwd) : null].filter(Boolean).join(" | ")}
      </Typography>
    );
  }
  if (mode === "details") {
    return (
      <Tooltip title={historyCostTooltip(usage, t)}>
        <Typography variant="caption" color="text.secondary" component="span" sx={{ display: "block", mt: 0.15 }} noWrap>
          {[source, !thread.status || isSilentStatus(thread.status) ? t("history.stored") : thread.status, cost, thread.model, thread.cwd ? shortCwd(thread.cwd) : null]
            .filter(Boolean)
            .join(" | ")}
        </Typography>
      </Tooltip>
    );
  }
  return (
    <Stack direction="row" spacing={0.5} alignItems="center" sx={{ mt: 0.5, flexWrap: "wrap" }}>
      <Chip size="small" label={source} variant="outlined" />
      <VisibleStatusChip status={thread.status} fallback={t("history.stored")} />
      <Tooltip title={historyCostTooltip(usage, t)}>
        <Chip size="small" label={cost} color="success" variant="outlined" />
      </Tooltip>
      {thread.model && <Chip size="small" label={thread.model} variant="outlined" />}
      {thread.modelProvider && <Typography variant="caption">{thread.modelProvider}</Typography>}
      {thread.cwd && <Typography variant="caption" title={thread.cwd}>{shortCwd(thread.cwd)}</Typography>}
    </Stack>
  );
}

function threadSourceLabel(thread: ThreadEntry, t: TranslateFn): string {
  if (thread.parentThreadId) {
    return t("history.source.agent");
  }
  if (thread.agentNickname || thread.agentRole) {
    return t("history.source.sidechat");
  }
  if (thread.source) {
    return thread.source;
  }
  return t("history.source.main");
}

function historyCostLabel(usage: HistoryThreadUsageSummary | undefined, t: TranslateFn): string {
  if (usage?.estimatedCostUsd != null) {
    return t("history.cost", { value: formatUsd(usage.estimatedCostUsd) });
  }
  return t("history.cost", { value: "$0.0000" });
}

function historyCostTooltip(usage: HistoryThreadUsageSummary | undefined, t: TranslateFn): string {
  if (!usage || usage.totalTokens <= 0) {
    return t("history.costNoUsage");
  }
  return [
    t("history.costTotalTokens", { value: formatNumber(usage.totalTokens) }),
    t("history.costInputTokens", { value: formatNumber(usage.inputTokens) }),
    t("history.costOutputTokens", { value: formatNumber(usage.outputTokens) }),
    t("history.costCachedTokens", { value: formatNumber(usage.cachedInputTokens) }),
    t("history.costCacheWriteTokens", { value: formatNumber(usage.cacheWriteInputTokens) })
  ].join("\n");
}

function formatNumber(value: number): string {
  return new Intl.NumberFormat(undefined, { maximumFractionDigits: 0 }).format(value);
}

function formatUsd(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return "$0";
  return `$${value.toFixed(4)}`;
}

function threadTitle(thread: ThreadEntry): string {
  const title = thread.title || thread.name || thread.preview;
  if (title?.trim()) {
    return title.trim();
  }
  const stamp = thread.recencyAt ?? thread.updatedAt ?? thread.createdAt;
  const date = stamp ? new Date(stamp * 1000).toISOString().slice(0, 10) : "Stored thread";
  return `${date} ${thread.id.slice(0, 8)}`;
}

function shortCwd(cwd: string): string {
  const normalized = cwd.replace(/\/+$/, "");
  const parts = normalized.split("/").filter(Boolean);
  if (parts.length <= 2) {
    return normalized || cwd;
  }
  return `.../${parts.slice(-2).join("/")}`;
}

function VisibleStatusChip({ status, fallback }: { status?: string; fallback: string }) {
  if (status && isSilentStatus(status)) {
    return null;
  }
  return <Chip size="small" label={status ?? fallback} />;
}

function isSilentStatus(status: string): boolean {
  return ["completed", "complete", "done", "success", "shutdown"].includes(status.trim().toLowerCase());
}
