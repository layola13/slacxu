import { Suspense, lazy } from "react";
import { Box, CircularProgress } from "@mui/material";
import type { Dispatch, ReactNode, SetStateAction } from "react";
import type { GitRpc } from "../components/GitReviewPanel";
import type { RightWorkspaceTab } from "../components/RightWorkspacePanel";
import type { OpenWorkspaceFile } from "../components/WorkspaceFilesSettingsPanel";
import type { useOpenFileTabs } from "../app/workspace/useOpenFileTabs";
import type { useWorkspaceFileMutations } from "../app/workspace/useWorkspaceFileMutations";
import type { FsDirectoryEntry, PtyTerminalSession, TerminalSession } from "../state/codexClient";
import type { WebPreviewState } from "../webPreview";

const RightWorkspacePanel = lazy(async () => {
  const module = await import("../components/RightWorkspacePanel");
  return { default: module.RightWorkspacePanel };
});

export interface RightWorkspacePanelViewProps {
  rightWorkspaceTab: RightWorkspaceTab;
  setRightWorkspaceTab: Dispatch<SetStateAction<RightWorkspaceTab>>;
  renderSideChatPanel: () => ReactNode;
  activeWorkspaceCwd: string;
  activeWorkspaceDirectories: Record<string, FsDirectoryEntry[]>;
  openFile: OpenWorkspaceFile | null;
  webPreview: WebPreviewState | null;
  terminalSessions: TerminalSession[];
  ptyTerminals: PtyTerminalSession[];
  createPtyTerminal: (cwd: string, size: { rows: number; cols: number }, command?: string[]) => void;
  writePtyTerminal: (terminalId: string, data: string) => void;
  killPtyTerminal: (terminalId: string) => void;
  forgetPtyTerminal: (terminalId: string) => void;
  resizePtyTerminal: (terminalId: string, size: { rows: number; cols: number }) => void;
  loadPtyTail: (terminalId: string) => Promise<string>;
  ptyFocusTerminalId: string | null;
  setPtyFocusTerminalId: Dispatch<SetStateAction<string | null>>;
  closeWebPreview: () => void;
  closeRightWorkspace: () => void;
  readActiveWorkspaceDirectory: (path: string) => void;
  readActiveWorkspaceFile: (path: string) => void;
  changeOpenFileContent: (content: string) => void;
  saveActiveWorkspaceFile: () => void;
  fileTabs: ReturnType<typeof useOpenFileTabs>;
  workspaceFileMutations: ReturnType<typeof useWorkspaceFileMutations>;
  runTerminalCommand: (command: string, cwd: string, size: { rows: number; cols: number }) => void;
  writeTerminalInput: (processId: string, input: string) => void;
  terminateTerminal: (processId: string) => void;
  resizeTerminal: (processId: string, size: { rows: number; cols: number }) => void;
  workspaceGitRpc: GitRpc;
  activeWorkspaceSshCommand: string;
  activeWorkspaceSshCwd: string;
  windowsDesktop: boolean;
}

export function RightWorkspacePanelView({
  rightWorkspaceTab,
  setRightWorkspaceTab,
  renderSideChatPanel,
  activeWorkspaceCwd,
  activeWorkspaceDirectories,
  openFile,
  webPreview,
  terminalSessions,
  ptyTerminals,
  createPtyTerminal,
  writePtyTerminal,
  killPtyTerminal,
  forgetPtyTerminal,
  resizePtyTerminal,
  loadPtyTail,
  ptyFocusTerminalId,
  setPtyFocusTerminalId,
  closeWebPreview,
  closeRightWorkspace,
  readActiveWorkspaceDirectory,
  readActiveWorkspaceFile,
  changeOpenFileContent,
  saveActiveWorkspaceFile,
  fileTabs,
  workspaceFileMutations,
  runTerminalCommand,
  writeTerminalInput,
  terminateTerminal,
  resizeTerminal,
  workspaceGitRpc,
  activeWorkspaceSshCommand,
  activeWorkspaceSshCwd,
  windowsDesktop,
}: RightWorkspacePanelViewProps) {

    return (
      <Suspense fallback={<Box sx={{ height: "100%", display: "grid", placeItems: "center" }}><CircularProgress size={24} /></Box>}>
        <RightWorkspacePanel
          activeTab={rightWorkspaceTab}
          sideChat={renderSideChatPanel()}
          cwd={activeWorkspaceCwd}
          fileDirectories={activeWorkspaceDirectories}
          openFile={openFile}
          browserPreviewUrl={webPreview?.mode === "side" ? webPreview.url : null}
          terminalSessions={terminalSessions}
          ptyTerminals={ptyTerminals}
          onCreatePtyTerminal={(terminalCwd: string, size: { rows: number; cols: number }, command?: string[]) => void createPtyTerminal(terminalCwd, size, command)}
          onWritePtyTerminal={(terminalId: string, data: string) => void writePtyTerminal(terminalId, data)}
          onKillPtyTerminal={(terminalId: string) => void killPtyTerminal(terminalId)}
          onForgetPtyTerminal={(terminalId: string) => void forgetPtyTerminal(terminalId)}
          onResizePtyTerminal={(terminalId: string, size: { rows: number; cols: number }) => void resizePtyTerminal(terminalId, size)}
          onLoadPtyTail={loadPtyTail}
          autoSelectPtyTerminalId={ptyFocusTerminalId}
          onAutoSelectPtyConsumed={() => setPtyFocusTerminalId(null)}
          onTabChange={(tab: RightWorkspaceTab) => {
            setRightWorkspaceTab(tab);
            if (tab !== "browser" && webPreview?.mode === "side") closeWebPreview();
          }}
          onClose={() => {
            closeRightWorkspace();
            if (webPreview?.mode === "side") closeWebPreview();
          }}
          onReadDirectory={readActiveWorkspaceDirectory}
          onReadFile={readActiveWorkspaceFile}
          onChangeOpenFileContent={changeOpenFileContent}
          onSaveOpenFile={saveActiveWorkspaceFile}
          openTabs={fileTabs.tabs}
          onActivateFile={(path: string) => fileTabs.activateTab(path)}
          onCloseFile={(path: string) => fileTabs.closeTab(path)}
          onCloseOtherFiles={(path: string) => fileTabs.closeOtherTabs(path)}
          onCloseAllFiles={() => fileTabs.closeAllTabs()}
          onCreateWorkspaceFile={(parentPath: string, name: string) => workspaceFileMutations.createFile(parentPath, name)}
          onCreateWorkspaceFolder={(parentPath: string, name: string) => workspaceFileMutations.createFolder(parentPath, name)}
          onDeleteWorkspacePaths={(paths: string[]) => workspaceFileMutations.removePaths(paths)}
          onRenameWorkspacePath={(source: string, newName: string) => workspaceFileMutations.renamePath(source, newName)}
          onMoveWorkspacePath={(source: string, destinationDir: string) => workspaceFileMutations.movePath(source, destinationDir)}
          onRunTerminalCommand={(command: string, commandCwd: string, size: { rows: number; cols: number }) => void runTerminalCommand(command, commandCwd, size)}
          onWriteTerminalInput={(processId: string, input: string) => void writeTerminalInput(processId, input)}
          onTerminateTerminal={(processId: string) => void terminateTerminal(processId)}
          onResizeTerminal={(processId: string, size: { rows: number; cols: number }) => void resizeTerminal(processId, size)}
          onGitRpc={workspaceGitRpc}
          onOpenTerminal={(shell?: string) => {
            void window.codexUltraDesktop?.openTerminal({ cwd: activeWorkspaceCwd, sshCommand: activeWorkspaceSshCommand, sshCwd: activeWorkspaceSshCwd, shell });
          }}
          windowsDesktop={windowsDesktop}
        />
      </Suspense>
    );
}
