import type { ChildProcessWithoutNullStreams, SpawnOptionsWithoutStdio } from "node:child_process";
import type { JsonValue } from "@codex-ui/shared";
import { buildSafeClaudeEnv, buildClaudeSpawnArgs, findClaudeBin, spawnClaudeCommand } from "./claudeCompatibleProbe.js";

export type ClaudeCompactionRoute = { providerId: string; groupId: string; model: string };
export type ClaudeCompactionInput = {
  threadId: string;
  cwd: string;
  transcript: string;
  route: ClaudeCompactionRoute;
  runtimeEnv: NodeJS.ProcessEnv;
  cliBackend?: "claude";
};
export type ClaudeCompactionRunner = (input: ClaudeCompactionInput) => Promise<string>;

type SpawnCommand = (command: string, args: string[], options: SpawnOptionsWithoutStdio) => ChildProcessWithoutNullStreams;
const COMPACTION_TIMEOUT_MS = 5 * 60_000;

function redactCompactionText(value: string): string {
  return value
    .replace(/sk-[A-Za-z0-9_-]{12,}/g, "sk-***")
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]{12,}/gi, "Bearer ***")
    .replace(/api[_-]?key["'=:\s]+[A-Za-z0-9._~+/=-]{8,}/gi, "api_key=***");
}

function compactionErrnoDetails(error: unknown): Record<string, string | number | undefined> {
  const record = (error && typeof error === "object" ? error : {}) as Record<string, unknown>;
  const pick = (key: string): string | number | undefined => {
    const value = record[key];
    return typeof value === "string" || typeof value === "number" ? value : undefined;
  };
  return { code: pick("code"), errno: pick("errno"), syscall: pick("syscall"), path: pick("path") };
}

function logCompactionEvent(level: "log" | "warn" | "error", event: string, details: Record<string, unknown>): void {
  try {
    console[level](`[claude-compaction] ${event} ${redactCompactionText(JSON.stringify(details)).slice(0, 4000)}`);
  } catch {
    // Logging must never break compaction.
  }
}

export function createClaudeCompactionRunner(
  spawnCommand: SpawnCommand = spawnClaudeCommand,
  terminateChild: (child: ChildProcessWithoutNullStreams) => void = (child) => child.kill("SIGTERM"),
): ClaudeCompactionRunner {
  return async (input) => {
    const gatewayToken = input.runtimeEnv.CODEX_UI_RELAY_GATEWAY_TOKEN?.trim();
    const gatewayPort = input.runtimeEnv.CODEX_UI_PORT?.trim() || "43110";
    if (!gatewayToken) throw new Error("Claude compaction requires a relay gateway credential");

    const relayCustomHeaders = input.threadId?.trim() ? `thread-id: ${input.threadId.trim()}` : undefined;
    const env = buildSafeClaudeEnv(input.runtimeEnv, {
      ANTHROPIC_BASE_URL: `http://127.0.0.1:${gatewayPort}/api/relay-gateway/${encodeURIComponent(input.route.providerId)}/${encodeURIComponent(input.route.groupId)}`,
      ANTHROPIC_API_KEY: gatewayToken,
      CLAUDE_CODE_PROVIDER_MANAGED_BY_HOST: "1",
      ...(relayCustomHeaders ? { ANTHROPIC_CUSTOM_HEADERS: relayCustomHeaders } : {}),
    });
    const args = [
      ...buildClaudeSpawnArgs(input.route.model, "bypassPermissions"),
      "--bare",
      "--no-session-persistence",
      "--tools",
      "",
    ];
    const bin = findClaudeBin(input.runtimeEnv);
    if (!bin) throw new Error("Claude CLI is not installed. Set CODEX_UI_CLAUDE_BIN to a runnable claude executable.");
    logCompactionEvent("log", "start-attempt", {
      threadId: input.threadId,
      bin,
      cwd: input.cwd,
      providerId: input.route.providerId,
      groupId: input.route.groupId,
      model: input.route.model,
      transcriptChars: input.transcript.length,
    });
    let child: ChildProcessWithoutNullStreams;
    try {
      child = spawnCommand(bin, args, { cwd: input.cwd, env });
    } catch (error) {
      logCompactionEvent("error", "start-spawn-sync-failed", {
        threadId: input.threadId,
        bin,
        cwd: input.cwd,
        ...compactionErrnoDetails(error),
        message: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
    logCompactionEvent("log", "start-ok", { threadId: input.threadId, bin, cwd: input.cwd, pid: child.pid ?? null });

    return await new Promise<string>((resolve, reject) => {
      let settled = false;
      let stdoutBuffer = "";
      const assistantParts: string[] = [];
      const finish = (error?: Error, summary?: string) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        try { terminateChild(child); } catch { /* Process already exited. */ }
        if (error) reject(error);
        else resolve(summary?.trim() || assistantParts.join("\n").trim());
      };
      const consumeLine = (line: string) => {
        if (!line.trim()) return;
        let message: Record<string, JsonValue>;
        try { message = JSON.parse(line) as Record<string, JsonValue>; } catch { return; }
        if (message.type === "assistant") {
          const content = (message.message as Record<string, JsonValue> | undefined)?.content;
          if (Array.isArray(content)) {
            for (const block of content) {
              const record = block as Record<string, JsonValue>;
              if (record.type === "text" && typeof record.text === "string") assistantParts.push(record.text);
            }
          }
        }
        if (message.type === "result") {
          const isError = message.is_error === true || (typeof message.subtype === "string" && message.subtype !== "success");
          if (isError) finish(new Error(typeof message.result === "string" ? message.result : "Claude compaction failed"));
          else finish(undefined, typeof message.result === "string" ? message.result : undefined);
        }
      };
      const timeout = setTimeout(() => {
        logCompactionEvent("error", "timeout", { threadId: input.threadId, pid: child.pid ?? null, timeoutMs: COMPACTION_TIMEOUT_MS });
        finish(new Error("Claude compaction timed out after 5 minutes"));
      }, COMPACTION_TIMEOUT_MS);
      child.stdout.on("data", (chunk: Buffer) => {
        stdoutBuffer += chunk.toString("utf8");
        const lines = stdoutBuffer.split(/\r?\n/);
        stdoutBuffer = lines.pop() ?? "";
        for (const line of lines) consumeLine(line);
      });
      child.stderr?.on("data", (chunk: Buffer) => {
        const text = redactCompactionText(chunk.toString("utf8").trim()).slice(0, 2000);
        if (text) logCompactionEvent("warn", "child-stderr", { threadId: input.threadId, pid: child.pid ?? null, stderr: text });
      });
      child.once("error", (error) => {
        logCompactionEvent("error", "child-error", {
          threadId: input.threadId,
          cwd: input.cwd,
          pid: child.pid ?? null,
          ...compactionErrnoDetails(error),
          message: error instanceof Error ? error.message : String(error),
        });
        finish(error);
      });
      child.once("exit", (code, signal) => {
        if (stdoutBuffer) consumeLine(stdoutBuffer);
        if (!settled) {
          logCompactionEvent("error", "child-exit-before-result", {
            threadId: input.threadId,
            cwd: input.cwd,
            pid: child.pid ?? null,
            code,
            signal: signal ?? null,
          });
          finish(new Error(`Claude compaction exited before a result (code ${code ?? "null"}, signal ${signal ?? "null"})`));
        } else {
          logCompactionEvent("log", "child-exit", {
            threadId: input.threadId,
            pid: child.pid ?? null,
            code,
            signal: signal ?? null,
          });
        }
      });
      const prompt = [
        "Create a compact continuation summary of the conversation below.",
        "Preserve user requirements, architectural decisions, completed work, unresolved tasks, exact paths/commands/identifiers, and important failures.",
        "Do not answer the conversation. Output only the continuation summary for another coding agent.",
        "",
        `<conversation thread_id="${input.threadId}">`,
        input.transcript,
        "</conversation>",
      ].join("\n");
      child.stdin.write(JSON.stringify({ type: "user", message: { role: "user", content: prompt }, parent_tool_use_id: null }) + "\n");
    }).then((summary) => {
      if (!summary) {
        logCompactionEvent("error", "empty-summary", { threadId: input.threadId });
        throw new Error("Claude compaction returned an empty summary");
      }
      logCompactionEvent("log", "done", { threadId: input.threadId, summaryChars: summary.length });
      return summary;
    });
  };
}
