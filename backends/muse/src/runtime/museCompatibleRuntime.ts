import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { EventEmitter } from "node:events";
import { createInterface } from "node:readline";
import { appendFileSync, mkdirSync, readdirSync, readFileSync, existsSync, writeFileSync, unlinkSync, rmSync } from "node:fs";
import { join, dirname } from "node:path";
import { randomUUID } from "node:crypto";
import { homedir } from "node:os";
import { pluginHostServices } from "@cxu/sdk-backend";
import {
  findMuseBin,
  buildMuseExecArgs,
  buildSafeMuseEnv,
  buildMuseSaVmSettingsDir,
  resolveMuseScratchDirs,
  resolveMuseScratchRoot,
  isWithinDir,
} from "./museCompatibleProbe.js";
import {
  createMuseProjectorContext,
  projectMuseJsonlRecord,
  finalizeMuseProjection,
  type MuseProjectedEvent,
  type MuseProjectorContext,
} from "./museCompatibleTurnProjector.js";

export interface MuseExecTurnOptions {
  prompt: string;
  cwd: string;
  threadId: string;
  sessionId?: string;
  model?: string;
  effort?: string;
  baseUrl?: string;
  relayApiKey?: string;
  dangerouslyBypassPermissions?: boolean;
  timeoutMs?: number;
  env?: NodeJS.ProcessEnv;
  /**
   * Absolute path to `sa-vm-mcp.mjs`. Set → per-run XDG settings.json
   * mounts the sa-vm MCP server for this turn (opencode-style injection,
   * user home untouched). Unset → spawn as before (no MCP).
   */
  saVmMcpScriptPath?: string;
  /** Explicit sa-vm endpoint URL (defaults to server's own CODEX_UI_PORT). */
  saVmApiUrl?: string;
  /** Explicit auth token for sa-vm endpoint. */
  token?: string;
  /** Callback fired immediately when the muse CLI child process is spawned. */
  onSpawn?: (child: ChildProcessWithoutNullStreams) => void;
}

export interface MuseExecTurnResult {
  text: string;
  sessionId?: string;
  completed: boolean;
  rawLines: number;
  /** 失败时的真实原因（stderr 尾部 / spawn 错误 / 超时），成功时为空。 */
  error?: string;
}

interface MuseJsonlRecord {
  payload_type?: string;
  payload?: Record<string, any>;
}

/** Extract assistant text deltas from muse exec --json JSONL records. */
export function projectMuseJsonlLine(line: string, acc: { text: string }): boolean {
  const trimmed = line.trim();
  if (!trimmed || !trimmed.startsWith("{")) return false;
  let record: MuseJsonlRecord;
  try {
    record = JSON.parse(trimmed) as MuseJsonlRecord;
  } catch {
    return false;
  }
  const payloadType = record.payload_type ?? "";
  const payload = record.payload ?? {};
  if (payloadType === "run.output.delta" && typeof payload.text === "string") {
    acc.text += payload.text;
    return true;
  }
  // reasoning/thinking 增量也计入文本累积（瀑布流由投影器单独发射 reasoning 事件）
  if ((payloadType === "run.reasoning.delta" || payloadType === "run.thinking.delta"
    || payloadType === "run.output.reasoning.delta") && typeof (payload as Record<string, unknown>).text === "string") {
    return true;
  }
  if (payloadType === "run.terminal.completed" && typeof payload.text === "string" && !acc.text) {
    acc.text = payload.text;
    return true;
  }
  return false;
}

export interface MuseExecTurnOptionsWithTurn extends MuseExecTurnOptions {
  turnId?: string;
}

export function extractMuseSessionId(line: string): string | undefined {
  try {
    const record = JSON.parse(line) as MuseJsonlRecord & { stream?: { id?: string } };
    const id = record.stream?.id;
    return typeof id === "string" && id ? id : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Best-effort removal of the pre-scratch workspace litter. Older builds
 * redirected the child's XDG dirs into `<cwd>/.codex-ultra/` (`muse-data`,
 * `muse-config`, `muse-prompts`), where muse unpacked hundreds of bundled
 * skill files on first run — showing up as untracked files in the user's git
 * repo. New turns use the user-scoped scratch root instead (see
 * resolveMuseScratchDirs); this removes the legacy dirs once. Only touches
 * those three exact subdirs, never anything else.
 */
export function removeLegacyMuseWorkspaceDirs(cwd: string): void {
  try {
    const base = join(String(cwd ?? ""), ".codex-ultra");
    if (!base || base === join(".codex-ultra")) return;
    for (const name of ["muse-data", "muse-config", "muse-prompts"]) {
      try {
        const dir = join(base, name);
        if (existsSync(dir)) rmSync(dir, { recursive: true, force: true });
      } catch { /* best-effort per dir */ }
    }
  } catch { /* best-effort */ }
}

/**
 * Run one headless `muse exec --json --provider meta` turn.
 * Emits `delta` events for streaming text and resolves with the full text.
 * Relay mode: baseUrl + relayApiKey (as META_API_KEY) travel only in child env.
 */
export class MuseCompatibleRuntime extends EventEmitter {
  private child: ChildProcessWithoutNullStreams | null = null;
  private interrupted = false;

  get isRunning(): boolean {
    return Boolean(this.child && !this.child.killed && this.child.exitCode === null);
  }

  async runExecTurn(options: MuseExecTurnOptions & { turnId?: string }): Promise<MuseExecTurnResult> {
    this.interrupted = false;
    return runMuseExecTurn({
      ...options,
      onSpawn: (child) => {
        this.child = child;
        options.onSpawn?.(child);
      },
    }, (event, data) => {
      this.emit(event === "error" ? "runtimeError" : event, data);
    }).finally(() => {
      this.child = null;
    });
  }

  interrupt(): void {
    if (this.interrupted) return;
    this.interrupted = true;
    const child = this.child;
    if (!child) return;
    try {
      if (child.stdin && !child.stdin.destroyed) {
        try { child.stdin.end(); } catch {}
      }
    } catch {}

    const pid = child.pid;
    if (process.platform === "win32" && typeof pid === "number" && pid > 0) {
      try {
        const killer = spawn("taskkill", ["/pid", String(pid), "/T", "/F"], { windowsHide: true });
        killer.on("error", () => {
          try { child.kill("SIGTERM"); } catch {}
          try { child.kill(); } catch {}
        });
      } catch {
        try { child.kill("SIGTERM"); } catch {}
        try { child.kill(); } catch {}
      }
    } else {
      try { child.kill("SIGTERM"); } catch {}
      try { child.kill("SIGKILL"); } catch {}
    }
  }
}

/**
 * 在 per-turn 数据目录下定位 muse session log（ verified 1.4.7/1.4.10：
 * `$XDG_DATA_HOME/muse/sessions/<date>/<session-id>/session.jsonl`，
 * 实测日期层可能为 1 层 `<YYYY-MM-DD>` 或 3 层 `<YYYY>/<MM>/<DD>`）。
 * 使用 BFS 遍历至多 5 层子目录精确匹配 `<sid>/session.jsonl`，不假设日期层级。
 */
export function findMuseSessionLog(dataDir: string, sessionId: string): string | null {
  try {
    const sessionsRoot = join(dataDir, "muse", "sessions");
    if (!existsSync(sessionsRoot)) return null;
    const sid = sessionId.trim();
    if (!sid) return null;
    const queue: Array<{ dir: string; depth: number }> = [{ dir: sessionsRoot, depth: 0 }];
    while (queue.length > 0) {
      const current = queue.shift()!;
      if (current.depth > 5) continue;
      let entries: Array<{ isDirectory(): boolean; name: string }>;
      try {
        entries = readdirSync(current.dir, { withFileTypes: true });
      } catch {
        continue;
      }
      for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        if (entry.name === sid) {
          const logPath = join(current.dir, entry.name, "session.jsonl");
          if (existsSync(logPath)) return logPath;
        } else if (current.depth < 5) {
          queue.push({ dir: join(current.dir, entry.name), depth: current.depth + 1 });
        }
      }
    }
  } catch { /* 找不到就当没有 log，fallback 到 stdout */ }
  return null;
}

/**
 * Workflow/native subagents write their own log under the parent session:
 * `sessions/<date...>/<parent>/subagent/<child>/session.jsonl` (verified
 * 2026-10-22 against Muse 1.4.11 workflow + native subagent runs).
 *
 * Child sessions are not CUX threads, so the parent thread/read path cannot
 * restore them; opening a child card used to hit the Codex bridge and fail
 * with `thread not loaded`. Search the scratch data root and the real XDG
 * data root (resumed parents keep their children beside the original log).
 */
export function findMuseChildSessionLog(
  childSessionId: string,
  env: NodeJS.ProcessEnv = process.env,
): string | null {
  const sid = childSessionId.trim();
  if (!sid) return null;
  const dataRoots = new Set<string>();
  try {
    dataRoots.add(join(resolveMuseScratchRoot(env), "data"));
  } catch { /* scratch root unavailable */ }
  const xdgDataHome = (env.XDG_DATA_HOME ?? "").trim();
  const home = (env.HOME ?? env.USERPROFILE ?? "").trim() || (() => {
    try { return homedir(); } catch { return ""; }
  })();
  if (xdgDataHome) dataRoots.add(xdgDataHome);
  if (home) dataRoots.add(join(home, ".local", "share"));

  for (const dataRoot of dataRoots) {
    const sessionsRoot = join(dataRoot, "muse", "sessions");
    if (!existsSync(sessionsRoot)) continue;
    const queue: Array<{ dir: string; depth: number }> = [{ dir: sessionsRoot, depth: 0 }];
    while (queue.length > 0) {
      const current = queue.shift()!;
      if (current.depth > 8) continue;
      let entries: Array<{ isDirectory(): boolean; name: string }>;
      try {
        entries = readdirSync(current.dir, { withFileTypes: true });
      } catch {
        continue;
      }
      for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        if (entry.name === sid) {
          const logPath = join(current.dir, entry.name, "session.jsonl");
          if (existsSync(logPath)) return logPath;
        } else {
          queue.push({ dir: join(current.dir, entry.name), depth: current.depth + 1 });
        }
      }
    }
  }
  return null;
}

export interface MuseChildSessionProjection {
  logPath: string;
  items: Array<Record<string, unknown>>;
  status: "running" | "completed" | "failed";
  startedAt: number;
}

/**
 * Project a subagent session log into the same item shape the parent
 * waterfall uses. Child logs contain reasoning_committed / tool_batch.effect
 * events instead of the parent's stdout `tool.result`, so the projector's
 * offline branch handles those inner kinds.
 */
export function readMuseChildSessionLog(
  childSessionId: string,
  env: NodeJS.ProcessEnv = process.env,
): MuseChildSessionProjection | null {
  const logPath = findMuseChildSessionLog(childSessionId, env);
  if (!logPath) return null;
  let raw = "";
  try {
    raw = readFileSync(logPath, "utf8");
  } catch {
    return null;
  }
  const ctx = createMuseProjectorContext(childSessionId, childSessionId);
  ctx.offline = true;
  const items: Array<Record<string, unknown>> = [];
  let terminal: string | undefined;
  let startedAt = 0;
  const upsert = (kind: "item/started" | "item/completed", item: Record<string, unknown>) => {
    if (!item || typeof item.id !== "string") return;
    const idx = items.findIndex((m) => m && m.id === item.id);
    if (kind === "item/started") {
      if (idx < 0) items.push(item);
    } else if (idx >= 0) {
      items[idx] = item;
    } else {
      items.push(item);
    }
  };
  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("{")) continue;
    try {
      const record = JSON.parse(trimmed) as Record<string, unknown>;
      const recordedAt = typeof record.recorded_at === "string" ? Date.parse(record.recorded_at) : NaN;
      if (!startedAt && Number.isFinite(recordedAt)) startedAt = Math.floor(recordedAt / 1000);
      if (record.payload_type === "runtime.session") {
        const event = (record.payload && typeof record.payload === "object"
          ? (record.payload as Record<string, unknown>).event
          : undefined) as Record<string, unknown> | undefined;
        if (event?.kind === "terminal") {
          terminal = typeof event.terminal === "string" ? event.terminal : undefined;
        }
      }
      const projected = projectMuseJsonlRecord(trimmed, ctx);
      for (const evt of projected) {
        if (evt.kind !== "item/started" && evt.kind !== "item/completed") continue;
        const item = evt.item as unknown as Record<string, unknown>;
        upsert(evt.kind, item);
      }
    } catch { /* 单行损坏不影响整段历史 */ }
  }
  if (!terminal && ctx.status !== "running") terminal = ctx.status;
  const normalizedTerminal = (terminal ?? "").toLowerCase();
  const status: MuseChildSessionProjection["status"] = /fail|error|cancel/.test(normalizedTerminal)
    ? "failed"
    : /complete|terminal|success/.test(normalizedTerminal)
      ? "completed"
      : "running";
  return {
    logPath,
    items,
    status,
    startedAt: startedAt || Math.floor(Date.now() / 1000),
  };
}

export function runMuseExecTurn(
  options: MuseExecTurnOptions & { turnId?: string },
  emit?: (event: string, data?: unknown) => void,
): Promise<MuseExecTurnResult> {
  const bin = findMuseBin(options.env ?? process.env);
  // A→B→C 开始顺序：stdout 只有 tool.result（完成事件），开始顺序只能从
  // session log 的 started 事件拿。新 turn（无 resume sessionId）才定向：
  // 固定 --session-id + per-thread XDG_DATA_HOME；resume 的 turn 不碰
  // （旧 log 在用户真实数据目录里，覆盖 XDG 会断 resume）。
  const resumeSessionId = options.sessionId?.trim() || "";
  const captureSessionId = resumeSessionId || randomUUID();
  // Scratch dirs live under the user home (never inside the workspace):
  // muse unpacks hundreds of bundled-skill files into XDG_DATA_HOME on first
  // run, which used to pollute the user's git repo as untracked files.
  const scratch = resolveMuseScratchDirs(options.threadId, options.env ?? process.env);
  const captureDataDir = resumeSessionId ? "" : scratch.dataDir;
  const promptDir = scratch.promptsDir;
  // One-time migration: drop the legacy workspace litter from older builds.
  removeLegacyMuseWorkspaceDirs(options.cwd);
  let promptFilePath: string | undefined;
  try {
    mkdirSync(promptDir, { recursive: true });
    promptFilePath = join(promptDir, `prompt-${captureSessionId}-${Date.now()}.txt`);
    writeFileSync(promptFilePath, options.prompt, "utf8");
  } catch {
    promptFilePath = undefined;
  }
  const args = buildMuseExecArgs({
    prompt: promptFilePath ? undefined : options.prompt,
    promptFilePath,
    model: options.model,
    effort: options.effort,
    sessionId: captureSessionId,
    workspace: options.cwd,
    baseUrl: options.baseUrl,
    dangerouslyBypassPermissions: options.dangerouslyBypassPermissions,
  });
  const childEnv: NodeJS.ProcessEnv = { ...(options.env ?? process.env) };
  if (captureDataDir) {
    try {
      mkdirSync(captureDataDir, { recursive: true });
      childEnv.XDG_DATA_HOME = captureDataDir;
    } catch { /* 定向失败则无 session-log 顺序，只有 stdout 完成顺序 */ }
  }
  if (options.relayApiKey?.trim()) {
    childEnv.META_API_KEY = options.relayApiKey.trim();
  }
  // sa-vm MCP 挂载（mirrors opencode OPENCODE_CONFIG_CONTENT injection）：
  // per-run XDG_CONFIG_HOME + settings.json，不写用户 home。
  if (options.saVmMcpScriptPath?.trim()) {
    try {
      const baseForPort = options.env ?? process.env;
      const port = Number.parseInt(String(baseForPort.CODEX_UI_PORT ?? "43110"), 10);
      const apiUrl = options.saVmApiUrl?.trim()
        || (Number.isFinite(port) && port > 0 ? `http://127.0.0.1:${port}` : "");
      const token = (options.token ?? childEnv.CODEX_UI_TOKEN ?? process.env.CODEX_UI_TOKEN ?? "").trim();
      const settingsDir = buildMuseSaVmSettingsDir({
        cwd: options.cwd,
        xdgRoot: scratch.configDir,
        scriptPath: options.saVmMcpScriptPath.trim(),
        apiUrl,
        token,
        env: baseForPort,
      });
      if (!settingsDir) throw new Error("sa-vm settings could not be created");
      childEnv.XDG_CONFIG_HOME = settingsDir;
      // 打开 sa-vm MCP 的动作尾行（仅 muse 链路）：muse stdout 的 tool.result
      // 无模型侧 input，尾行是 read_lines 类工具还原参数的唯一来源。
      childEnv.MUSE_SA_VM_ENVELOPE = "1";
    } catch {
      // A preloaded skill promises these tools exist. Never silently start a
      // native-only CLI when the required MCP configuration failed.
      if (promptFilePath) {
        try { unlinkSync(promptFilePath); } catch {}
      }
      return Promise.resolve({
        text: "",
        completed: false,
        rawLines: 0,
        error: "Muse sa-vm MCP configuration failed; refusing to start without required workspace tools",
      });
    }
  }
  const env = buildSafeMuseEnv({}, childEnv);
  const timeoutMs = options.timeoutMs && options.timeoutMs > 0 ? options.timeoutMs : 8 * 60_000;

  return new Promise<MuseExecTurnResult>((resolve) => {
    const acc = { text: "" };
    let sessionId: string | undefined;
    let rawLines = 0;
    let stderrTail = "";
    let settled = false;
    // 瀑布流投影上下文：thinking/todo/subagent/mcp/skill 全部走这里。
    const projector: MuseProjectorContext = createMuseProjectorContext(
      options.threadId,
      (options as MuseExecTurnOptionsWithTurn).turnId ?? options.threadId,
    );
    // session-log tailer 状态（定义在 finish 之前，避免 TDZ：spawn 抛错
    // 路径也会调 finish）。started 事件先占位（开始顺序 A→B→C），stdout 的
    // tool.result 到达时按 call_id 原位 complete。log 不存在/无 started
    // 记录时零作用，行为与今天完全一致。失败永不影响 turn。
    let logOffset = 0;
    let logRemainder = "";
    let logPath: string | null = null;
    let logTimer: ReturnType<typeof setInterval> | null = null;
    const pollSessionLog = () => {
      if (settled || !captureDataDir) return;
      try {
        if (!logPath) {
          logPath = findMuseSessionLog(captureDataDir, captureSessionId);
          if (!logPath) return;
        }
        const content = readFileSync(logPath, "utf8");
        if (content.length <= logOffset) return;
        const chunk = content.slice(logOffset);
        logOffset = content.length;
        const lines = (logRemainder + chunk).split("\n");
        logRemainder = lines.pop() ?? "";
        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed || !trimmed.startsWith("{")) continue;
          try {
            const projected: MuseProjectedEvent[] = projectMuseJsonlRecord(trimmed, projector);
            if (projected.length > 0) emit?.("projected", projected as unknown);
          } catch { /* 忽略单行投影异常 */ }
        }
      } catch { /* log 读取失败不影响 turn */ }
    };
    const stopLogTimer = () => {
      if (logTimer) {
        try { clearInterval(logTimer); } catch {}
        logTimer = null;
      }
    };
    let timer: ReturnType<typeof setTimeout> | null = null;
    let spawnError: string | undefined;
    let exitCode: number | null = null;
    const finish = (completed: boolean, explicitError?: string) => {
      if (settled) return;
      settled = true;
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
      if (promptFilePath) {
        try { unlinkSync(promptFilePath); } catch {}
      }
      try { stopLogTimer(); } catch {}
      // 终局再扫一遍 session log：close 与最后一次轮询之间可能还有 started
      // 落盘；此时只补占位用（result 早已把行 close，upsert 原位更新不移位）。
      try { pollSessionLog(); } catch {}
      // Per-turn session cleanup: the scratch data dir is shared across
      // threads (skills extracted once); drop this turn's session subdir so
      // logs don't accumulate. Guarded to never escape the data dir.
      try {
        if (captureDataDir && logPath && isWithinDir(captureDataDir, logPath)) {
          rmSync(dirname(logPath), { recursive: true, force: true });
        }
      } catch { /* best-effort cleanup */ }
      // 收尾闭合所有 open 的行，桥接层负责把事件转成 notification。
      try {
        const tail = finalizeMuseProjection(projector, completed ? "completed" : "failed");
        if (tail.length > 0) emit?.("projected", tail as unknown);
      } catch { /* 投影收尾永不抛错 */ }
      const stderrText = stderrTail.trim();
      const error = completed
        ? undefined
        : (explicitError?.trim() || stderrText || spawnError?.trim()
          || (exitCode !== null ? `muse exec exited with code ${exitCode}` : "muse exec turn failed"));
      resolve({ text: acc.text, sessionId, completed, rawLines, error });
    };

    let child: ChildProcessWithoutNullStreams;
    try {
      const resolved = pluginHostServices().codex.resolveCodexSpawn(bin, args, process.platform, env);
      child = spawn(resolved.command, resolved.args, {
        cwd: options.cwd,
        env,
        stdio: ["ignore", "pipe", "pipe"],
        windowsHide: true,
      }) as unknown as ChildProcessWithoutNullStreams;
      options.onSpawn?.(child);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      spawnError = msg;
      emit?.("error", err instanceof Error ? err : new Error(String(err)));
      finish(false, msg);
      return;
    }

    timer = setTimeout(() => {
      try { child.kill("SIGTERM"); } catch {}
      const timedOut = !settled;
      finish(acc.text.length > 0, timedOut && !acc.text ? `muse exec timed out after ${timeoutMs}ms${stderrTail.trim() ? `: ${stderrTail.trim().slice(-2000)}` : ""}` : undefined);
    }, timeoutMs);
    if (timer.unref) {
      try { timer.unref(); } catch {}
    }

    const rl = createInterface({ input: child.stdout, crlfDelay: Infinity });
    // 调试开关：MUSE_JSONL_DUMP_DIR 指向目录时，把 exec 原始 JSONL 逐行落盘，
    // 用于确认上游 stdout 里到底有哪些 payload_type（默认关闭，零开销）。
    const jsonlDumpDir = (childEnv.MUSE_JSONL_DUMP_DIR ?? process.env.MUSE_JSONL_DUMP_DIR ?? "").trim();
    let jsonlDumpPath: string | null = null;
    if (jsonlDumpDir) {
      try {
        mkdirSync(jsonlDumpDir, { recursive: true });
        jsonlDumpPath = join(jsonlDumpDir, `muse-${options.threadId}-${Date.now()}.jsonl`);
      } catch {
        jsonlDumpPath = null;
      }
    }
    rl.on("line", (line: string) => {
      rawLines += 1;
      if (jsonlDumpPath) {
        try {
          appendFileSync(jsonlDumpPath, line + "\n");
        } catch { /* 落盘失败不影响 turn */ }
      }
      if (!sessionId) {
        sessionId = extractMuseSessionId(line);
      }
      // 全量投影（thinking/todo/subagent/mcp/skill/tool），失败永不影响文本流。
      try {
        const projected: MuseProjectedEvent[] = projectMuseJsonlRecord(line, projector);
        if (projected.length > 0) emit?.("projected", projected as unknown);
      } catch { /* 忽略单行投影异常 */ }
      if (projectMuseJsonlLine(line, acc)) {
        emit?.("delta", { threadId: options.threadId, text: acc.text });
      }
    });

    if (captureDataDir) {
      try { pollSessionLog(); } catch {}
      logTimer = setInterval(pollSessionLog, 150);
      if ((logTimer as unknown as { unref?: () => void }).unref) {
        try { (logTimer as unknown as { unref: () => void }).unref(); } catch {}
      }
    }

    child.stderr.on("data", (chunk: Buffer) => {
      stderrTail += chunk.toString("utf8");
      if (stderrTail.length > 4000) {
        stderrTail = stderrTail.slice(-4000);
      }
    });

    child.on("error", (err) => {
      spawnError = err instanceof Error ? err.message : String(err);
      emit?.("error", err);
      try { rl.close(); } catch {}
      finish(false, spawnError);
    });

    child.on("close", (code) => {
      try { rl.close(); } catch {}
      exitCode = typeof code === "number" ? code : null;
      if (code === 0 || acc.text) {
        finish(true);
      } else {
        const errText = stderrTail.trim() || `muse exec exited with code ${code}`;
        emit?.("error", new Error(errText));
        finish(false, errText);
      }
    });
  });
}
