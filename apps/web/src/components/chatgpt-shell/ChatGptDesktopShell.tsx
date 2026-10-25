import { useMemo, useState, type ReactNode } from "react";
import AddIcon from "@mui/icons-material/Add";
import CloudQueueIcon from "@mui/icons-material/CloudQueue";
import ComputerIcon from "@mui/icons-material/Computer";
import FolderOpenIcon from "@mui/icons-material/FolderOpen";
import MoreHorizIcon from "@mui/icons-material/MoreHoriz";
import OpenInNewIcon from "@mui/icons-material/OpenInNew";
import SearchIcon from "@mui/icons-material/Search";
import SettingsIcon from "@mui/icons-material/Settings";
import TerminalIcon from "@mui/icons-material/Terminal";
import type { PermissionPresetId } from "@codex-ui/shared";
import type { ThreadEntry } from "../../state/codexClient";
import { displayThreadTitle, isSshThread, sshThreadHostLabel } from "../../app/threads/threadCatalog";
import "./chatgpt-desktop-shell.css";

type Props = {
  children: ReactNode;
  workspace?: ReactNode;
  threads: ThreadEntry[];
  activeThreadId: string | null;
  providerLabel: string;
  modelLabel?: string;
  cwd?: string;
  permission?: PermissionPresetId;
  themeSwitcher?: ReactNode;
  runtimeSelections?: Record<string, { model?: string; reasoningEffort?: string; permission?: PermissionPresetId }>;
  runningThreadIds?: Set<string>;
  onSelectThread: (threadId: string) => void;
  onNewChat: () => void;
  onOpenSettings: () => void;
  onOpenWorkspace?: () => void;
};

function threadLocation(thread: ThreadEntry): string {
  return isSshThread(thread) ? thread.sshCwd || thread.cwd || sshThreadHostLabel(thread) || "SSH" : thread.cwd || "Local workspace";
}

export function ChatGptDesktopShell({ children, workspace, threads, activeThreadId, providerLabel, modelLabel, cwd, permission, themeSwitcher, runtimeSelections, runningThreadIds, onSelectThread, onNewChat, onOpenSettings, onOpenWorkspace }: Props) {
  const [query, setQuery] = useState("");
  const [workspaceOpen, setWorkspaceOpen] = useState(false);
  const activeThread = threads.find((thread) => thread.id === activeThreadId);
  const recentThreads = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    return threads
      .filter((thread) => !normalized || `${displayThreadTitle(thread)} ${thread.preview ?? ""} ${thread.cwd ?? ""} ${thread.sshCwd ?? ""}`.toLowerCase().includes(normalized))
      .slice()
      .sort((left, right) => (right.recencyAt ?? right.updatedAt ?? 0) - (left.recencyAt ?? left.updatedAt ?? 0))
      .slice(0, 80);
  }, [query, threads]);
  const activeIsSsh = activeThread ? isSshThread(activeThread) : false;
  const activeLocation = activeThread ? threadLocation(activeThread) : cwd || "Local workspace";

  return (
    <div className="chatgpt-desktop-shell" data-testid="chatgpt-desktop-shell">
      <aside className="chatgpt-desktop-sidebar">
        <div className="chatgpt-brand"><TerminalIcon fontSize="small" /><span>Codex</span></div>
        <button type="button" className="chatgpt-new-chat" onClick={onNewChat}><AddIcon fontSize="small" /><span>New thread</span></button>
        <label className="chatgpt-recents-search"><SearchIcon fontSize="small" /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search conversations" aria-label="Search conversations" /></label>
        <div className="chatgpt-section-label">Threads</div>
        <div className="chatgpt-recents" role="listbox" aria-label="Conversation history">
          {recentThreads.map((thread) => {
            const ssh = isSshThread(thread);
            const active = thread.id === activeThreadId;
            return <button key={thread.id} type="button" role="option" aria-selected={active} className={`chatgpt-recent-item${active ? " active" : ""}`} onClick={() => onSelectThread(thread.id)} title={`${displayThreadTitle(thread)} · ${threadLocation(thread)}`}>
              {ssh ? <CloudQueueIcon fontSize="small" /> : <ComputerIcon fontSize="small" />}
              <span className="chatgpt-recent-copy"><span className="chatgpt-recent-title">{displayThreadTitle(thread)}</span><small>{ssh ? `SSH · ${sshThreadHostLabel(thread) || "remote"}` : "Local"}{runtimeSelections?.[thread.id]?.model || thread.model ? ` · ${runtimeSelections?.[thread.id]?.model || thread.model}` : ""}{runtimeSelections?.[thread.id]?.reasoningEffort ? ` · ${runtimeSelections[thread.id]?.reasoningEffort}` : ""}{runtimeSelections?.[thread.id]?.permission === "dangerBypass" ? " · Full access" : ""}</small></span>
              {runningThreadIds?.has(thread.id) && <span className="chatgpt-running-dot" />}
            </button>;
          })}
          {recentThreads.length === 0 && <div className="chatgpt-empty-recents">No conversations found</div>}
        </div>
        <div className="chatgpt-sidebar-footer">
          <div className="chatgpt-account"><span className="chatgpt-avatar">C</span><span className="chatgpt-account-copy"><strong>{providerLabel}</strong><small>{permission === "dangerBypass" ? "Full access" : "Codex workspace"}</small></span><MoreHorizIcon fontSize="small" /></div>
          <button type="button" className="chatgpt-nav-item" onClick={onOpenSettings}><SettingsIcon fontSize="small" /><span>Settings</span></button>
        </div>
      </aside>
      <main className="chatgpt-desktop-main">
        <header className="chatgpt-desktop-header">
          <div className="chatgpt-header-title"><span>{activeThread ? displayThreadTitle(activeThread) : "New thread"}</span><span className={`chatgpt-route-badge ${activeIsSsh ? "ssh" : "local"}`}>{activeIsSsh ? "SSH" : "Local"}</span></div>
          <div className="chatgpt-header-meta"><span>{activeThread?.modelProvider || providerLabel}{runtimeSelections?.[activeThreadId ?? ""]?.model || activeThread?.model || modelLabel ? ` · ${runtimeSelections?.[activeThreadId ?? ""]?.model || activeThread?.model || modelLabel}` : ""}</span>{runtimeSelections?.[activeThreadId ?? ""]?.reasoningEffort && <span>{runtimeSelections[activeThreadId ?? ""]?.reasoningEffort}</span>}<span className="chatgpt-cwd" title={activeLocation}><FolderOpenIcon fontSize="inherit" />{activeLocation}</span>{themeSwitcher}<button type="button" className="chatgpt-header-button" onClick={() => { setWorkspaceOpen(true); onOpenWorkspace?.(); }}><OpenInNewIcon fontSize="small" />Open workspace</button></div>
        </header>
        <section className="chatgpt-desktop-content"><div className="chatgpt-desktop-chat">{children}</div>{workspaceOpen && workspace && <aside className="chatgpt-desktop-workspace"><button type="button" className="chatgpt-workspace-close" onClick={() => setWorkspaceOpen(false)} aria-label="Close workspace">×</button>{workspace}</aside>}</section>
      </main>
    </div>
  );
}
