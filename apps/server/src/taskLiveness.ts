/**
 * Task-completion liveness probing for the Claude Code CLI bridge.
 *
 * Problem this addresses: Claude Code CLI marks a background command
 * "completed" as soon as its *shell process exits*. If that command spawned a
 * child that is still running (a packaging step, a `while`-poll watcher, a
 * detached `&` job), the CLI (and therefore the workbench UI) shows "completed"
 * while real work is still going on.
 *
 * Claude Code CLI's own source is read-only, so the correction lives here, in
 * the bridge that drives the CLI as a local child process. When the CLI reports
 * a task as completed we don't trust it immediately: we check whether the CLI
 * *still has descendant processes* (the lingering children) and, if so, keep
 * the task in its running/in-progress state until the process tree settles.
 *
 * This only fires for the local Claude Code CLI bridge. When the CLI runs
 * remotely (e.g. over SSH) its descendants are not in this machine's process
 * tree, so no "extra" processes are ever observed and the gate degrades to an
 * instant pass-through — safe, just not helpful in that topology.
 */

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { readdir, readFile } from "node:fs/promises";

const execFileAsync = promisify(execFile);

/** How long a task may stay "watching…" before we force completion. */
export const TASK_GATE_MAX_MS = 5 * 60 * 1000;

/** Interval between process-tree re-checks while a task appears still active. */
export const TASK_GATE_POLL_MS = 1500;

export function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Enumerate all descendant PIDs of `rootPid` (excluding `rootPid` itself).
 * Best-effort: any enumeration error yields an empty set, which makes the gate
 * behave as a pass-through rather than incorrectly holding a task forever.
 */
export async function listDescendantPids(rootPid: number): Promise<Set<number>> {
  if (process.platform === "win32") {
    return listDescendantPidsWindows(rootPid);
  }
  return listDescendantPidsUnix(rootPid);
}

async function listDescendantPidsWindows(rootPid: number): Promise<Set<number>> {
  try {
    const script =
      "Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId | ConvertTo-Json -Compress";
    const { stdout } = await execFileAsync(
      "powershell",
      ["-NoProfile", "-NonInteractive", "-Command", script],
      { timeout: 10_000 },
    );
    return descendantsOf(parseWindowsProcesses(stdout), rootPid);
  } catch {
    return new Set();
  }
}

export function parseWindowsProcesses(stdout: string): Map<number, number> {
  const map = new Map<number, number>();
  const trimmed = stdout.trim();
  if (!trimmed) return map;
  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    return map;
  }
  const arr = Array.isArray(parsed) ? parsed : [parsed];
  for (const p of arr) {
    const pid = Number((p as { ProcessId?: unknown })?.ProcessId);
    const ppid = Number((p as { ParentProcessId?: unknown })?.ParentProcessId);
    if (Number.isFinite(pid) && Number.isFinite(ppid)) map.set(pid, ppid);
  }
  return map;
}

async function listDescendantPidsUnix(rootPid: number): Promise<Set<number>> {
  try {
    const map = new Map<number, number>();
    const entries = await readdir("/proc");
    for (const name of entries) {
      const pidNum = Number(name);
      if (!Number.isInteger(pidNum)) continue;
      try {
        const stat = await readFile(`/proc/${name}/stat`, "utf8");
        const rparen = stat.indexOf(")");
        if (rparen === -1) continue;
        const rest = stat.slice(rparen + 1).trim().split(/\s+/);
        const ppid = Number(rest[1]);
        if (Number.isFinite(ppid)) map.set(pidNum, ppid);
      } catch {
        // Process exited between readdir and read — ignore.
      }
    }
    return descendantsOf(map, rootPid);
  } catch {
    return new Set();
  }
}

/**
 * Given a pid→ppid map, return the set of PIDs whose ancestor chain reaches
 * `rootPid`. Pure and platform-independent — exercised directly by tests.
 */
export function descendantsOf(parentMap: Map<number, number>, rootPid: number): Set<number> {
  const result = new Set<number>();
  for (const pid of parentMap.keys()) {
    // A node is never its own descendant; also seed `seen` with the candidate so a
    // cycle that loops back through it (a↔b with root=a) cannot re-discover the root
    // and falsely report self-descent.
    if (pid === rootPid) continue;
    let cur: number | undefined = parentMap.get(pid);
    const seen = new Set<number>([pid]);
    while (cur !== undefined && !seen.has(cur)) {
      if (cur === rootPid) {
        result.add(pid);
        break;
      }
      seen.add(cur);
      cur = parentMap.get(cur);
    }
  }
  return result;
}

/**
 * True when `rootPid` has at least one descendant process that was NOT present
 * in `baseline` (the process tree captured when the task started). A new process
 * that outlived the command's own shell is exactly the "still working" signal.
 */
export async function hasExtraDescendantProcesses(
  rootPid: number | undefined,
  baseline: Set<number>,
): Promise<boolean> {
  if (rootPid === undefined) return false;
  const current = await listDescendantPids(rootPid);
  for (const pid of current) {
    if (!baseline.has(pid)) return true;
  }
  return false;
}
