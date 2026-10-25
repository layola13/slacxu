import type { ThreadHistoryRpc } from "./app/threads/threadHistoryService";
import { threadReadToTurns, threadTurnsPageToTurns, type ThreadEntry, type WorkbenchTurn } from "./state/codexClient";
import { mergeWorkbenchTurns, orderWorkbenchTurns } from "./state/workbenchTimeline";

const MAX_EXPORT_PAGES = 1_000;

export async function loadCompleteCodexHistory(
  client: ThreadHistoryRpc,
  threadId: string,
  fallbackThread?: ThreadEntry
): Promise<{ thread: ThreadEntry; turns: WorkbenchTurn[] }> {
  const metadata = threadReadToTurns(await client.rpc("thread/read", { threadId, includeTurns: false }));
  const thread = metadata.thread ?? fallbackThread;
  if (!thread) throw new Error("Unable to read the conversation metadata");

  const isPaginated = metadata.thread?.historyMode === "paginated" || fallbackThread?.historyMode === "paginated";
  if (!isPaginated) {
    const loaded = threadReadToTurns(await client.rpc("thread/read", { threadId, includeTurns: true }));
    return { thread: loaded.thread ?? thread, turns: orderWorkbenchTurns(loaded.turns) };
  }

  let cursor: string | null = null;
  let pages = 0;
  let turns: WorkbenchTurn[] = [];
  do {
    const page = threadTurnsPageToTurns(threadId, await client.rpc("thread/turns/list", {
      threadId, cursor, limit: 100, sortDirection: "desc", itemsView: "full"
    }), "desc");
    turns = mergeWorkbenchTurns(turns, page.turns);
    cursor = page.nextCursor;
    pages += 1;
    if (pages >= MAX_EXPORT_PAGES && cursor) throw new Error("Conversation is too large to export in one file");
  } while (cursor);

  return { thread, turns: orderWorkbenchTurns(turns) };
}

export function buildCodexHistoryMarkdown(thread: ThreadEntry, turns: WorkbenchTurn[]): string {
  const title = displayTitle(thread);
  const lines = [`# ${title}`, "", `- Thread ID: ${thread.id}`];
  if (thread.model) lines.push(`- Model: ${thread.model}`);
  if (thread.modelProvider) lines.push(`- Provider: ${thread.modelProvider}`);
  if (thread.cwd) lines.push(`- Workspace: ${thread.cwd}`);
  if (thread.createdAt) lines.push(`- Created: ${formatTimestamp(thread.createdAt)}`);
  lines.push("");

  const orderedTurns = orderWorkbenchTurns(turns);
  if (orderedTurns.length === 0) {
    lines.push("_No messages found._", "");
    return lines.join("\n");
  }

  orderedTurns.forEach((turn, turnIndex) => {
    lines.push(`## Turn ${turnIndex + 1}`, "", `Status: ${turn.status}`);
    if (turn.startedAt) lines.push(`Started: ${formatTimestamp(turn.startedAt)}`);
    if (turn.completedAt) lines.push(`Completed: ${formatTimestamp(turn.completedAt)}`);
    lines.push("");
    turn.items.forEach((item) => {
      lines.push(`### ${item.title || item.type}`);
      if (item.text.trim()) lines.push(item.text.trim());
      else if (item.images?.length) lines.push(item.images.map((image) => `[image${image.name ? `: ${image.name}` : ""}]`).join("\n"));
      else if (item.files?.length) lines.push(item.files.map((file) => `[file: ${file.name}]`).join("\n"));
      else lines.push("_(No text)_");
      lines.push("");
    });
  });

  return lines.join("\n").trimEnd() + "\n";
}

export function codexHistoryFilename(thread: ThreadEntry): string {
  const safeTitle = displayTitle(thread)
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, "-")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80) || "codex-history";
  return `${safeTitle}-${thread.id.slice(0, 8)}.md`;
}

export function downloadTextFile(filename: string, content: string, mimeType = "text/markdown;charset=utf-8"): void {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.style.display = "none";
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}

function displayTitle(thread: ThreadEntry): string {
  const title = thread.title || thread.name || thread.preview;
  if (title?.trim()) return title.trim();
  const stamp = thread.recencyAt ?? thread.updatedAt ?? thread.createdAt;
  const date = stamp ? new Date(stamp * 1000).toISOString().slice(0, 10) : "Stored thread";
  return `${date} ${thread.id.slice(0, 8)}`;
}

function formatTimestamp(value: number): string {
  const millis = value >= 1_000_000_000_000 ? value : value * 1000;
  return new Date(millis).toISOString();
}
