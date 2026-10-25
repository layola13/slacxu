import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  Alert,
  Box,
  Button,
  Checkbox,
  Chip,
  CircularProgress,
  FormControlLabel,
  IconButton,
  Stack,
  Tab,
  Tabs,
  TextField,
  Tooltip,
  Typography
} from "@mui/material";
import AddIcon from "@mui/icons-material/Add";
import AccountTreeIcon from "@mui/icons-material/AccountTree";
import ArchiveIcon from "@mui/icons-material/Archive";
import DeleteOutlineIcon from "@mui/icons-material/DeleteOutline";
import HistoryIcon from "@mui/icons-material/History";
import RefreshIcon from "@mui/icons-material/Refresh";
import RemoveIcon from "@mui/icons-material/Remove";
import SourceIcon from "@mui/icons-material/Source";
import { UnifiedDiffBlock } from "../waterfall/ChatDiffView";

export type GitRpc = (method: string, params: Record<string, unknown>) => Promise<unknown>;

type GitStatusEntry = {
  path: string;
  oldPath?: string;
  indexStatus: string;
  worktreeStatus: string;
  staged: boolean;
  unstaged: boolean;
  untracked: boolean;
};

type GitStatus = {
  isRepository: boolean;
  repoRoot: string;
  branch: string;
  upstream: string;
  ahead: number;
  behind: number;
  entries: GitStatusEntry[];
};

type GitCommit = {
  sha: string;
  shortSha: string;
  author: string;
  email: string;
  timestamp: number;
  subject: string;
  refs: string[];
};

type GitBranch = {
  name: string;
  current: boolean;
  remote: boolean;
  upstream: string;
  shortSha: string;
};

type GitStashEntry = {
  index: number;
  ref: string;
  subject: string;
  timestamp: number;
};

type Selection = { section: "staged" | "changes"; path: string };

export function GitReviewPanel({ cwd, rpc }: { cwd: string; rpc: GitRpc }) {
  const [mode, setMode] = useState<"changes" | "history" | "branches" | "stash">("changes");
  const [status, setStatus] = useState<GitStatus | null>(null);
  const [selection, setSelection] = useState<Selection | null>(null);
  const [patch, setPatch] = useState("");
  const [commits, setCommits] = useState<GitCommit[]>([]);
  const [selectedCommit, setSelectedCommit] = useState<string>("");
  const [commitMessage, setCommitMessage] = useState("");
  const [amend, setAmend] = useState(false);
  const [branches, setBranches] = useState<GitBranch[]>([]);
  const [currentBranch, setCurrentBranch] = useState("");
  const [newBranchName, setNewBranchName] = useState("");
  const [stashEntries, setStashEntries] = useState<GitStashEntry[]>([]);
  const [stashMessage, setStashMessage] = useState("");
  const [loading, setLoading] = useState(false);
  const [detailLoading, setDetailLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const detailRequestRef = useRef(0);

  const refreshStatus = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const next = parseGitStatus(await rpc("ui/git/status", { cwd }));
      setStatus(next);
      setSelection((current) => {
        if (!current) return null;
        const found = next.entries.some((entry) => entry.path === current.path && (current.section === "staged" ? entry.staged : entry.unstaged));
        return found ? current : firstSelection(next.entries);
      });
    } catch (reason) {
      setError(errorText(reason));
    } finally {
      setLoading(false);
    }
  }, [cwd, rpc]);

  const refreshHistory = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const result = asRecord(await rpc("ui/git/history", { cwd, limit: 80 }));
      const next = Array.isArray(result.commits) ? result.commits.map(parseCommit).filter(Boolean) as GitCommit[] : [];
      setCommits(next);
      setSelectedCommit((current) => (current && next.some((commit) => commit.sha === current) ? current : next[0]?.sha ?? ""));
    } catch (reason) {
      setError(errorText(reason));
    } finally {
      setLoading(false);
    }
  }, [cwd, rpc]);

  const refreshBranches = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const result = asRecord(await rpc("ui/git/branches", { cwd }));
      const list = Array.isArray(result.branches) ? result.branches.map(parseBranch).filter(Boolean) as GitBranch[] : [];
      setBranches(list);
      setCurrentBranch(stringValue(result.current));
    } catch (reason) {
      setError(errorText(reason));
    } finally {
      setLoading(false);
    }
  }, [cwd, rpc]);

  const refreshStash = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const result = asRecord(await rpc("ui/git/stash-list", { cwd }));
      const list = Array.isArray(result.entries) ? result.entries.map(parseStashEntry).filter(Boolean) as GitStashEntry[] : [];
      setStashEntries(list);
    } catch (reason) {
      setError(errorText(reason));
    } finally {
      setLoading(false);
    }
  }, [cwd, rpc]);

  useEffect(() => {
    setStatus(null);
    setSelection(null);
    setCommits([]);
    setSelectedCommit("");
    setPatch("");
    setBranches([]);
    setStashEntries([]);
    void refreshStatus();
  }, [cwd, refreshStatus]);

  useEffect(() => {
    if (mode === "history" && commits.length === 0) void refreshHistory();
    if (mode === "branches" && branches.length === 0) void refreshBranches();
    if (mode === "stash" && stashEntries.length === 0) void refreshStash();
  }, [branches.length, commits.length, mode, refreshBranches, refreshHistory, refreshStash, stashEntries.length]);

  useEffect(() => {
    const requestId = ++detailRequestRef.current;
    if (mode === "changes") {
      if (!selection) {
        setPatch("");
        return;
      }
      setDetailLoading(true);
      void rpc("ui/git/diff", {
        cwd,
        path: selection.path,
        staged: selection.section === "staged"
      })
        .then((result) => {
          if (detailRequestRef.current !== requestId) return;
          setPatch(stringValue(asRecord(result).patch));
        })
        .catch((reason) => {
          if (detailRequestRef.current === requestId) setError(errorText(reason));
        })
        .finally(() => {
          if (detailRequestRef.current === requestId) setDetailLoading(false);
        });
      return;
    }
    if (!selectedCommit) {
      setPatch("");
      return;
    }
    setDetailLoading(true);
    void rpc("ui/git/show", { cwd, sha: selectedCommit })
      .then((result) => {
        if (detailRequestRef.current !== requestId) return;
        setPatch(stringValue(asRecord(result).patch));
      })
      .catch((reason) => {
        if (detailRequestRef.current === requestId) setError(errorText(reason));
      })
      .finally(() => {
        if (detailRequestRef.current === requestId) setDetailLoading(false);
      });
  }, [cwd, mode, rpc, selectedCommit, selection]);

  const stagedEntries = useMemo(() => status?.entries.filter((entry) => entry.staged) ?? [], [status]);
  const changedEntries = useMemo(() => status?.entries.filter((entry) => entry.unstaged) ?? [], [status]);

  const runMutation = async (method: string, params: Record<string, unknown>) => {
    setBusy(true);
    setError("");
    try {
      const result = asRecord(await rpc(method, { cwd, ...params }));
      const next = parseGitStatus(result.status ?? result);
      setStatus(next);
      setSelection((current) => {
        if (!current) return firstSelection(next.entries);
        const found = next.entries.some(
          (entry) =>
            entry.path === current.path &&
            (current.section === "staged" ? entry.staged : entry.unstaged)
        );
        return found ? current : firstSelection(next.entries);
      });
      if (method === "ui/git/commit") {
        setCommitMessage("");
        setAmend(false);
        setCommits([]);
      }
      if (method.startsWith("ui/git/stash-")) {
        setStashEntries([]);
        void refreshStash().catch(() => undefined);
      }
      if (method === "ui/git/checkout" || method === "ui/git/branch-delete") {
        setBranches([]);
        void refreshBranches().catch(() => undefined);
      }
    } catch (reason) {
      setError(errorText(reason));
    } finally {
      setBusy(false);
    }
  };

  const refresh = () => {
    if (mode === "history") void refreshHistory();
    else if (mode === "branches") void refreshBranches();
    else if (mode === "stash") void refreshStash();
    else void refreshStatus();
  };

  const syncAction = async (method: "ui/git/fetch" | "ui/git/pull" | "ui/git/push", extra?: Record<string, unknown>) => {
    setBusy(true);
    setError("");
    try {
      const result = asRecord(await rpc(method, { cwd, ...(extra ?? {}) }));
      const message = stringValue(result.message);
      if (message) {
        // surface push/pull output briefly via error slot as info is unavailable; keep status fresh
      }
      const next = parseGitStatus(result.status ?? result);
      if (next.isRepository || (result.status !== undefined)) setStatus(next);
      else await refreshStatus();
    } catch (reason) {
      setError(errorText(reason));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Box data-testid="git-review-panel" sx={{ height: "100%", minHeight: 0, display: "grid", gridTemplateRows: "auto auto minmax(0, 1fr)" }}>
      <Stack direction="row" alignItems="center" spacing={0.75} sx={{ px: 1, borderBottom: "1px solid", borderColor: "divider" }}>
        <Tabs value={mode} onChange={(_, value) => setMode(value)} variant="scrollable" scrollButtons="auto" sx={{ flex: 1, minHeight: 42, "& .MuiTab-root": { minHeight: 42 } }}>
          <Tab value="changes" label="Changes" icon={<SourceIcon fontSize="small" />} iconPosition="start" />
          <Tab value="history" label="History" icon={<HistoryIcon fontSize="small" />} iconPosition="start" />
          <Tab value="branches" label="Branches" icon={<AccountTreeIcon fontSize="small" />} iconPosition="start" />
          <Tab value="stash" label="Stash" icon={<ArchiveIcon fontSize="small" />} iconPosition="start" />
        </Tabs>
        {status?.isRepository && <Chip size="small" label={branchLabel(status)} title={status.upstream || status.repoRoot} />}
        <Tooltip title="Refresh Git review">
          <span>
            <IconButton size="small" aria-label="Refresh Git review" disabled={loading || busy} onClick={refresh}>
              {loading ? <CircularProgress size={16} /> : <RefreshIcon fontSize="small" />}
            </IconButton>
          </span>
        </Tooltip>
      </Stack>

      {error && <Alert severity="error" onClose={() => setError("")}>{error}</Alert>}
      {!loading && status && !status.isRepository && (
        <Alert severity="info">The selected workspace is not a Git repository.</Alert>
      )}

      {mode === "changes" ? (
        <Box sx={{ minHeight: 0, display: "grid", gridTemplateRows: "minmax(180px, 44%) minmax(0, 1fr)" }}>
          <Box sx={{ minHeight: 0, overflow: "auto", borderBottom: "1px solid", borderColor: "divider" }}>
            <ChangeSection
              title="Staged changes"
              entries={stagedEntries}
              section="staged"
              selection={selection}
              busy={busy}
              onSelect={setSelection}
              onAction={(entry) => void runMutation("ui/git/unstage", { paths: [entry.path] })}
              actionLabel="Unstage"
              actionIcon={<RemoveIcon fontSize="small" />}
            />
            <ChangeSection
              title="Changes"
              entries={changedEntries}
              section="changes"
              selection={selection}
              busy={busy}
              onSelect={setSelection}
              onAction={(entry) => void runMutation("ui/git/stage", { paths: [entry.path] })}
              actionLabel="Stage"
              actionIcon={<AddIcon fontSize="small" />}
              onDiscard={(entry) => {
                if (!window.confirm(`Discard changes in ${entry.path}? This cannot be undone.`)) return;
                void runMutation("ui/git/discard", { paths: [entry.path], untracked: entry.untracked });
              }}
            />
            {status?.isRepository && status.entries.length === 0 && <EmptyState>No working tree changes.</EmptyState>}
            {status?.isRepository && (
              <Stack direction="row" spacing={0.75} sx={{ p: 1, borderTop: "1px solid", borderColor: "divider" }}>
                <Button
                  size="small"
                  disabled={busy || changedEntries.length === 0}
                  onClick={() => void runMutation("ui/git/stage-all", {})}
                >
                  Stage all
                </Button>
                <Button
                  size="small"
                  disabled={busy || stagedEntries.length === 0}
                  onClick={() => void runMutation("ui/git/unstage-all", {})}
                >
                  Unstage all
                </Button>
                <Button size="small" disabled={busy} onClick={() => void syncAction("ui/git/fetch")}>
                  Fetch
                </Button>
                <Button size="small" disabled={busy} onClick={() => void syncAction("ui/git/pull")}>
                  Pull
                </Button>
                <Button size="small" disabled={busy} onClick={() => void syncAction("ui/git/push")}>
                  Push
                </Button>
              </Stack>
            )}
            {status?.isRepository && (
              <Stack direction="row" spacing={0.75} sx={{ p: 1, paddingTop: 0 }}>
                <TextField
                  size="small"
                  value={commitMessage}
                  onChange={(event) => setCommitMessage(event.target.value)}
                  placeholder="Commit message"
                  inputProps={{ "aria-label": "Commit message" }}
                  sx={{ flex: 1 }}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" && (event.ctrlKey || event.metaKey) && commitMessage.trim() && (stagedEntries.length > 0 || amend)) {
                      void runMutation("ui/git/commit", { message: commitMessage.trim(), ...(amend ? { amend: true } : {}) });
                    }
                  }}
                />
                <FormControlLabel
                  control={<Checkbox size="small" checked={amend} onChange={(event) => setAmend(event.target.checked)} />}
                  label="Amend"
                  sx={{ m: 0, "& .MuiFormControlLabel-label": { fontSize: 12 } }}
                />
                <Button
                  size="small"
                  variant="contained"
                  disabled={busy || !commitMessage.trim() || (stagedEntries.length === 0 && !amend)}
                  onClick={() => void runMutation("ui/git/commit", { message: commitMessage.trim(), ...(amend ? { amend: true } : {}) })}
                >
                  Commit
                </Button>
              </Stack>
            )}
          </Box>
          <DiffPane loading={detailLoading} patch={patch} emptyText={selection ? "No textual diff for this file." : "Select a changed file."} />
        </Box>
      ) : mode === "history" ? (
        <Box sx={{ minHeight: 0, display: "grid", gridTemplateRows: "minmax(180px, 42%) minmax(0, 1fr)" }}>
          <Box sx={{ minHeight: 0, overflow: "auto", borderBottom: "1px solid", borderColor: "divider" }}>
            {commits.map((commit) => (
              <Button
                key={commit.sha}
                data-testid="git-history-entry"
                onClick={() => setSelectedCommit(commit.sha)}
                sx={{
                  width: "100%",
                  display: "grid",
                  gridTemplateColumns: "56px minmax(0, 1fr) auto",
                  gap: 1,
                  justifyItems: "start",
                  px: 1,
                  py: 0.75,
                  borderRadius: 0,
                  textAlign: "left",
                  textTransform: "none",
                  bgcolor: selectedCommit === commit.sha ? "action.selected" : "transparent"
                }}
              >
                <Typography variant="caption" color="primary.main" sx={{ fontFamily: "monospace" }}>{commit.shortSha}</Typography>
                <Box sx={{ minWidth: 0 }}>
                  <Typography variant="caption" sx={{ display: "block", fontWeight: 700 }} noWrap>{commit.subject}</Typography>
                  <Typography variant="caption" color="text.secondary" noWrap>{commit.author}</Typography>
                </Box>
                <Typography variant="caption" color="text.secondary">{formatCommitTime(commit.timestamp)}</Typography>
              </Button>
            ))}
            {!loading && commits.length === 0 && <EmptyState>No commits found.</EmptyState>}
          </Box>
          <DiffPane loading={detailLoading} patch={patch} emptyText={selectedCommit ? "No commit diff available." : "Select a commit."} />
        </Box>
      ) : mode === "branches" ? (
        <Box sx={{ minHeight: 0, overflow: "auto" }}>
          <Stack direction="row" spacing={0.75} sx={{ p: 1 }}>
            <TextField
              size="small"
              value={newBranchName}
              onChange={(event) => setNewBranchName(event.target.value)}
              placeholder="New branch name"
              inputProps={{ "aria-label": "New branch name" }}
              sx={{ flex: 1 }}
              onKeyDown={(event) => {
                if (event.key === "Enter" && newBranchName.trim()) {
                  void runMutation("ui/git/checkout", { branch: newBranchName.trim(), create: true });
                  setNewBranchName("");
                }
              }}
            />
            <Button
              size="small"
              variant="outlined"
              disabled={busy || !newBranchName.trim()}
              onClick={() => { void runMutation("ui/git/checkout", { branch: newBranchName.trim(), create: true }); setNewBranchName(""); }}
            >
              Create
            </Button>
          </Stack>
          {branches.map((branch) => (
            <Stack
              key={branch.name}
              data-testid="git-branch-entry"
              direction="row"
              alignItems="center"
              spacing={0.5}
              sx={{ minHeight: 34, pl: 1, pr: 0.75, bgcolor: branch.current ? "action.selected" : "transparent" }}
            >
              <Button
                disabled={busy || branch.current || branch.remote}
                onClick={() => void runMutation("ui/git/checkout", { branch: branch.name })}
                sx={{ flex: 1, minWidth: 0, justifyContent: "flex-start", textTransform: "none", px: 0.5 }}
              >
                <Typography variant="caption" noWrap title={branch.upstream ? `${branch.name} -> ${branch.upstream}` : branch.name} sx={{ fontWeight: branch.current ? 700 : 400 }}>
                  {branch.current ? `● ${branch.name}` : branch.name}{branch.remote ? " (remote)" : ""}
                </Typography>
              </Button>
              {branch.shortSha && <Typography variant="caption" color="text.secondary" sx={{ fontFamily: "monospace" }}>{branch.shortSha}</Typography>}
              {!branch.remote && !branch.current && (
                <Tooltip title="Delete branch">
                  <span>
                    <IconButton
                      size="small"
                      aria-label={`Delete branch ${branch.name}`}
                      disabled={busy}
                      onClick={() => {
                        if (!window.confirm(`Delete branch ${branch.name}?`)) return;
                        void runMutation("ui/git/branch-delete", { branch: branch.name });
                      }}
                    >
                      <DeleteOutlineIcon fontSize="small" />
                    </IconButton>
                  </span>
                </Tooltip>
              )}
            </Stack>
          ))}
          {!loading && branches.length === 0 && <EmptyState>No branches found. The workspace may not be a Git repository.</EmptyState>}
          {currentBranch && <EmptyState>Current: {currentBranch}</EmptyState>}
        </Box>
      ) : (
        <Box sx={{ minHeight: 0, overflow: "auto" }}>
          <Stack direction="row" spacing={0.75} sx={{ p: 1 }}>
            <TextField
              size="small"
              value={stashMessage}
              onChange={(event) => setStashMessage(event.target.value)}
              placeholder="Stash message (optional)"
              inputProps={{ "aria-label": "Stash message" }}
              sx={{ flex: 1 }}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  void runMutation("ui/git/stash-push", stashMessage.trim() ? { message: stashMessage.trim() } : {});
                  setStashMessage("");
                }
              }}
            />
            <Button
              size="small"
              variant="outlined"
              disabled={busy}
              onClick={() => { void runMutation("ui/git/stash-push", stashMessage.trim() ? { message: stashMessage.trim() } : {}); setStashMessage(""); }}
            >
              Stash
            </Button>
          </Stack>
          {stashEntries.map((entry) => (
            <Stack
              key={entry.ref || entry.index}
              data-testid="git-stash-entry"
              direction="row"
              alignItems="center"
              spacing={0.5}
              sx={{ minHeight: 34, pl: 1, pr: 0.75 }}
            >
              <Box sx={{ flex: 1, minWidth: 0 }}>
                <Typography variant="caption" sx={{ display: "block", fontWeight: 700 }} noWrap title={entry.subject}>
                  {entry.ref}: {entry.subject || "(no message)"}
                </Typography>
                <Typography variant="caption" color="text.secondary">{formatCommitTime(entry.timestamp)}</Typography>
              </Box>
              <Button size="small" disabled={busy} onClick={() => void runMutation("ui/git/stash-apply", { index: entry.index })}>
                Apply
              </Button>
              <Button size="small" disabled={busy} onClick={() => void runMutation("ui/git/stash-apply", { index: entry.index, pop: true })}>
                Pop
              </Button>
              <Tooltip title="Drop stash">
                <span>
                  <IconButton
                    size="small"
                    aria-label={`Drop ${entry.ref}`}
                    disabled={busy}
                    onClick={() => {
                      if (!window.confirm(`Drop ${entry.ref}? This cannot be undone.`)) return;
                      void runMutation("ui/git/stash-drop", { index: entry.index });
                    }}
                  >
                    <DeleteOutlineIcon fontSize="small" />
                  </IconButton>
                </span>
              </Tooltip>
            </Stack>
          ))}
          {!loading && stashEntries.length === 0 && <EmptyState>No stash entries.</EmptyState>}
        </Box>
      )}
    </Box>
  );
}

function ChangeSection({
  title,
  entries,
  section,
  selection,
  busy,
  onSelect,
  onAction,
  actionLabel,
  actionIcon,
  onDiscard
}: {
  title: string;
  entries: GitStatusEntry[];
  section: Selection["section"];
  selection: Selection | null;
  busy: boolean;
  onSelect: (selection: Selection) => void;
  onAction: (entry: GitStatusEntry) => void;
  actionLabel: string;
  actionIcon: ReactNode;
  onDiscard?: (entry: GitStatusEntry) => void;
}) {
  return (
    <Box>
      <Typography variant="overline" color="text.secondary" sx={{ display: "block", px: 1, pt: 0.75, lineHeight: 1.8 }}>
        {title} ({entries.length})
      </Typography>
      {entries.map((entry) => {
        const selected = selection?.section === section && selection.path === entry.path;
        return (
          <Stack
            key={`${section}:${entry.path}`}
            data-testid={`git-${section}-entry`}
            direction="row"
            alignItems="center"
            spacing={0.5}
            sx={{ minHeight: 32, pl: 0.5, pr: 0.75, bgcolor: selected ? "action.selected" : "transparent" }}
          >
            <Button
              onClick={() => onSelect({ section, path: entry.path })}
              sx={{ flex: 1, minWidth: 0, justifyContent: "flex-start", textTransform: "none", px: 0.5 }}
            >
              <Typography variant="caption" noWrap title={entry.oldPath ? `${entry.oldPath} -> ${entry.path}` : entry.path}>
                {entry.path}
              </Typography>
            </Button>
            <Chip size="small" label={statusLabel(entry, section)} sx={{ height: 20, "& .MuiChip-label": { px: 0.75, fontSize: 10 } }} />
            {onDiscard && (
              <Tooltip title="Discard">
                <span>
                  <IconButton size="small" aria-label={`Discard ${entry.path}`} disabled={busy} onClick={() => onDiscard(entry)}>
                    <DeleteOutlineIcon fontSize="small" />
                  </IconButton>
                </span>
              </Tooltip>
            )}
            <Tooltip title={actionLabel}>
              <span>
                <IconButton size="small" aria-label={`${actionLabel} ${entry.path}`} disabled={busy} onClick={() => onAction(entry)}>
                  {actionIcon}
                </IconButton>
              </span>
            </Tooltip>
          </Stack>
        );
      })}
    </Box>
  );
}

function DiffPane({ loading, patch, emptyText }: { loading: boolean; patch: string; emptyText: string }) {
  return (
    <Box data-testid="git-review-diff" sx={{ minHeight: 0, overflow: "auto" }}>
      {loading ? (
        <Stack alignItems="center" justifyContent="center" sx={{ height: "100%" }}><CircularProgress size={22} /></Stack>
      ) : patch.trim() ? (
        <UnifiedDiffBlock text={patch} />
      ) : (
        <EmptyState>{emptyText}</EmptyState>
      )}
    </Box>
  );
}

function EmptyState({ children }: { children: ReactNode }) {
  return <Typography variant="caption" color="text.secondary" sx={{ display: "block", p: 1.5 }}>{children}</Typography>;
}

function firstSelection(entries: GitStatusEntry[]): Selection | null {
  const changed = entries.find((entry) => entry.unstaged);
  if (changed) return { section: "changes", path: changed.path };
  const staged = entries.find((entry) => entry.staged);
  return staged ? { section: "staged", path: staged.path } : null;
}

function parseGitStatus(value: unknown): GitStatus {
  const record = asRecord(value);
  const entries = Array.isArray(record.entries)
    ? record.entries.map((entry) => {
        const item = asRecord(entry);
        return {
          path: stringValue(item.path),
          oldPath: stringValue(item.oldPath) || undefined,
          indexStatus: stringValue(item.indexStatus) || " ",
          worktreeStatus: stringValue(item.worktreeStatus) || " ",
          staged: item.staged === true,
          unstaged: item.unstaged === true,
          untracked: item.untracked === true
        };
      }).filter((entry) => entry.path)
    : [];
  return {
    isRepository: record.isRepository === true,
    repoRoot: stringValue(record.repoRoot),
    branch: stringValue(record.branch),
    upstream: stringValue(record.upstream),
    ahead: numberValue(record.ahead),
    behind: numberValue(record.behind),
    entries
  };
}

function parseBranch(value: unknown): GitBranch | null {
  const record = asRecord(value);
  const name = stringValue(record.name);
  if (!name) return null;
  return {
    name,
    current: record.current === true,
    remote: record.remote === true,
    upstream: stringValue(record.upstream),
    shortSha: stringValue(record.shortSha)
  };
}

function parseStashEntry(value: unknown): GitStashEntry | null {
  const record = asRecord(value);
  const ref = stringValue(record.ref);
  if (!ref && typeof record.index !== "number") return null;
  return {
    index: numberValue(record.index),
    ref,
    subject: stringValue(record.subject),
    timestamp: numberValue(record.timestamp)
  };
}

function parseCommit(value: unknown): GitCommit | null {
  const record = asRecord(value);
  const sha = stringValue(record.sha);
  if (!sha) return null;
  return {
    sha,
    shortSha: stringValue(record.shortSha) || sha.slice(0, 7),
    author: stringValue(record.author),
    email: stringValue(record.email),
    timestamp: numberValue(record.timestamp),
    subject: stringValue(record.subject),
    refs: Array.isArray(record.refs) ? record.refs.flatMap((item) => typeof item === "string" ? [item] : []) : []
  };
}

function statusLabel(entry: GitStatusEntry, section: Selection["section"]): string {
  if (entry.untracked) return "U";
  const code = section === "staged" ? entry.indexStatus : entry.worktreeStatus;
  return code === "M" ? "M" : code === "A" ? "A" : code === "D" ? "D" : code === "R" ? "R" : code.trim() || "?";
}

function branchLabel(status: GitStatus): string {
  const sync = [status.ahead ? `↑${status.ahead}` : "", status.behind ? `↓${status.behind}` : ""].filter(Boolean).join(" ");
  return sync ? `${status.branch} ${sync}` : status.branch;
}

function formatCommitTime(timestamp: number): string {
  if (!timestamp) return "";
  return new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" }).format(new Date(timestamp * 1000));
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function numberValue(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function errorText(value: unknown): string {
  return value instanceof Error ? value.message : String(value);
}
