import { Box, Button, CircularProgress, Dialog, DialogActions, DialogContent, DialogTitle, Stack, TextField, Typography } from "@mui/material";
import AddIcon from "@mui/icons-material/Add";
import CodeIcon from "@mui/icons-material/Code";
import FolderOpenIcon from "@mui/icons-material/FolderOpen";
import type { ChangeEvent as ReactChangeEvent, Dispatch, KeyboardEvent as ReactKeyboardEvent, ReactNode, SetStateAction } from "react";
import type { WorkspaceMode } from "../../app/workbench/appConstants";
import { normalizeSshWorkspaceCwd } from "../../app/workbench/sshUtils";
import { sanitizeDomId } from "../../app/workbench/appUtils";
import { RecentWorkspacesControl } from "../RecentWorkspacesControl";
import type { TranslateFn } from "../../i18n";
import type { FsDirectoryEntry, LocalWorkspaceInfo } from "../../state/codexClient";
import type { RecentWorkspaceItem } from "../../utils/recentWorkspaces";
import { joinWorkspacePath, normalizeWorkspaceCwd, normalizeWorkspaceRoots, resolveTildeWorkspacePath } from "../../workspacePaths";

export interface WorkspacePickerDialogProps {
  t: TranslateFn;
  workspacePickerOpen: boolean;
  setWorkspacePickerOpen: Dispatch<SetStateAction<boolean>>;
  workspacePickerPath: string;
  setWorkspacePickerPath: Dispatch<SetStateAction<string>>;
  workspaceMode: WorkspaceMode;
  setWorkspaceMode: Dispatch<SetStateAction<WorkspaceMode>>;
  sshConfigHostAlias: string;
  setSshConfigHostAlias: Dispatch<SetStateAction<string>>;
  sshConfigHostControl: ReactNode;
  sshCommand: string;
  setSshCommand: Dispatch<SetStateAction<string>>;
  sshDetectedHome: string;
  localWorkspaceDefaultPath: string;
  localWorkspaceProjectsPath: string;
  workspacePickerParent: string | null;
  readDirectory: (path: string) => Promise<unknown>;
  windowsWorkspaceHost: boolean;
  localWorkspaceInfo: LocalWorkspaceInfo | null;
  workspaceNewFolderName: string;
  setWorkspaceNewFolderName: Dispatch<SetStateAction<string>>;
  createWorkspaceFolder: () => Promise<unknown>;
  workspaceCreateBusy: boolean;
  workspacePickerLoading: boolean;
  workspacePickerFolders: FsDirectoryEntry[];
  workspacePickerFiles: FsDirectoryEntry[];
  openCodeWorkspaceFile: (path: string) => Promise<unknown>;
  workspacePickerPurpose: "primary" | "additional";
  cwd: string;
  sshCwd: string;
  additionalRoots: string[];
  setAdditionalRoots: Dispatch<SetStateAction<string[]>>;
  setNewChatAdditionalRootsExpanded: Dispatch<SetStateAction<boolean>>;
  setSshCwd: Dispatch<SetStateAction<string>>;
  setCwd: Dispatch<SetStateAction<string>>;
  recordRecentWorkspace: (path: string, mode: WorkspaceMode, sshCommand?: string) => void;
  persistWorkspaceForActiveThread: (nextCwd: string, nextRoots: string[], nextWorkspaceFilePath?: string | null) => void;
  applyWorkspaceVmPolicyForCwd: (targetPath: string) => void;
  workspaceHostPlatform: string | undefined;
}

export function WorkspacePickerDialog({
  t,
  workspacePickerOpen,
  setWorkspacePickerOpen,
  workspacePickerPath,
  setWorkspacePickerPath,
  workspaceMode,
  setWorkspaceMode,
  sshConfigHostAlias,
  setSshConfigHostAlias,
  sshConfigHostControl,
  sshCommand,
  setSshCommand,
  sshDetectedHome,
  localWorkspaceDefaultPath,
  localWorkspaceProjectsPath,
  workspacePickerParent,
  readDirectory,
  windowsWorkspaceHost,
  localWorkspaceInfo,
  workspaceNewFolderName,
  setWorkspaceNewFolderName,
  createWorkspaceFolder,
  workspaceCreateBusy,
  workspacePickerLoading,
  workspacePickerFolders,
  workspacePickerFiles,
  openCodeWorkspaceFile,
  workspacePickerPurpose,
  cwd,
  sshCwd,
  additionalRoots,
  setAdditionalRoots,
  setNewChatAdditionalRootsExpanded,
  setSshCwd,
  setCwd,
  recordRecentWorkspace,
  persistWorkspaceForActiveThread,
  applyWorkspaceVmPolicyForCwd,
  workspaceHostPlatform,
}: WorkspacePickerDialogProps) {
  return (
      <Dialog
        data-testid="workspace-folder-picker-dialog"
        open={workspacePickerOpen}
        onClose={() => setWorkspacePickerOpen(false)}
        maxWidth="sm"
        fullWidth
      >
        <DialogTitle>
          <Stack direction="row" spacing={1} alignItems="center">
            <FolderOpenIcon color="primary" />
            <Box sx={{ minWidth: 0 }}>
              <Typography component="span" variant="h6" sx={{ fontWeight: 850 }}>
                {t("workspace.pickerTitle")}
              </Typography>
              <Typography variant="caption" color="text.secondary" sx={{ display: "block" }}>
                {t("workspace.pickerSubtitle")}
              </Typography>
            </Box>
          </Stack>
        </DialogTitle>
        <DialogContent dividers>
          <Stack spacing={1.5}>
            <TextField
              size="small"
              label={t("workspace.currentFolder")}
              value={workspacePickerPath}
              onChange={(event: ReactChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setWorkspacePickerPath(event.target.value)}
              onKeyDown={(event: ReactKeyboardEvent<HTMLDivElement>) => {
                if (event.key === "Enter") {
                  void readDirectory(workspacePickerPath);
                }
              }}
              fullWidth
              inputProps={{ sx: { fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace", fontSize: 13 } }}
            />
                    {workspaceMode === "ssh" && !sshConfigHostAlias && (
              <Stack spacing={1}>
                {sshConfigHostControl}
                {!sshConfigHostAlias && (
                  <TextField
                    size="small"
                    label={t("workspace.sshCommand")}
                    value={sshCommand}
                    onChange={(event: ReactChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => { setSshConfigHostAlias(""); setSshCommand(event.target.value); }}
                    helperText={t("workspace.sshPickerHelp")}
                    fullWidth
                    inputProps={{ sx: { fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace", fontSize: 13 } }}
                  />
                )}
              </Stack>
            )}
            <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
              <Button size="small" variant="outlined" onClick={() => setWorkspacePickerPath(workspaceMode === "ssh" ? sshDetectedHome : localWorkspaceDefaultPath)}>
                {t("workspace.home")}
              </Button>
              <Button size="small" variant="outlined" onClick={() => setWorkspacePickerPath(workspaceMode === "ssh" ? `${sshDetectedHome}/projects` : localWorkspaceProjectsPath)}>
                {t("workspace.projects")}
              </Button>
              <Button size="small" variant="outlined" disabled={!workspacePickerParent} onClick={() => workspacePickerParent && setWorkspacePickerPath(workspacePickerParent)}>
                {t("workspace.parent")}
              </Button>
              <Button size="small" variant="text" onClick={() => void readDirectory(workspacePickerPath)}>
                {t("app.refresh")}
              </Button>
            </Stack>
            <RecentWorkspacesControl
              currentPath={workspacePickerPath}
              onSelectWorkspace={(item: RecentWorkspaceItem) => {
                setWorkspacePickerPath(item.path);
                if (item.mode === "ssh") {
                  setWorkspaceMode("ssh");
                  if (item.sshCommand) setSshCommand(item.sshCommand);
                } else {
                  setWorkspaceMode("local");
                }
                void readDirectory(item.path);
              }}
              showChips={true}
            />
            {workspaceMode === "local" && windowsWorkspaceHost && (localWorkspaceInfo?.roots.length ?? 0) > 0 ? (
              <Box>
                <Typography variant="caption" color="text.secondary" sx={{ display: "block", mb: 0.75, fontWeight: 750 }}>
                  {t("workspace.availableDrives")}
                </Typography>
                <Stack direction="row" spacing={0.75} flexWrap="wrap" useFlexGap>
                  {localWorkspaceInfo?.roots.map((root: { path: string; label: string }) => (
                    <Button
                      key={root.path}
                      size="small"
                      variant={normalizeWorkspaceCwd(workspacePickerPath).toLowerCase().startsWith(root.path.toLowerCase()) ? "contained" : "outlined"}
                      onClick={() => setWorkspacePickerPath(root.path)}
                      aria-label={t("workspace.openDrive", { drive: root.label })}
                    >
                      {root.label}
                    </Button>
                  ))}
                </Stack>
              </Box>
            ) : null}
            <Stack direction={{ xs: "column", sm: "row" }} spacing={1} alignItems={{ xs: "stretch", sm: "flex-start" }}>
              <TextField
                size="small"
                label={t("workspace.newFolder")}
                value={workspaceNewFolderName}
                onChange={(event: ReactChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setWorkspaceNewFolderName(event.target.value)}
                onKeyDown={(event: ReactKeyboardEvent<HTMLDivElement>) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    void createWorkspaceFolder();
                  }
                }}
                disabled={workspaceCreateBusy}
                helperText={t("workspace.newFolderHelp")}
                fullWidth
                inputProps={{ sx: { fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace", fontSize: 13 } }}
              />
              <Button
                variant="contained"
                startIcon={workspaceCreateBusy ? <CircularProgress color="inherit" size={16} /> : <AddIcon />}
                onClick={() => void createWorkspaceFolder()}
                disabled={workspaceCreateBusy || !workspaceNewFolderName.trim()}
                sx={{ minWidth: 132 }}
              >
                {t("workspace.createFolder")}
              </Button>
            </Stack>
            <Box
              sx={{
                minHeight: 220,
                maxHeight: 360,
                overflow: "auto",
                border: "1px solid",
                borderColor: "divider",
                borderRadius: 1,
                bgcolor: "background.default",
                p: 0.75
              }}
            >
              {workspacePickerLoading ? (
                <Stack spacing={1} alignItems="center" justifyContent="center" sx={{ minHeight: 200, textAlign: "center", color: "text.secondary" }}>
                  <CircularProgress size={22} />
                  <Typography variant="body2">{t("workspace.loadingFolders")}</Typography>
                </Stack>
              ) : workspacePickerFolders.length > 0 || workspacePickerFiles.length > 0 ? (
                <Stack spacing={0.5}>
                  {workspacePickerFiles.map((entry: FsDirectoryEntry) => (
                    <Button
                      key={entry.path}
                      data-testid={`workspace-file-option-${sanitizeDomId(entry.path)}`}
                      variant="text"
                      color="inherit"
                      startIcon={<CodeIcon />}
                      onClick={() => void openCodeWorkspaceFile(entry.path)}
                      sx={{ justifyContent: "flex-start", px: 1, fontWeight: 700, "& .MuiButton-startIcon": { color: "secondary.main" } }}
                    >
                      <Box component="span" sx={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {entry.name}
                      </Box>
                    </Button>
                  ))}
                  {workspacePickerFolders.map((entry: FsDirectoryEntry) => (
                    <Button
                      key={entry.path}
                      data-testid={`workspace-folder-option-${sanitizeDomId(entry.path)}`}
                      variant="text"
                      color="inherit"
                      startIcon={<FolderOpenIcon />}
                      onClick={() => setWorkspacePickerPath(entry.path)}
                      sx={{
                        justifyContent: "flex-start",
                        px: 1,
                        fontWeight: 700,
                        "& .MuiButton-startIcon": { color: "primary.main" }
                      }}
                    >
                      <Box component="span" sx={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {entry.name}
                      </Box>
                    </Button>
                  ))}
                </Stack>
              ) : (
                <Stack spacing={1} alignItems="center" justifyContent="center" sx={{ minHeight: 200, textAlign: "center", color: "text.secondary" }}>
                  <FolderOpenIcon />
                  <Typography variant="body2">{t("workspace.noFolders")}</Typography>
                  <Button size="small" onClick={() => void readDirectory(workspacePickerPath)}>
                    {t("workspace.loadFolders")}
                  </Button>
                </Stack>
              )}
            </Box>
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setWorkspacePickerOpen(false)}>{t("workspace.cancel")}</Button>
          <Button
            variant="contained"
            onClick={() => {
              if (workspacePickerPurpose === "additional") {
                const normalizedPrimary = workspaceMode === "ssh"
                  ? normalizeSshWorkspaceCwd(sshCwd)
                  : normalizeWorkspaceCwd(cwd);
                const next = normalizeWorkspaceRoots(normalizedPrimary, [...additionalRoots, workspacePickerPath]);
                setAdditionalRoots(next);
                persistWorkspaceForActiveThread(normalizedPrimary, next);
                setNewChatAdditionalRootsExpanded(true);
              } else if (workspaceMode === "ssh") {
                const nextCwd = normalizeSshWorkspaceCwd(workspacePickerPath) || workspacePickerPath;
                setSshCwd(nextCwd);
                recordRecentWorkspace(nextCwd, "ssh", sshCommand);
                persistWorkspaceForActiveThread(nextCwd, additionalRoots, null);
              } else {
                const nextCwd = resolveTildeWorkspacePath(normalizeWorkspaceCwd(workspacePickerPath), localWorkspaceInfo?.home, workspaceHostPlatform);
                const nextRoots = normalizeWorkspaceRoots(nextCwd, additionalRoots);
                setCwd(nextCwd);
                setAdditionalRoots(nextRoots);
                recordRecentWorkspace(nextCwd, "local");
                applyWorkspaceVmPolicyForCwd(nextCwd);
                persistWorkspaceForActiveThread(nextCwd, nextRoots, joinWorkspacePath(nextCwd, "cxu.code-workspace"));
              }
              setWorkspacePickerOpen(false);
            }}
          >
            {t("workspace.useFolder")}
          </Button>
        </DialogActions>
      </Dialog>
  );
}