import { lazy, Suspense, useEffect, useMemo, useRef, useState, type DragEvent, type ReactNode } from "react";
import {
  Box,
  Button,
  Checkbox,
  Divider,
  FormControlLabel,
  IconButton,
  InputAdornment,
  Menu,
  MenuItem,
  Stack,
  TextField,
  Tooltip,
  Typography
} from "@mui/material";
import ChevronRightIcon from "@mui/icons-material/ChevronRight";
import CloseIcon from "@mui/icons-material/Close";
import CodeOutlinedIcon from "@mui/icons-material/CodeOutlined";
import CreateNewFolderOutlinedIcon from "@mui/icons-material/CreateNewFolderOutlined";
import DescriptionOutlinedIcon from "@mui/icons-material/DescriptionOutlined";
import FolderOutlinedIcon from "@mui/icons-material/FolderOutlined";
import NoteAddOutlinedIcon from "@mui/icons-material/NoteAddOutlined";
import RefreshIcon from "@mui/icons-material/Refresh";
import SaveIcon from "@mui/icons-material/Save";
import SearchIcon from "@mui/icons-material/Search";
import { Group as PanelGroup, Panel } from "react-resizable-panels";
import type { FsDirectoryEntry } from "../state/codexClient";
import type { OpenWorkspaceFile } from "./WorkspaceFilesSettingsPanel";
import { ResizeHandle } from "./ResizeHandle";
import { buildWorkspaceDragPayload, readWorkspaceDragData, WORKSPACE_DRAG_MIME, writeWorkspaceDragData } from "./workspaceDrag";

const WorkspaceCodeEditor = lazy(async () => {
  const module = await import("./WorkspaceCodeEditor");
  return { default: module.WorkspaceCodeEditor };
});

type Props = {
  cwd: string;
  fileDirectories: Record<string, FsDirectoryEntry[]>;
  openFile: OpenWorkspaceFile | null;
  /** All open editor tabs (VSCode-style); falls back to [openFile] when absent. */
  openTabs?: OpenWorkspaceFile[];
  onReadDirectory: (path: string) => void;
  onReadFile: (path: string) => void;
  onChangeOpenFileContent: (content: string) => void;
  onSaveOpenFile: () => void;
  onActivateFile?: (path: string) => void;
  onCloseFile?: (path: string) => void;
  onCloseOtherFiles?: (path: string) => void;
  onCloseAllFiles?: () => void;
  /** VSCode-style mutations (optional: wired by App via useWorkspaceFileMutations). */
  onCreateFile?: (parentPath: string, name: string) => Promise<string>;
  onCreateFolder?: (parentPath: string, name: string) => Promise<string>;
  onDeletePaths?: (paths: string[]) => Promise<void>;
  onRenamePath?: (source: string, newName: string) => Promise<string>;
  onMovePath?: (source: string, destinationDir: string) => Promise<string>;
  mutationsBusy?: boolean;
};

export function WorkspaceExplorerPanel({
  cwd,
  fileDirectories,
  openFile,
  openTabs,
  onReadDirectory,
  onReadFile,
  onChangeOpenFileContent,
  onSaveOpenFile,
  onActivateFile,
  onCloseFile,
  onCloseOtherFiles,
  onCloseAllFiles,
  onCreateFile,
  onCreateFolder,
  onDeletePaths,
  onRenamePath,
  onMovePath,
  mutationsBusy = false
}: Props) {
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  const [query, setQuery] = useState("");
  const [showHidden, setShowHidden] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const [contextTarget, setContextTarget] = useState<FsDirectoryEntry | null>(null);
  const [contextAnchor, setContextAnchor] = useState<{ x: number; y: number } | null>(null);
  const [renamingPath, setRenamingPath] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState("");
  const [creatingIn, setCreatingIn] = useState<{ parent: string; kind: "file" | "folder" } | null>(null);
  const [createDraft, setCreateDraft] = useState("");
  /** VSCode-style code view: tree collapses, the editor takes the full width. */
  const [codeView, setCodeView] = useState(false);
  const dirty = Boolean(openFile && openFile.content !== openFile.savedContent);
  const tabs = openTabs ?? (openFile ? [openFile] : []);
  const editorStats = useMemo(() => {
    if (!openFile || openFile.loading) return null;
    const lines = openFile.content.split("\n");
    return { lines: lines.length, language: editorLanguageForPath(openFile.path) };
  }, [openFile]);
  const previousCwdRef = useRef<string | null>(null);
  const requestedDirectoriesRef = useRef(new Set<string>());

  useEffect(() => {
    if (previousCwdRef.current === cwd) {
      return;
    }
    previousCwdRef.current = cwd;
    requestedDirectoriesRef.current.clear();
    setExpanded(new Set());
    setQuery("");
    setSelected(new Set());
    setContextTarget(null);
    setContextAnchor(null);
    setRenamingPath(null);
    setCreatingIn(null);
  }, [cwd]);

  useEffect(() => {
    if (cwd && !fileDirectories[cwd] && !requestedDirectoriesRef.current.has(cwd)) {
      requestedDirectoriesRef.current.add(cwd);
      onReadDirectory(cwd);
    }
    if (fileDirectories[cwd]) requestedDirectoriesRef.current.delete(cwd);
  }, [cwd, fileDirectories[cwd], onReadDirectory]);

  const searchResults = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    if (!normalized) return [];
    const seen = new Set<string>();
    const results: FsDirectoryEntry[] = [];
    for (const entries of Object.values(fileDirectories)) {
      for (const entry of entries) {
        if (seen.has(entry.path) || (!showHidden && isHiddenEntry(entry))) continue;
        if (entry.path.toLowerCase().includes(normalized)) {
          seen.add(entry.path);
          results.push(entry);
        }
      }
    }
    return results.sort(compareEntries).slice(0, 100);
  }, [fileDirectories, query, showHidden]);

  const refreshVisible = () => {
    onReadDirectory(cwd);
    for (const path of expanded) onReadDirectory(path);
  };

  const toggleSelected = (path: string, additive: boolean) => {
    setSelected((current) => {
      if (!additive) return new Set([path]);
      const next = new Set(current);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  };

  const openContextMenu = (event: React.MouseEvent, entry: FsDirectoryEntry) => {
    event.preventDefault();
    event.stopPropagation();
    setSelected((current) => (current.has(entry.path) ? current : new Set([entry.path])));
    setContextTarget(entry);
    setContextAnchor({ x: event.clientX, y: event.clientY });
  };

  const closeContextMenu = () => {
    setContextTarget(null);
    setContextAnchor(null);
  };

  const startRename = (entry: FsDirectoryEntry) => {
    setRenameDraft(entry.name);
    setRenamingPath(entry.path);
    closeContextMenu();
  };

  const commitRename = async () => {
    if (!renamingPath || !onRenamePath) {
      setRenamingPath(null);
      return;
    }
    const draft = renameDraft.trim();
    const currentName = renamingPath.replace(/[\\/]+$/, "").split(/[\\/]/).pop() ?? "";
    if (!draft || draft === currentName) {
      setRenamingPath(null);
      return;
    }
    try {
      const destination = await onRenamePath(renamingPath, draft);
      setSelected(new Set([destination]));
    } catch {
      // error already surfaced via onError
    } finally {
      setRenamingPath(null);
    }
  };

  const deleteSelection = async (paths: string[]) => {
    if (!onDeletePaths || paths.length === 0) return;
    const label = paths.length === 1 ? paths[0] : `${paths.length} items`;
    if (!window.confirm(`Delete ${label}? This cannot be undone.`)) return;
    try {
      await onDeletePaths(paths);
      setSelected(new Set());
    } catch {
      // error already surfaced via onError
    } finally {
      closeContextMenu();
    }
  };

  const commitCreate = async () => {
    if (!creatingIn) return;
    const name = createDraft.trim();
    if (!name) {
      setCreatingIn(null);
      return;
    }
    try {
      if (creatingIn.kind === "file" && onCreateFile) {
        const created = await onCreateFile(creatingIn.parent, name);
        setExpanded((current) => new Set(current).add(creatingIn.parent));
        setSelected(new Set([created]));
        onReadFile(created);
      } else if (creatingIn.kind === "folder" && onCreateFolder) {
        const created = await onCreateFolder(creatingIn.parent, name);
        setExpanded((current) => new Set(current).add(creatingIn.parent).add(created));
        setSelected(new Set([created]));
      }
    } catch {
      // error already surfaced via onError
    } finally {
      setCreatingIn(null);
    }
  };

  const handleTreeKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === "Delete" || event.key === "Backspace") {
      if (renamingPath || creatingIn) return;
      const paths = [...selected];
      if (paths.length > 0) {
        event.preventDefault();
        void deleteSelection(paths);
      }
    } else if (event.key === "F2" && selected.size === 1) {
      const path = [...selected][0]!;
      const entry = findEntry(path);
      if (entry) {
        event.preventDefault();
        startRename(entry);
      }
    } else if (event.key === "Escape") {
      setRenamingPath(null);
      setCreatingIn(null);
      closeContextMenu();
    } else if (event.key === "Enter" && renamingPath) {
      event.preventDefault();
      void commitRename();
    } else if (event.key === "Enter" && creatingIn) {
      event.preventDefault();
      void commitCreate();
    }
  };

  const findEntry = (path: string): FsDirectoryEntry | null => {
    for (const entries of Object.values(fileDirectories)) {
      const found = entries.find((entry) => entry.path === path);
      if (found) return found;
    }
    return null;
  };

  const handleDropOnDirectory = async (event: DragEvent<HTMLDivElement>, destinationDir: string) => {
    event.preventDefault();
    event.stopPropagation();
    if (!onMovePath) return;
    const payload = readWorkspaceDragData(event.dataTransfer);
    if (!payload || !payload.path || payload.path === destinationDir) return;
    try {
      const destination = await onMovePath(payload.path, destinationDir);
      setSelected(new Set([destination]));
    } catch {
      // error already surfaced via onError
    }
  };

  return (
    <Box
      data-testid="workspace-explorer-panel"
      sx={{ height: "100%", minHeight: 0, display: "grid", gridTemplateRows: "auto minmax(0, 1fr)" }}
    >
      <Stack
        direction="row"
        spacing={0.75}
        alignItems="center"
        sx={{ px: 1, py: 0.75, borderBottom: "1px solid", borderColor: "divider" }}
      >
        <TextField
          size="small"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search loaded files"
          inputProps={{ "aria-label": "Search workspace files" }}
          InputProps={{
            startAdornment: (
              <InputAdornment position="start">
                <SearchIcon fontSize="small" />
              </InputAdornment>
            )
          }}
          sx={{ flex: 1, minWidth: 0 }}
        />
        <FormControlLabel
          control={<Checkbox size="small" checked={showHidden} onChange={(event) => setShowHidden(event.target.checked)} />}
          label="Hidden"
          sx={{ m: 0, "& .MuiFormControlLabel-label": { fontSize: 12 } }}
        />
        <Tooltip title="New file in workspace root">
          <span>
            <IconButton
              size="small"
              aria-label="New file"
              disabled={mutationsBusy}
              onClick={() => { setCreateDraft(""); setCreatingIn({ parent: cwd, kind: "file" }); }}
            >
              <NoteAddOutlinedIcon fontSize="small" />
            </IconButton>
          </span>
        </Tooltip>
        <Tooltip title="New folder in workspace root">
          <span>
            <IconButton
              size="small"
              aria-label="New folder"
              disabled={mutationsBusy}
              onClick={() => { setCreateDraft(""); setCreatingIn({ parent: cwd, kind: "folder" }); }}
            >
              <CreateNewFolderOutlinedIcon fontSize="small" />
            </IconButton>
          </span>
        </Tooltip>
        <Tooltip title={codeView ? "Back to Explorer (tree + editor)" : "Code view (editor full width)"}>
          <span>
            <IconButton
              size="small"
              aria-label={codeView ? "Exit code view" : "Enter code view"}
              onClick={() => setCodeView((current) => !current)}
            >
              <CodeOutlinedIcon fontSize="small" />
            </IconButton>
          </span>
        </Tooltip>
        <Tooltip title="Refresh visible folders">
          <IconButton size="small" aria-label="Refresh Explorer" onClick={refreshVisible}>
            <RefreshIcon fontSize="small" />
          </IconButton>
        </Tooltip>
      </Stack>

      <PanelGroup orientation="vertical" id="right-workspace-explorer">
        {!codeView && (
          <>
            <Panel id="right-explorer-tree" defaultSize="42%" minSize="22%">
              <Box
                role="tree"
                aria-label="Workspace files"
                tabIndex={0}
                onKeyDown={handleTreeKeyDown}
                onClick={() => setSelected(new Set())}
                sx={{ height: "100%", overflow: "auto", py: 0.5, outline: "none" }}
              >
                {query.trim() ? (
                  searchResults.length > 0 ? (
                    searchResults.map((entry) => renderSearchResult(entry))
                  ) : (
                    <EmptyLine>No matching loaded files.</EmptyLine>
                  )
                ) : (
                  renderDirectory(cwd, 0, true)
                )}
              </Box>
            </Panel>
            <ResizeHandle orientation="vertical" />
          </>
        )}
        <Panel id="right-explorer-editor" defaultSize={codeView ? "100%" : "58%"} minSize="30%">
          <Box sx={{ height: "100%", minHeight: 0, display: "grid", gridTemplateRows: "auto auto minmax(0, 1fr) auto" }}>
            {tabs.length > 1 && (
              <Stack
                direction="row"
                role="tablist"
                aria-label="Open editors"
                sx={{ minHeight: 34, borderBottom: "1px solid", borderColor: "divider", overflowX: "auto" }}
              >
                {tabs.map((tab) => {
                  const tabDirty = !tab.loading && tab.content !== tab.savedContent;
                  const active = openFile?.path === tab.path;
                  return (
                    <Box
                      key={tab.path}
                      role="tab"
                      aria-selected={active}
                      onClick={() => onActivateFile?.(tab.path)}
                      onContextMenu={(event) => {
                        event.preventDefault();
                        event.stopPropagation();
                        const entry = { name: baseName(tab.path), path: tab.path, isDirectory: false, isFile: true };
                        openContextMenu(event, entry);
                      }}
                      sx={{
                        display: "flex",
                        alignItems: "center",
                        gap: 0.5,
                        px: 1,
                        minHeight: 34,
                        maxWidth: 180,
                        flex: "0 0 auto",
                        cursor: "pointer",
                        borderBottom: active ? "2px solid" : "2px solid transparent",
                        borderColor: active ? "primary.main" : "transparent",
                        bgcolor: active ? "action.selected" : "transparent"
                      }}
                    >
                      <DescriptionOutlinedIcon fontSize="small" color={active ? "primary" : "action"} />
                      <Typography variant="caption" noWrap title={tab.path} sx={{ fontStyle: tabDirty ? "italic" : "normal" }}>
                        {tabDirty ? "● " : ""}{baseName(tab.path)}
                      </Typography>
                      {onCloseFile && (
                        <IconButton
                          size="small"
                          aria-label={`Close ${tab.path}`}
                          onClick={(event) => {
                            event.stopPropagation();
                            if (tabDirty && !window.confirm(`Close ${tab.path} without saving? Unsaved changes will be lost.`)) return;
                            onCloseFile(tab.path);
                          }}
                          sx={{ p: 0.25 }}
                        >
                          <CloseIcon sx={{ fontSize: 14 }} />
                        </IconButton>
                      )}
                    </Box>
                  );
                })}
              </Stack>
            )}
            <Stack
              direction="row"
              spacing={1}
              alignItems="center"
              sx={{ minHeight: 42, px: 1, borderBottom: "1px solid", borderColor: "divider" }}
            >
              <Box sx={{ flex: 1, minWidth: 0 }}>
                <Typography variant="caption" sx={{ display: "block", fontWeight: 750 }} noWrap title={openFile?.path}>
                  {openFile ? relativePath(cwd, openFile.path) : "Select a file"}
                </Typography>
                {openFile && (
                  <Typography variant="caption" color="text.secondary">
                    {openFile.loading
                      ? "Loading"
                      : dirty
                        ? `Unsaved changes · ${openFile.content.split("\n").length} lines`
                        : `Saved · ${openFile.content.split("\n").length} lines`}
                  </Typography>
                )}
              </Box>
              <Tooltip title="Save file">
                <span>
                  <IconButton
                    size="small"
                    aria-label="Save Explorer file"
                    disabled={!openFile || openFile.loading || openFile.saving || !dirty}
                    onClick={onSaveOpenFile}
                  >
                    <SaveIcon fontSize="small" />
                  </IconButton>
                </span>
              </Tooltip>
            </Stack>
            <Box sx={{ minHeight: 0, height: "100%", overflow: "hidden", display: "flex", flexDirection: "column" }}>
              {openFile ? (
                openFile.loading ? (
                  <EmptyLine>Loading {openFile.path}...</EmptyLine>
                ) : (
                  <>
                  <Suspense fallback={<EmptyLine>Loading editor...</EmptyLine>}>
                    <Box sx={{ flex: 1, minHeight: 0, overflow: "hidden" }}>
                      <WorkspaceCodeEditor path={openFile.path} content={openFile.content} onChange={onChangeOpenFileContent} />
                    </Box>
                  </Suspense>
                  {openFile.content.length === 0 && (
                    <Typography variant="caption" color="text.secondary" sx={{ px: 1, py: 0.5 }}>
                      File is empty or failed to load — try Refresh Explorer and reopen the file.
                    </Typography>
                  )}
                  </>
                )
              ) : (
                <EmptyLine>Open a file from the tree to preview or edit it.</EmptyLine>
              )}
            </Box>
            <Stack
              direction="row"
              spacing={1.5}
              alignItems="center"
              sx={{ minHeight: 26, px: 1, borderTop: "1px solid", borderColor: "divider" }}
            >
              <Typography variant="caption" color="text.secondary" noWrap>
                {editorStats ? `${editorStats.lines} lines` : "—"}
              </Typography>
              <Box sx={{ flex: 1 }} />
              <Typography variant="caption" color="text.secondary" noWrap>
                {editorStats?.language ?? "—"}
              </Typography>
              <Typography variant="caption" color="text.secondary" noWrap>
                {openFile && !openFile.loading ? (dirty ? "● Unsaved" : "✓ Saved") : "—"}
              </Typography>
            </Stack>
          </Box>
        </Panel>
      </PanelGroup>
      <Menu
        open={Boolean(contextTarget && contextAnchor)}
        onClose={closeContextMenu}
        anchorReference="anchorPosition"
        anchorPosition={contextAnchor ? { top: contextAnchor.y, left: contextAnchor.x } : undefined}
      >
        {contextTarget?.isDirectory && (
          <MenuItem
            disabled={mutationsBusy || !onCreateFile}
            onClick={() => { if (contextTarget) { setCreateDraft(""); setCreatingIn({ parent: contextTarget.path, kind: "file" }); setExpanded((current) => new Set(current).add(contextTarget.path)); } closeContextMenu(); }}
          >
            New file here
          </MenuItem>
        )}
        {contextTarget?.isDirectory && (
          <MenuItem
            disabled={mutationsBusy || !onCreateFolder}
            onClick={() => { if (contextTarget) { setCreateDraft(""); setCreatingIn({ parent: contextTarget.path, kind: "folder" }); setExpanded((current) => new Set(current).add(contextTarget.path)); } closeContextMenu(); }}
          >
            New folder here
          </MenuItem>
        )}
        {contextTarget?.isFile && (
          <MenuItem
            onClick={() => { if (contextTarget) onReadFile(contextTarget.path); closeContextMenu(); }}
          >
            Open
          </MenuItem>
        )}
        <MenuItem
          disabled={!onRenamePath || selected.size !== 1}
          onClick={() => { if (contextTarget) startRename(contextTarget); }}
        >
          Rename (F2)
        </MenuItem>
        <MenuItem
          disabled={!onDeletePaths || selected.size === 0}
          onClick={() => void deleteSelection([...selected])}
        >
          Delete ({selected.size})
        </MenuItem>
        <Divider />
        <MenuItem
          onClick={() => { refreshVisible(); closeContextMenu(); }}
        >
          Refresh
        </MenuItem>
        <MenuItem
          onClick={() => { if (contextTarget?.isDirectory) { setExpanded((current) => { const next = new Set(current); next.add(contextTarget.path); return next; }); onReadDirectory(contextTarget.path); } closeContextMenu(); }}
        >
          Reveal in tree
        </MenuItem>
      </Menu>
    </Box>
  );

  function renderSearchResult(entry: FsDirectoryEntry) {
    return (
      <Button
        key={entry.path}
        size="small"
        startIcon={entry.isDirectory ? <FolderOutlinedIcon fontSize="small" /> : <DescriptionOutlinedIcon fontSize="small" />}
        onClick={() => {
          if (entry.isDirectory) {
            setQuery("");
            setExpanded((current) => new Set(current).add(entry.path));
            onReadDirectory(entry.path);
          } else {
            onReadFile(entry.path);
          }
        }}
        draggable={entry.isFile}
        onDragStart={(event) => startWorkspaceDrag(event, entry)}
        sx={{ width: "100%", minHeight: 30, justifyContent: "flex-start", px: 1, textTransform: "none" }}
      >
        <Typography variant="caption" noWrap title={entry.path}>
          {relativePath(cwd, entry.path)}
        </Typography>
      </Button>
    );
  }

  function renderDirectory(path: string, depth: number, root = false): ReactNode {
    const entries = fileDirectories[path];
    if (!entries) {
      return (
        <Button
          size="small"
          startIcon={<FolderOutlinedIcon fontSize="small" />}
          onClick={() => onReadDirectory(path)}
          sx={{ justifyContent: "flex-start", pl: 1 + depth * 1.5, textTransform: "none" }}
        >
          Load {root ? baseName(path) || path : baseName(path)}
        </Button>
      );
    }

    const visibleEntries = entries.filter((entry) => showHidden || !isHiddenEntry(entry)).sort(compareEntries);
    return (
      <>
        {root && (
          <TreeRow
            entry={{ name: baseName(path) || path, path, isDirectory: true, isFile: false }}
            depth={depth}
            expanded
            onClick={() => undefined}
          />
        )}
        {visibleEntries.length === 0 && <EmptyLine indent={depth + 1}>This folder is empty.</EmptyLine>}
        {visibleEntries.map((entry) => {
          const isExpanded = entry.isDirectory && expanded.has(entry.path);
          const isRenaming = renamingPath === entry.path;
          return (
            <Box key={entry.path}>
              {isRenaming ? (
                <Box sx={{ display: "flex", alignItems: "center", gap: 0.5, pl: 0.5 + (depth + 1) * 1.5, pr: 1, py: 0.25 }}>
                  <TextField
                    size="small"
                    autoFocus
                    value={renameDraft}
                    onChange={(event) => setRenameDraft(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") {
                        event.preventDefault();
                        void commitRename();
                      } else if (event.key === "Escape") {
                        setRenamingPath(null);
                      }
                      event.stopPropagation();
                    }}
                    onClick={(event) => event.stopPropagation()}
                    inputProps={{ "aria-label": `Rename ${entry.path}` }}
                    sx={{ flex: 1 }}
                  />
                </Box>
              ) : (
                <TreeRow
                  entry={entry}
                  depth={depth + 1}
                  expanded={isExpanded}
                  selected={selected.has(entry.path)}
                  open={openFile?.path === entry.path}
                  onClick={(event) => {
                    event.stopPropagation();
                    toggleSelected(entry.path, event.ctrlKey || event.metaKey || event.shiftKey);
                    if (entry.isDirectory) {
                      setExpanded((current) => {
                        const next = new Set(current);
                        if (next.has(entry.path)) next.delete(entry.path);
                        else next.add(entry.path);
                        return next;
                      });
                      if (!fileDirectories[entry.path]) onReadDirectory(entry.path);
                    } else if (entry.isFile) {
                      onReadFile(entry.path);
                    }
                  }}
                  onDoubleClick={(event) => {
                    event.stopPropagation();
                    if (!onRenamePath) return;
                    startRename(entry);
                  }}
                  onContextMenu={(event) => openContextMenu(event, entry)}
                  onDragStart={(event) => startWorkspaceDrag(event, entry)}
                  onDropOnDirectory={entry.isDirectory && onMovePath ? (event) => void handleDropOnDirectory(event, entry.path) : undefined}
                />
              )}
              {isExpanded && renderDirectory(entry.path, depth + 1)}
            </Box>
          );
        })}
        {creatingIn && creatingIn.parent === path && (
          <Box sx={{ display: "flex", alignItems: "center", gap: 0.5, pl: 0.5 + (depth + 1) * 1.5, pr: 1, py: 0.25 }}>
            {creatingIn.kind === "folder" ? <FolderOutlinedIcon fontSize="small" color="action" /> : <DescriptionOutlinedIcon fontSize="small" color="action" />}
            <TextField
              size="small"
              autoFocus
              value={createDraft}
              onChange={(event) => setCreateDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  void commitCreate();
                } else if (event.key === "Escape") {
                  setCreatingIn(null);
                }
                event.stopPropagation();
              }}
              onClick={(event) => event.stopPropagation()}
              placeholder={creatingIn.kind === "file" ? "New file name" : "New folder name"}
              inputProps={{ "aria-label": creatingIn.kind === "file" ? "New file name" : "New folder name" }}
              sx={{ flex: 1 }}
            />
          </Box>
        )}
      </>
    );
  }
}

function TreeRow({
  entry,
  depth,
  expanded,
  selected,
  open,
  onClick,
  onDoubleClick,
  onContextMenu,
  onDragStart,
  onDropOnDirectory
}: {
  entry: FsDirectoryEntry;
  depth: number;
  expanded: boolean;
  selected?: boolean;
  open?: boolean;
  onClick: (event: React.MouseEvent<HTMLButtonElement>) => void;
  onDoubleClick?: (event: React.MouseEvent<HTMLButtonElement>) => void;
  onContextMenu?: (event: React.MouseEvent<HTMLButtonElement>) => void;
  onDragStart?: (event: DragEvent<HTMLButtonElement>) => void;
  onDropOnDirectory?: (event: DragEvent<HTMLDivElement>) => void;
}) {
  const row = (
    <Button
      role="treeitem"
      aria-expanded={entry.isDirectory ? expanded : undefined}
      aria-selected={selected}
      size="small"
      onClick={onClick}
      onDoubleClick={onDoubleClick}
      onContextMenu={onContextMenu}
      draggable
      onDragStart={onDragStart}
      sx={{
        width: "100%",
        minHeight: 30,
        justifyContent: "flex-start",
        pl: 0.5 + depth * 1.5,
        pr: 1,
        gap: 0.5,
        color: open ? "primary.main" : "text.secondary",
        bgcolor: selected ? "action.selected" : "transparent",
        fontWeight: open ? 700 : 400,
        textTransform: "none"
      }}
    >
      {entry.isDirectory ? (
        <ChevronRightIcon fontSize="small" sx={{ transform: expanded ? "rotate(90deg)" : "none", transition: "transform 120ms" }} />
      ) : (
        <Box sx={{ width: 20, flex: "0 0 20px" }} />
      )}
      {entry.isDirectory ? <FolderOutlinedIcon fontSize="small" /> : <DescriptionOutlinedIcon fontSize="small" />}
      <Typography component="span" variant="caption" noWrap title={entry.path}>
        {entry.name}
      </Typography>
    </Button>
  );
  if (!onDropOnDirectory) return row;
  return (
    <Box
      onDragOver={(event) => {
        if (event.dataTransfer.types.includes(WORKSPACE_DRAG_MIME)) {
          event.preventDefault();
          event.dataTransfer.dropEffect = "move";
        }
      }}
      onDrop={onDropOnDirectory}
    >
      {row}
    </Box>
  );
}

function EmptyLine({ children, indent = 1 }: { children: ReactNode; indent?: number }) {
  return (
    <Typography variant="caption" color="text.secondary" sx={{ display: "block", px: 1, py: 1, pl: 1 + indent * 1.5 }}>
      {children}
    </Typography>
  );
}

function isHiddenEntry(entry: FsDirectoryEntry): boolean {
  return entry.name.startsWith(".");
}

/** Status-bar language label (mirrors WorkspaceCodeEditor's mapping for display only). */
function editorLanguageForPath(path: string): string {
  const extension = path.slice(path.lastIndexOf(".") + 1).toLowerCase();
  switch (extension) {
    case "ts":
    case "tsx":
      return "TypeScript";
    case "js":
    case "jsx":
    case "mjs":
    case "cjs":
      return "JavaScript";
    case "json":
      return "JSON";
    case "md":
      return "Markdown";
    case "css":
      return "CSS";
    case "html":
      return "HTML";
    case "yml":
    case "yaml":
      return "YAML";
    case "toml":
      return "TOML";
    case "sh":
      return "Shell";
    case "py":
      return "Python";
    case "rs":
      return "Rust";
    case "go":
      return "Go";
    case "java":
      return "Java";
    case "xml":
      return "XML";
    default:
      return "Plain Text";
  }
}

function compareEntries(left: FsDirectoryEntry, right: FsDirectoryEntry): number {
  if (left.isDirectory !== right.isDirectory) return left.isDirectory ? -1 : 1;
  return left.name.localeCompare(right.name);
}

/**
 * Root-relative label for search results. Windows paths use `\` and are
 * case-insensitive (`d:\x` vs `D:\x`); POSIX stays exact. Exported for tests.
 */
export function explorerRelativePath(root: string, path: string): string {
  if (!root) return path;
  const windows = /^[A-Za-z]:[\\/]/.test(root) || /^[A-Za-z]:[\\/]/.test(path);
  const trimmedRoot = root.replace(/[\\/]+$/, "");
  const rootKey = windows ? trimmedRoot.replace(/\//g, "\\").toLowerCase() : trimmedRoot;
  const pathKey = windows ? path.replace(/\//g, "\\").toLowerCase() : path;
  const separator = windows ? "\\" : "/";
  if (pathKey.startsWith(`${rootKey}${separator}`)) return path.slice(trimmedRoot.length + 1);
  return path;
}

/** Last path segment for both `/` and `\` separators; drive roots stay `C:\`. Exported for tests. */
export function explorerBaseName(path: string): string {
  if (/^[A-Za-z]:[\\/]*$/.test(path)) return `${path.slice(0, 2)}\\`;
  const trimmed = path.replace(/[\\/]+$/, "");
  return trimmed.split(/[\\/]/).pop() || path;
}

const relativePath = explorerRelativePath;
const baseName = explorerBaseName;

function startWorkspaceDrag(event: DragEvent<HTMLButtonElement>, entry: FsDirectoryEntry): void {
  const payload = buildWorkspaceDragPayload(entry);
  if (!payload) {
    event.preventDefault();
    return;
  }
  writeWorkspaceDragData(event.dataTransfer, payload);
}
