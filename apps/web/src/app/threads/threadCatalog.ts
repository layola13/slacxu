import type { CliBackend, JsonValue } from "@codex-ui/shared";
import { displayPromptText } from "../../promptDisplay";
import type { ClientState, CodexSocketClient } from "../../state/codexClient";
import { normalizeCliBackendFilter } from "../cli/cliBackendKind";

export type ThreadCatalog = ClientState["threads"];
export type ThreadCatalogEntry = ThreadCatalog[number];
export type ThreadDateRange = { from: string; to: string };

export async function loadHistoryThreadById(client: CodexSocketClient, threadId: string): Promise<ThreadCatalogEntry | null> {
  try {
    const response = await client.rpc("thread/read", { threadId, includeTurns: false });
    const root = record(response);
    const thread = record(root.thread ?? root.data ?? root);
    return normalizeThreads([{ ...thread, id: text(thread.id) ?? threadId }])[0] ?? null;
  } catch (error) {
    console.warn("[history] direct thread id search failed", threadId, error);
    return null;
  }
}

export async function loadAllThreads(client: CodexSocketClient, options: {
  searchTerm?: string;
  includeAutomationHistory?: boolean;
  onProgress?: () => void;
  /** Load only the first page (default: true when no search term) */
  firstPageOnly?: boolean;
  /** Maximum pages to load (default: 32) */
  maxPages?: number;
  /**
   * Lazy backend scope: "codex" skips the server-side Claude merge entirely,
   * "claude" returns only Claude sessions without paging Codex rollouts.
   * Omitted loads both backends (legacy behavior).
   */
  cliBackend?: CliBackend;
} = {}): Promise<ThreadCatalog> {
  const threads: ThreadCatalog = [];
  const seenIds = new Set<string>();
  const searchTerm = options.searchTerm?.trim();
  // By default, load only first page if no search term is provided
  const firstPageOnly = options.firstPageOnly ?? !searchTerm;
  const maxPages = options.maxPages ?? 32;
  const sourceKinds: ("cli" | "vscode" | "exec" | "appServer")[] = options.includeAutomationHistory
    ? ["cli", "vscode", "exec", "appServer"]
    : ["cli", "vscode"];
  let pagesLoaded = 0;
  for (const archived of [false, true]) {
    if (pagesLoaded >= maxPages) break;
    let cursor: string | null = null;
    const pagesToLoad = firstPageOnly ? 1 : maxPages - pagesLoaded;
    for (let guard = 0; guard < pagesToLoad; guard += 1) {
      const params: Record<string, JsonValue> = {
        cursor, limit: 200, archived, sourceKinds, modelProviders: [],
        useStateDbOnly: false, sortKey: "recency_at", sortDirection: "desc"
      };
      if (searchTerm) params.searchTerm = searchTerm;
      if (options.cliBackend) params.cliBackend = options.cliBackend;
      const response = await client.rpc("thread/list", params);
      pagesLoaded += 1;
      options.onProgress?.();
      const root = record(response);
      const batch = Array.isArray(root.data) ? normalizeThreads(root.data)
        : Array.isArray(root.threads) ? normalizeThreads(root.threads) : [];
      for (const thread of batch) {
        if (seenIds.has(thread.id)) continue;
        seenIds.add(thread.id);
        threads.push(thread);
      }
      const nextCursor = text(root.nextCursor) ?? null;
      if (!nextCursor || nextCursor === cursor) break;
      cursor = nextCursor;
      // If firstPageOnly is true, break after first page
      if (firstPageOnly) break;
    }
    // If firstPageOnly is true, only load from non-archived
    if (firstPageOnly && !archived) break;
  }
  return sortThreads(threads);
}

export function normalizeThreads(value: unknown[]): ThreadCatalog {
  return value.map(record).map((entry) => {
    const name = text(entry.name) ?? text(entry.threadName) ?? text(entry.thread_name);
    const preview = text(entry.preview);
    return {
      id: String(entry.id ?? ""),
      // The history sidebar filters on this and the composer restores the
      // thread's backend from it, so a dropped value silently hides every
      // Claude thread behind the Codex filter.
      cliBackend: normalizeCliBackend(entry.cliBackend ?? entry.cli_backend),
      sessionId: text(entry.sessionId) ?? text(entry.session_id),
      title: name ?? text(entry.title), name, preview: preview ? displayPromptText(preview) : undefined,
      model: text(entry.model), modelProvider: text(entry.modelProvider) ?? text(entry.model_provider),
      parentThreadId: text(entry.parentThreadId) ?? text(entry.parent_thread_id),
      forkedFromId: text(entry.forkedFromId) ?? text(entry.forked_from_id),
      agentNickname: text(entry.agentNickname) ?? text(entry.agent_nickname),
      agentRole: text(entry.agentRole) ?? text(entry.agent_role),
      createdAt: number(entry.createdAt) ?? number(entry.created_at),
      updatedAt: number(entry.updatedAt) ?? number(entry.updated_at),
      recencyAt: number(entry.recencyAt) ?? number(entry.recency_at),
      status: text(entry.status), cwd: text(entry.cwd),
      additionalRoots: Array.isArray(entry.additionalRoots) ? entry.additionalRoots.filter((r): r is string => typeof r === "string") : undefined,
      source: normalizeThreadSource(entry.source),
      threadSource: normalizeThreadSource(entry.threadSource ?? entry.thread_source), path: text(entry.path),
      workspaceMode: entry.workspaceMode === "ssh" ? ("ssh" as const) : undefined,
      sshCommand: text(entry.sshCommand), sshCwd: text(entry.sshCwd),
      remoteExecutionMode: entry.remoteExecutionMode === "autonomous" ? ("autonomous" as const) : undefined,
      remoteLifecycleMode: entry.remoteLifecycleMode === "foreground" ? ("foreground" as const) : entry.remoteLifecycleMode === "background" ? ("background" as const) : undefined
    };
  }).filter((entry) => entry.id);
}

export function mergeThreadLists(...lists: ThreadCatalog[]): ThreadCatalog {
  const byId = new Map<string, ThreadCatalogEntry>();
  // `normalizeThreads` emits every key, so a plain spread would let a later
  // list whose field is absent overwrite a value an earlier list did report.
  // `id` is restated because dropping undefined values makes it optional.
  for (const list of lists) for (const thread of list) byId.set(thread.id, { ...byId.get(thread.id), ...definedEntries(thread), id: thread.id });
  return sortThreads([...byId.values()]);
}

function definedEntries(thread: ThreadCatalogEntry): Partial<ThreadCatalogEntry> {
  const defined: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(thread)) if (value !== undefined) defined[key] = value;
  return defined as Partial<ThreadCatalogEntry>;
}

export function mergeListedThreadsWithOptimistic(
  listedThreads: ThreadCatalog,
  currentThreads: ThreadCatalog,
  optimisticThreadIds: Set<string>
): ThreadCatalog {
  const listedIds = new Set(listedThreads.map((thread) => thread.id));
  for (const threadId of listedIds) optimisticThreadIds.delete(threadId);
  const pendingThreads = currentThreads.filter((thread) => optimisticThreadIds.has(thread.id));
  return mergeThreadLists(listedThreads, pendingThreads);
}

export function mergeSuccessfulThreadList(
  listedThreads: unknown,
  currentThreads: ThreadCatalog,
  optimisticThreadIds: Set<string>
): ThreadCatalog | null {
  return Array.isArray(listedThreads)
    ? mergeListedThreadsWithOptimistic(listedThreads as ThreadCatalog, currentThreads, optimisticThreadIds)
    : null;
}

export function catalogForOpenedThreads(
  visibleThreads: ThreadCatalog,
  allThreads: ThreadCatalog,
  openedThreadIds: Iterable<string | null | undefined>
): ThreadCatalog {
  const opened = new Set([...openedThreadIds].filter((threadId): threadId is string => Boolean(threadId)));
  if (opened.size === 0) return visibleThreads;
  return mergeThreadLists(visibleThreads, allThreads.filter((thread) => opened.has(thread.id)));
}

export function renameThreadEntry(
  threads: ThreadCatalog,
  threadId: string,
  name: string,
  cliBackend?: CliBackend
): ThreadCatalog {
  const updatedAt = Math.floor(Date.now() / 1000);
  return threads.some((thread) => thread.id === threadId)
    ? threads.map((thread) => thread.id === threadId ? {
        ...thread,
        title: name,
        name,
        preview: name,
        updatedAt,
        ...(cliBackend ? { cliBackend } : {})
      } : thread)
    : [{
        id: threadId,
        title: name,
        name,
        preview: name,
        updatedAt,
        status: "idle",
        // The fallback path creates a brand-new catalog entry; without a
        // backend it defaulted to the Codex history filter, so a renamed
        // Claude thread appeared under "Codex". Carry the known backend over.
        ...(cliBackend ? { cliBackend } : {})
      }, ...threads];
}

export function renameThreadAcrossCatalogs(
  historyThreads: ThreadCatalog,
  visibleThreads: ThreadCatalog,
  threadId: string,
  name: string,
  cliBackend?: CliBackend
): ThreadCatalog {
  return renameThreadEntry(mergeThreadLists(historyThreads, visibleThreads), threadId, name, cliBackend);
}

export function displayThreadTitle(thread: ThreadCatalogEntry): string {
  const title = thread.title || thread.name || thread.preview;
  if (title?.trim()) return title.trim();
  const stamp = thread.recencyAt ?? thread.updatedAt ?? thread.createdAt;
  const date = stamp ? new Date(stamp * 1000).toISOString().slice(0, 10) : "Stored thread";
  return `${date} ${thread.id.slice(0, 8)}`;
}

export function isSshThread(thread: Pick<ThreadCatalogEntry, "workspaceMode" | "sshCommand">): boolean {
  return thread.workspaceMode === "ssh" || Boolean(thread.sshCommand?.trim());
}

export function sshThreadHostLabel(thread: Pick<ThreadCatalogEntry, "workspaceMode" | "sshCommand">): string | null {
  if (!isSshThread(thread)) return null;
  const command = thread.sshCommand?.trim();
  if (!command) return "SSH";
  const tokens = command.match(/(?:[^\s"']+|"[^"]*"|'[^']*')+/g)?.map((token) => token.replace(/^["']|["']$/g, "")) ?? [];
  const sshIndex = tokens.findIndex((token) => /(^|[\/])ssh(?:\.exe)?$/i.test(token));
  const args = sshIndex >= 0 ? tokens.slice(sshIndex + 1) : tokens;
  for (let index = args.length - 1; index >= 0; index -= 1) {
    const token = args[index];
    if (!token || token.startsWith("-") || /^\d+$/.test(token)) continue;
    if (/^[\w.-]+@[\w.:[\]-]+$/.test(token) || /^(?:[\w-]+\.)+[\w-]+$/.test(token) || /^(?:\d{1,3}\.){3}\d{1,3}$/.test(token)) return token;
  }
  return "SSH";
}

export function sshThreadTooltip(thread: Pick<ThreadCatalogEntry, "workspaceMode" | "sshCommand" | "sshCwd" | "cwd">): string | null {
  const host = sshThreadHostLabel(thread);
  if (!host) return null;
  const remoteCwd = thread.sshCwd?.trim() || thread.cwd?.trim();
  return ["SSH", host === "SSH" ? null : host, remoteCwd].filter(Boolean).join(" · " );
}

export function filterThreadsByDateRange(threads: ThreadCatalog, dateRange: ThreadDateRange): ThreadCatalog {
  const from = normalizedDateInput(dateRange.from);
  const to = normalizedDateInput(dateRange.to);
  if (!from && !to) return threads;
  const lower = from && to && from > to ? to : from;
  const upper = from && to && from > to ? from : to;
  return threads.filter((thread) => {
    const day = threadDateKey(thread);
    return Boolean(day && (!lower || day >= lower) && (!upper || day <= upper));
  });
}

function sortThreads(threads: ThreadCatalog): ThreadCatalog {
  return threads.sort((a, b) => (b.recencyAt ?? b.updatedAt ?? b.createdAt ?? 0) - (a.recencyAt ?? a.updatedAt ?? a.createdAt ?? 0));
}

function threadDateKey(thread: ThreadCatalogEntry): string | null {
  const stamp = thread.recencyAt ?? thread.updatedAt ?? thread.createdAt;
  if (!stamp) return null;
  const date = new Date(stamp > 10_000_000_000 ? stamp : stamp * 1000);
  if (Number.isNaN(date.getTime())) return null;
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function normalizedDateInput(value: string): string {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : "";
}

function normalizeThreadSource(value: unknown): string | undefined {
  if (typeof value === "string" && value) return value;
  const source = record(value);
  return text(source.type) ?? text(source.kind) ?? text(source.source);
}

/** Only alternative backends are explicitly tagged; everything else is a Codex thread. */
export function normalizeCliBackend(value: unknown): CliBackend | undefined {
  return normalizeCliBackendFilter(value);
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}
function text(value: unknown): string | undefined { return typeof value === "string" && value ? value : undefined; }
function number(value: unknown): number | undefined { return typeof value === "number" && Number.isFinite(value) ? value : undefined; }
