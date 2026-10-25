import { lazy, Suspense, useEffect, useState, type ReactNode } from "react";
import { Box, Button, Paper, Stack, TextField, Typography } from "@mui/material";
import DescriptionIcon from "@mui/icons-material/Description";
import FolderIcon from "@mui/icons-material/Folder";
import RefreshIcon from "@mui/icons-material/Refresh";
import SaveIcon from "@mui/icons-material/Save";
import { Group as PanelGroup, Panel } from "react-resizable-panels";
import { ResizeHandle } from "./ResizeHandle";
import type { FsDirectoryEntry } from "../state/codexClient";
import type { TranslateFn } from "../i18n";

const MonacoEditor = lazy(async () => {
  const module = await import("./MonacoEditor");
  return { default: module.MonacoEditor };
});

export type OpenWorkspaceFile = {
  path: string;
  content: string;
  savedContent: string;
  loading: boolean;
  saving: boolean;
};

type Props = {
  cwd: string;
  fileDirectories: Record<string, FsDirectoryEntry[]>;
  openFile: OpenWorkspaceFile | null;
  filesPanelLayout?: Record<string, number>;
  t: TranslateFn;
  onFilesPanelLayoutChange?: (layout: Record<string, number>) => void;
  onReadDirectory: (path: string) => void;
  onReadFile: (path: string) => void;
  onChangeOpenFileContent: (content: string) => void;
  onSaveOpenFile: () => void;
};

export function WorkspaceFilesSettingsPanel({
  cwd,
  fileDirectories,
  openFile,
  filesPanelLayout,
  t,
  onFilesPanelLayoutChange,
  onReadDirectory,
  onReadFile,
  onChangeOpenFileContent,
  onSaveOpenFile
}: Props) {
  const [rootPath, setRootPath] = useState(cwd);
  const [expandedDirs, setExpandedDirs] = useState<Record<string, boolean>>({});
  const dirty = openFile ? openFile.content !== openFile.savedContent : false;

  useEffect(() => {
    setRootPath(cwd);
  }, [cwd]);

  useEffect(() => {
    if (rootPath && !fileDirectories[rootPath]) {
      onReadDirectory(rootPath);
    }
  }, [fileDirectories, onReadDirectory, rootPath]);

  return (
    <Box sx={{ height: { xs: "auto", md: "min(68vh, 720px)" }, minHeight: 500, display: "grid", gridTemplateRows: "auto minmax(0, 1fr)" }}>
      <Paper variant="outlined" sx={{ p: 1.25, mb: 1, bgcolor: "background.default" }}>
        <Stack direction={{ xs: "column", sm: "row" }} spacing={1}>
          <TextField size="small" label={t("settings.workspace.files.rootPath")} value={rootPath} onChange={(event) => setRootPath(event.target.value)} sx={{ flex: 1 }} />
          <Button size="small" startIcon={<RefreshIcon />} onClick={() => onReadDirectory(rootPath)}>
            {t("settings.workspace.files.load")}
          </Button>
        </Stack>
      </Paper>
      <Box sx={{ minHeight: 0, height: "100%" }}>
        <PanelGroup
          orientation="horizontal"
          id="codex-react-ui-settings-files"
          defaultLayout={filesPanelLayout}
          onLayoutChanged={(layout, meta) => {
            if (!meta.isUserInteraction) {
              return;
            }
            onFilesPanelLayoutChange?.(layout);
          }}
        >
          <Panel id="settings-files-explorer" defaultSize="32%" minSize="20%" maxSize="52%">
            <Paper variant="outlined" sx={{ p: 1, height: "100%", minWidth: 0, overflow: "auto", bgcolor: "background.paper" }}>
              <Typography variant="subtitle2" sx={{ fontWeight: 800 }}>
                {t("settings.workspace.files.explorer")}
              </Typography>
              <Box sx={{ mt: 1 }}>{renderDirectory(rootPath, 0)}</Box>
            </Paper>
          </Panel>
          <ResizeHandle />
          <Panel id="settings-files-editor" defaultSize="68%" minSize="34%">
            <Paper variant="outlined" sx={{ minWidth: 0, height: "100%", overflow: "hidden", display: "grid", gridTemplateRows: "auto minmax(0, 1fr)", bgcolor: "background.paper" }}>
              <Stack direction="row" spacing={1} alignItems="center" sx={{ p: 1, borderBottom: "1px solid", borderColor: "divider" }}>
                <Box sx={{ flex: 1, minWidth: 0 }}>
                  <Typography variant="subtitle2" sx={{ fontWeight: 800, overflowWrap: "anywhere" }}>
                    {openFile?.path ?? t("settings.workspace.files.noFileSelected")}
                  </Typography>
                  {openFile && (
                    <Typography variant="caption" color="text.secondary">
                      {dirty ? t("settings.workspace.files.unsavedChanges") : t("settings.workspace.files.saved")}
                    </Typography>
                  )}
                </Box>
                <Button
                  size="small"
                  variant="contained"
                  startIcon={<SaveIcon />}
                  disabled={!openFile || openFile.loading || openFile.saving || !dirty}
                  onClick={onSaveOpenFile}
                >
                  {openFile?.saving ? t("settings.workspace.files.saving") : t("settings.workspace.files.save")}
                </Button>
              </Stack>
              <Box sx={{ minHeight: 0 }}>
                {openFile ? (
                  <Suspense fallback={<Box sx={{ p: 2 }}><Typography color="text.secondary">{t("settings.workspace.files.loadingEditor")}</Typography></Box>}>
                    <MonacoEditor
                      height="100%"
                      path={openFile.path}
                      language={languageForPath(openFile.path)}
                      value={openFile.content}
                      loading={t("settings.workspace.files.loadingEditor")}
                      options={{
                        ariaLabel: t("settings.workspace.files.editorContent"),
                        minimap: { enabled: false },
                        scrollBeyondLastLine: false,
                        fontSize: 13,
                        wordWrap: "on",
                        automaticLayout: true
                      }}
                      onChange={(value) => onChangeOpenFileContent(value ?? "")}
                    />
                  </Suspense>
                ) : (
                  <Box sx={{ p: 2 }}>
                    <Typography color="text.secondary">{t("settings.workspace.files.selectFile")}</Typography>
                  </Box>
                )}
              </Box>
            </Paper>
          </Panel>
        </PanelGroup>
      </Box>
    </Box>
  );

  function renderDirectory(path: string, depth: number): ReactNode {
    const entries = fileDirectories[path];
    if (!entries) {
      return (
        <Button size="small" startIcon={<FolderIcon />} onClick={() => onReadDirectory(path)} sx={{ justifyContent: "flex-start", pl: 1 + depth }}>
          {t("settings.workspace.files.loadDirectory", { name: path === rootPath ? t("settings.workspace.files.root") : path.split("/").pop() ?? path })}
        </Button>
      );
    }
    if (entries.length === 0) {
      return (
        <Typography variant="caption" color="text.secondary" sx={{ display: "block", pl: 1 + depth }}>
          {t("settings.workspace.files.emptyDirectory")}
        </Typography>
      );
    }
    return entries.map((entry) => (
      <Box key={entry.path}>
        <Button
          size="small"
          startIcon={entry.isDirectory ? <FolderIcon /> : <DescriptionIcon />}
          onClick={() => {
            if (entry.isDirectory) {
              setExpandedDirs((current) => ({ ...current, [entry.path]: !current[entry.path] }));
              if (!fileDirectories[entry.path]) {
                onReadDirectory(entry.path);
              }
              return;
            }
            if (entry.isFile) {
              onReadFile(entry.path);
            }
          }}
          sx={{ justifyContent: "flex-start", textAlign: "left", width: "100%", pl: 1 + depth * 1.5 }}
        >
          <Typography component="span" variant="caption" sx={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {entry.name}
          </Typography>
        </Button>
        {entry.isDirectory && expandedDirs[entry.path] && <Box>{renderDirectory(entry.path, depth + 1)}</Box>}
      </Box>
    ));
  }
}

function languageForPath(path: string): string {
  const extension = path.split(".").pop()?.toLowerCase();
  switch (extension) {
    case "ts":
    case "tsx":
      return "typescript";
    case "js":
    case "jsx":
      return "javascript";
    case "json":
      return "json";
    case "md":
      return "markdown";
    case "css":
      return "css";
    case "html":
      return "html";
    case "py":
      return "python";
    case "rs":
      return "rust";
    case "toml":
      return "toml";
    case "yaml":
    case "yml":
      return "yaml";
    default:
      return "plaintext";
  }
}
