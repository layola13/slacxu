import { useEffect, useState, type ReactNode } from "react";
import { alpha } from "@mui/material/styles";
import { Box, Button, IconButton, Paper, Stack, Tab, Tabs, TextField, Tooltip, Typography } from "@mui/material";
import CloseIcon from "@mui/icons-material/Close";
import AccountTreeOutlinedIcon from "@mui/icons-material/AccountTreeOutlined";
import FolderOpenOutlinedIcon from "@mui/icons-material/FolderOpenOutlined";
import OpenInNewIcon from "@mui/icons-material/OpenInNew";
import RefreshIcon from "@mui/icons-material/Refresh";
import type { FsDirectoryEntry, PtyTerminalSession, TerminalSession } from "../state/codexClient";
import type { OpenWorkspaceFile } from "./WorkspaceFilesSettingsPanel";
import { isBrowserTabAvailable } from "../clientPlatform";
import { WorkspaceExplorerPanel } from "./WorkspaceExplorerPanel";
import { GitReviewPanel, type GitRpc } from "./GitReviewPanel";
import { TerminalConsole } from "./TerminalConsole";

import { WindowsTerminalLauncher } from "./WindowsTerminalLauncher";

export type RightWorkspaceTab = "sidechat" | "explorer" | "git" | "browser" | "terminal";

type Props = {
  activeTab: RightWorkspaceTab;
  sideChat: ReactNode;
  cwd: string;
  fileDirectories: Record<string, FsDirectoryEntry[]>;
  openFile: OpenWorkspaceFile | null;
  /** All open editor tabs (VSCode-style); falls back to [openFile] when absent. */
  openTabs?: OpenWorkspaceFile[];
  onActivateFile?: (path: string) => void;
  onCloseFile?: (path: string) => void;
  onCloseOtherFiles?: (path: string) => void;
  onCloseAllFiles?: () => void;
  browserPreviewUrl?: string | null;
  terminalSessions: TerminalSession[];
  ptyTerminals: PtyTerminalSession[];
  onTabChange: (tab: RightWorkspaceTab) => void;
  onClose: () => void;
  onReadDirectory: (path: string) => void;
  onReadFile: (path: string) => void;
  onChangeOpenFileContent: (content: string) => void;
  onSaveOpenFile: () => void;
  /** VSCode-style file mutations (optional; Explorer hides CRUD UI when absent). */
  onCreateWorkspaceFile?: (parentPath: string, name: string) => Promise<string>;
  onCreateWorkspaceFolder?: (parentPath: string, name: string) => Promise<string>;
  onDeleteWorkspacePaths?: (paths: string[]) => Promise<void>;
  onRenameWorkspacePath?: (source: string, newName: string) => Promise<string>;
  onMoveWorkspacePath?: (source: string, destinationDir: string) => Promise<string>;
  workspaceMutationsBusy?: boolean;
  onRunTerminalCommand: (command: string, cwd: string, size: { rows: number; cols: number }) => void;
  onWriteTerminalInput: (processId: string, input: string) => void;
  onTerminateTerminal: (processId: string) => void;
  onResizeTerminal: (processId: string, size: { rows: number; cols: number }) => void;
  onGitRpc: GitRpc;
  onOpenTerminal: (shell?: string) => void;
  /** Windows desktop (win32): terminal tab opens the system shell instead of the embedded PTY. */
  windowsDesktop?: boolean;
  onCreatePtyTerminal: (cwd: string, size: { rows: number; cols: number }, command?: string[]) => void;
  onWritePtyTerminal: (terminalId: string, data: string) => void;
  onKillPtyTerminal: (terminalId: string) => void;
  onForgetPtyTerminal: (terminalId: string) => void;
  onResizePtyTerminal: (terminalId: string, size: { rows: number; cols: number }) => void;
  onLoadPtyTail: (terminalId: string) => Promise<string>;
  /** Transcript auto-routed a fullscreen command here: switch to this tab once listed. */
  autoSelectPtyTerminalId?: string | null;
  onAutoSelectPtyConsumed?: () => void;
};

export function RightWorkspacePanel({
  activeTab,
  sideChat,
  cwd,
  fileDirectories,
  openFile,
  openTabs,
  onActivateFile,
  onCloseFile,
  onCloseOtherFiles,
  onCloseAllFiles,
  browserPreviewUrl,
  terminalSessions,
  ptyTerminals,
  onTabChange,
  onClose,
  onReadDirectory,
  onReadFile,
  onChangeOpenFileContent,
  onSaveOpenFile,
  onCreateWorkspaceFile,
  onCreateWorkspaceFolder,
  onDeleteWorkspacePaths,
  onRenameWorkspacePath,
  onMoveWorkspacePath,
  workspaceMutationsBusy = false,
  onRunTerminalCommand,
  onWriteTerminalInput,
  onTerminateTerminal,
  onResizeTerminal,
  onGitRpc,
  onOpenTerminal,
  windowsDesktop = false,
  onCreatePtyTerminal,
  onWritePtyTerminal,
  onKillPtyTerminal,
  onForgetPtyTerminal,
  onResizePtyTerminal,
  onLoadPtyTail,
  autoSelectPtyTerminalId,
  onAutoSelectPtyConsumed
}: Props) {
  // 内嵌 Browser 仅 Windows 桌面端保留；服务器浏览器版与非 Windows 一律隐藏。
  const showBrowserTab = isBrowserTabAvailable();
  // 兼容持久化偏好：页签隐藏时若恢复出 browser，回退到 explorer，避免选中隐藏页签。
  const effectiveTab = !showBrowserTab && activeTab === "browser" ? "explorer" : activeTab;
  return (
    <Box
      data-testid="right-workspace-panel"
      sx={{
        height: "100%",
        minWidth: 0,
        minHeight: 0,
        display: "grid",
        gridTemplateRows: "44px minmax(0, 1fr)",
        borderLeft: { xs: 0, md: "1px solid" },
        borderTop: { xs: "1px solid", md: 0 },
        borderColor: "divider",
        bgcolor: (theme) => alpha(theme.palette.background.default, theme.palette.mode === "dark" ? 0.68 : 0.94)
      }}
    >
      <Stack
        direction="row"
        alignItems="center"
        spacing={0.75}
        sx={{
          px: 1,
          minWidth: 0,
          borderBottom: "1px solid",
          borderColor: "divider",
          bgcolor: (theme) => alpha(theme.palette.background.paper, theme.palette.mode === "dark" ? 0.54 : 0.78)
        }}
      >
        <Tabs
          value={effectiveTab}
          onChange={(_, value) => onTabChange(value)}
          variant="scrollable"
          scrollButtons="auto"
          aria-label="Right workspace tabs"
          sx={{ flex: 1, minWidth: 0, minHeight: 42, "& .MuiTab-root": { minHeight: 42, px: 1.25 } }}
        >
          <Tab value="sidechat" label="Side chat" />
          <Tab value="explorer" label="Explorer" icon={<FolderOpenOutlinedIcon fontSize="small" />} iconPosition="start" />
          <Tab value="git" label="Git" icon={<AccountTreeOutlinedIcon fontSize="small" />} iconPosition="start" />
          {showBrowserTab && <Tab value="browser" label="Browser" />}
          <Tab value="terminal" label="Terminal" />
        </Tabs>
        <Tooltip title="Hide right workspace">
          <IconButton size="small" aria-label="Hide right workspace" onClick={onClose}>
            <CloseIcon fontSize="small" />
          </IconButton>
        </Tooltip>
      </Stack>
      <Box sx={{ minHeight: 0, overflow: "hidden", "& [data-testid='sidechat-panel']": { borderLeft: 0 } }}>
        {effectiveTab === "sidechat" && sideChat}
        {effectiveTab === "explorer" && (
          <WorkspaceExplorerPanel
            cwd={cwd}
            fileDirectories={fileDirectories}
            openFile={openFile}
            openTabs={openTabs}
            onReadDirectory={onReadDirectory}
            onReadFile={onReadFile}
            onChangeOpenFileContent={onChangeOpenFileContent}
            onSaveOpenFile={onSaveOpenFile}
            onActivateFile={onActivateFile}
            onCloseFile={onCloseFile}
            onCloseOtherFiles={onCloseOtherFiles}
            onCloseAllFiles={onCloseAllFiles}
            onCreateFile={onCreateWorkspaceFile}
            onCreateFolder={onCreateWorkspaceFolder}
            onDeletePaths={onDeleteWorkspacePaths}
            onRenamePath={onRenameWorkspacePath}
            onMovePath={onMoveWorkspacePath}
            mutationsBusy={workspaceMutationsBusy}
          />
        )}
        {effectiveTab === "git" && <GitReviewPanel cwd={cwd} rpc={onGitRpc} />}
        {effectiveTab === "browser" && showBrowserTab && <BrowserPanel initialUrl={browserPreviewUrl ?? ""} />}
        {effectiveTab === "terminal" && (
          <TerminalPanel
            cwd={cwd}
            windowsDesktop={windowsDesktop}
            terminalSessions={terminalSessions}
            ptyTerminals={ptyTerminals}
            onOpenTerminal={onOpenTerminal}
            onRunTerminalCommand={onRunTerminalCommand}
            onWriteTerminalInput={onWriteTerminalInput}
            onTerminateTerminal={onTerminateTerminal}
            onResizeTerminal={onResizeTerminal}
            onCreatePtyTerminal={onCreatePtyTerminal}
            onWritePtyTerminal={onWritePtyTerminal}
            onKillPtyTerminal={onKillPtyTerminal}
            onForgetPtyTerminal={onForgetPtyTerminal}
            onResizePtyTerminal={onResizePtyTerminal}
            onLoadPtyTail={onLoadPtyTail}
            autoSelectPtyTerminalId={autoSelectPtyTerminalId}
            onAutoSelectPtyConsumed={onAutoSelectPtyConsumed}
          />
        )}
      </Box>
    </Box>
  );
}

function normalizeBrowserUrl(raw: string): string {
  let trimmed = raw.trim();
  if (!trimmed) return "";
  trimmed = trimmed.replace(/^[`'"<(\[{]+/, "").replace(/[`'">)\]}]+$/, "");
  trimmed = trimmed.replace(/[.,;:!?，。；：！？、…]+$/, "").replace(/[`'"]+$/, "");

  // If local host, default to http:// and map 0.0.0.0 -> 127.0.0.1
  const localMatch = /^(?:https?:\/\/)?(?:localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\])(?::\d{1,5})?(?:\/.*)?$/i.test(trimmed);
  if (localMatch) {
    if (!/^https?:\/\//i.test(trimmed)) {
      trimmed = `http://${trimmed}`;
    }
    trimmed = trimmed.replace(/^(https?:\/\/)0\.0\.0\.0(?::|$|\/)/i, "$1127.0.0.1$2");
    return trimmed;
  }
  return /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
}

function BrowserPanel({ initialUrl }: { initialUrl: string }) {
  const normalizedInitial = normalizeBrowserUrl(initialUrl);
  const [draftUrl, setDraftUrl] = useState(normalizedInitial);
  const [url, setUrl] = useState(normalizedInitial);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    if (!initialUrl) {
      return;
    }
    const next = normalizeBrowserUrl(initialUrl);
    setDraftUrl(next);
    setUrl(next);
  }, [initialUrl]);

  const load = () => {
    const next = normalizeBrowserUrl(draftUrl);
    if (!next) {
      return;
    }
    setDraftUrl(next);
    setUrl(next);
    setReloadKey((k) => k + 1);
  };

  const isLocalHost = /localhost|127\.0\.0\.1|\[::1\]/i.test(url);

  return (
    <Box sx={{ height: "100%", minHeight: 0, display: "grid", gridTemplateRows: "auto minmax(0, 1fr)", p: 1 }}>
      <Paper variant="outlined" sx={{ p: 1, mb: 1 }}>
        <Stack direction={{ xs: "column", sm: "row" }} spacing={1}>
          <TextField
            size="small"
            label="Address"
            value={draftUrl}
            onChange={(event) => setDraftUrl(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                load();
              }
            }}
            sx={{ flex: 1 }}
          />
          <Button size="small" startIcon={<RefreshIcon />} onClick={load}>
            Go
          </Button>
          {url ? (
            <Button size="small" href={url} target="_blank" rel="noreferrer" endIcon={<OpenInNewIcon />}>
              Open
            </Button>
          ) : (
            <Button size="small" disabled endIcon={<OpenInNewIcon />}>
              Open
            </Button>
          )}
        </Stack>
        <Typography variant="caption" sx={{ color: "text.secondary", display: "block", mt: 0.75, px: 0.5 }}>
          {!url
            ? "输入本地预览地址（如 http://127.0.0.1:3000）后按 Go，或从对话中选择预览。"
            : isLocalHost
              ? "本地预览：请确保本地服务已启动（如 npm run dev / vite preview）。"
              : "提示：部分外部网站阻止在内嵌框架中打开，可点击「Open」在新窗口中浏览。"}
        </Typography>
      </Paper>
      <Paper variant="outlined" sx={{ minHeight: 0, overflow: "hidden", bgcolor: "#ffffff" }}>
        {url ? (
          <Box
            component="iframe"
            key={`${url}-${reloadKey}`}
            title="Browser"
            src={url}
            sx={{ width: "100%", height: "100%", border: 0, bgcolor: "#ffffff" }}
          />
        ) : (
          <Box sx={{ height: "100%", display: "grid", placeItems: "center", color: "text.secondary", p: 2 }}>
            Select a local web preview from the conversation, or enter a URL above.
          </Box>
        )}
      </Paper>
    </Box>
  );
}

function TerminalPanel({
  cwd,
  windowsDesktop = false,
  terminalSessions,
  ptyTerminals,
  onRunTerminalCommand,
  onWriteTerminalInput,
  onTerminateTerminal,
  onResizeTerminal,
  onOpenTerminal,
  onCreatePtyTerminal,
  onWritePtyTerminal,
  onKillPtyTerminal,
  onForgetPtyTerminal,
  onResizePtyTerminal,
  onLoadPtyTail,
  autoSelectPtyTerminalId,
  onAutoSelectPtyConsumed
}: {
  cwd: string;
  windowsDesktop?: boolean;
  terminalSessions: TerminalSession[];
  ptyTerminals: Props["ptyTerminals"];
  onRunTerminalCommand: Props["onRunTerminalCommand"];
  onWriteTerminalInput: Props["onWriteTerminalInput"];
  onTerminateTerminal: Props["onTerminateTerminal"];
  onResizeTerminal: Props["onResizeTerminal"];
  onOpenTerminal: Props["onOpenTerminal"];
  onCreatePtyTerminal: Props["onCreatePtyTerminal"];
  onWritePtyTerminal: Props["onWritePtyTerminal"];
  onKillPtyTerminal: Props["onKillPtyTerminal"];
  onForgetPtyTerminal: Props["onForgetPtyTerminal"];
  onResizePtyTerminal: Props["onResizePtyTerminal"];
  onLoadPtyTail: Props["onLoadPtyTail"];
  autoSelectPtyTerminalId: Props["autoSelectPtyTerminalId"];
  onAutoSelectPtyConsumed: Props["onAutoSelectPtyConsumed"];
}) {
  // Windows desktop: VSCode-style system terminal launcher; embedded PTY stays on Linux/web.
  const useSystemTerminal =
    windowsDesktop &&
    typeof window !== "undefined" &&
    Boolean(window.codexUltraDesktop?.openTerminal);
  if (useSystemTerminal) {
    return <WindowsTerminalLauncher cwd={cwd} onOpenTerminal={onOpenTerminal} />;
  }
  return (
    <TerminalConsole
      cwd={cwd}
      terminalSessions={terminalSessions}
      ptyTerminals={ptyTerminals}
      onRunTerminalCommand={onRunTerminalCommand}
      onWriteTerminalInput={onWriteTerminalInput}
      onTerminateTerminal={onTerminateTerminal}
      onResizeTerminal={onResizeTerminal}
      onOpenTerminal={onOpenTerminal}
      onCreatePtyTerminal={onCreatePtyTerminal}
      onWritePtyTerminal={onWritePtyTerminal}
      onKillPtyTerminal={onKillPtyTerminal}
      onForgetPtyTerminal={onForgetPtyTerminal}
      onResizePtyTerminal={onResizePtyTerminal}
      onLoadPtyTail={onLoadPtyTail}
      autoSelectPtyTerminalId={autoSelectPtyTerminalId}
      onAutoSelectPtyConsumed={onAutoSelectPtyConsumed}
    />
  );
}
