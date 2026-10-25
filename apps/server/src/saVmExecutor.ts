import { spawn } from "node:child_process";
import type { SaVmContextSavingsConfig } from "@codex-ui/shared";
import { killProcessTree } from "./saVmProcess.js";
import { resultKind, type SaVmRunResult } from "./saVmResultKind.js";

const MAX_STDOUT_BYTES = 512 * 1024;
const MAX_STDERR_BYTES = 128 * 1024;

export interface SaVmLimits {
  fuel: number;
  deadline_ms: number;
  mem_cap_bytes: number;
  max_call_depth: number;
}

export interface NormalizedSaVmRunInput {
  source: string;
   language: "sa" | "sla" | "js" | "py";
   args: string[];
   cwd: string;
   limits: SaVmLimits;
   policy: Record<string, unknown>;
}

export interface SaVmChildOptions {
   executable: string;
   args: string[];
   cwd: string;
   timeoutMs: number;
   startedAt: number;
   env?: NodeJS.ProcessEnv;
   signal?: AbortSignal;
   parseEvents?: boolean;
   maxStdoutBytes?: number;
   maxStderrBytes?: number;
}

export interface SaVmCompileOptions {
   executable?: string;
   sourcePath: string;
   outputPath: string;
   timeoutMs?: number;
   env?: NodeJS.ProcessEnv;
}

export interface SaVmScriptOptions {
   executable: string;
   args: string[];
   cwd: string;
   timeoutMs: number;
   startedAt: number;
   isPython?: boolean;
   env?: NodeJS.ProcessEnv;
   slimPolicy?: SaVmContextSavingsConfig;
   signal?: AbortSignal;
}

export function resolveSaVmPluginPath(_configured: string | undefined, _root: string): string {
  throw new Error("bun branch: sa/sla runtime removed; sa-vm ships as bun+ts MCP script only.");
}

export function resolveSaVmExecutable(): string {
  throw new Error("bun branch: sa/sla runtime removed; use bun instead.");
}

export function vmProcessEnv(_executable: string, _extraPlugins?: string[]): NodeJS.ProcessEnv {
  throw new Error("bun branch: sa/sla runtime removed.");
}

function collectChunks(chunks: Buffer[], max: number): (chunk: Buffer) => void {
  return (chunk: Buffer) => {
    const current = chunks.reduce((sum, value) => sum + value.byteLength, 0);
    if (current < max) chunks.push(chunk.subarray(0, max - current));
  };
}

function parseSlaVmEvents(stderrRaw: string): { events: Array<Record<string, unknown>>; stderr: string } {
  const stderrLines = stderrRaw.split(/\r?\n/);
   const events = stderrLines.flatMap((line) => {
    const match = line.match(/sa-vm-event:\s*(\{.*\})\s*$/);
    if (!match) return [];
    try { return [JSON.parse(match[1]!) as Record<string, unknown>]; } catch { return []; }
  });
  const stderr = stderrLines.filter((line) => !/sa-vm-event:\s*\{.*\}\s*$/.test(line)).join("\n").trim();
  return { events, stderr };
}

export class SaVmExecutor {
  async runChild(options: SaVmChildOptions): Promise<SaVmRunResult> {
    const maxStdout = options.maxStdoutBytes ?? MAX_STDOUT_BYTES;

    const maxStderr = options.maxStderrBytes ?? MAX_STDERR_BYTES;
    const startedAt = options.startedAt;


    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];
    let spawnError: string | undefined;
    let child: ReturnType<typeof spawn>;
    try {
      child = spawn(options.executable, options.args, {
        cwd: options.cwd,
        windowsHide: true,
        stdio: ["ignore", "pipe", "pipe"],
        env: options.env ?? process.env,
        shell: false
      });
    } catch (err) {
      return {
        ok: false,
        kind: "crashed",
        exitCode: null,
        stdout: "",
        stderr: err instanceof Error ? err.message : String(err),
        saVmEvents: [],
        saVmViolation: null,
        durationMs: Date.now() - startedAt
      };
    }
    child.stdout?.on("data", collectChunks(stdoutChunks, maxStdout));
    child.stderr?.on("data", collectChunks(stderrChunks, maxStderr));
    child.on("error", (err: Error) => { spawnError = err.message; });


    let timedOut = false;
    let aborted = false;
    const timer = setTimeout(() => {
      timedOut = true;
      try { killProcessTree(child.pid); } catch {}
      try { child.kill(); } catch {}
    }, options.timeoutMs);


    const onAbort = () => {
      if (aborted) return;
      aborted = true;
      try { killProcessTree(child.pid); } catch {}
      try { child.kill(); } catch {}
    };
    if (options.signal?.aborted) {


     onAbort();
    } else {
      options.signal?.addEventListener("abort", onAbort, { once: true });
    }


    const exitCode = await new Promise<number | null>((resolveExit, reject) => {
      child.once("error", reject);
      child.once("close", (code) => resolveExit(code));
    }).finally(() => {
      clearTimeout(timer);
      options.signal?.removeEventListener("abort", onAbort);
    }).catch(() => {
      try { killProcessTree(child.pid); } catch {}
      return null;
    });


    const stdout = Buffer.concat(stdoutChunks).toString("utf8");
    const stderrRaw = Buffer.concat(stderrChunks).toString("utf8");
    const parsed = options.parseEvents ? parseSlaVmEvents(stderrRaw) : { events: [] as Array<Record<string, unknown>>, stderr: stderrRaw };
    const stderr = parsed.stderr || spawnError || "";
    const kind: SaVmRunResult["kind"] = aborted
      ? "crashed"
      : timedOut
        ? "timeout"
        : resultKind(exitCode, stderr);
    return {
      ok: kind === "success" && !timedOut && !aborted,
      kind,
      exitCode,
      stdout,
      stderr,
      saVmEvents: parsed.events,
      saVmViolation: parsed.events.find((event) => event.event === "violation") ?? null,
      durationMs: Date.now() - startedAt
    };
  }

  async runScript(options: SaVmScriptOptions): Promise<SaVmRunResult> {
    return this.runChild({
      executable: options.executable,
      args: options.args,
      cwd: options.cwd,
      timeoutMs: options.timeoutMs,
      startedAt: options.startedAt,
      env: {
        ...(options.env ?? process.env),
        ...(options.isPython ? {
          PYTHONUNBUFFERED: "1",
          PYTHONDONTWRITEBYTECODE: "1",
          PYTHONIOENCODING: "utf-8"
        } : {})
      },
      signal: options.signal
    }).then((result) => this.applySlimPolicy(result, options.slimPolicy));
  }


  async compileSla(_options: SaVmCompileOptions): Promise<{ ok: true } | { ok: false; result: SaVmRunResult }> {
    throw new Error("bun branch: sa/sla runtime removed.");
  }


  async runSlaVm(
    _normalized: NormalizedSaVmRunInput,
    _sourcePath: string,
    _policyPath: string,
    _startedAt: number,
    _env?: NodeJS.ProcessEnv
  ): Promise<SaVmRunResult> {
    throw new Error("bun branch: sa/sla runtime removed.");
  }


  private applySlimPolicy(result: SaVmRunResult, slimPolicy?: SaVmContextSavingsConfig): SaVmRunResult {
    if (!result.ok || slimPolicy?.slimRunnerOutput !== true) return result;
    const lines = result.stdout.split("\n");
    const summaryLines = lines.filter((l) => /pass|fail|error|warning|✓|✗|ok\b/i.test(l));
    if (summaryLines.length > 0) {
      return { ...result, stdout: `[slim] ${summaryLines.slice(-3).join(" | ")}\n[OPT-3] Full output suppressed by slimRunnerOutput (${lines.length} lines).` };
    } else if (lines.length > 10) {
      return { ...result, stdout: `[slim] Exit 0. ${lines.length} lines of output.\n[OPT-3] Full output suppressed by slimRunnerOutput.` };
    }
    return result;
  }
}
