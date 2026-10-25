import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { EventEmitter } from "node:events";
import { stripModelContextVariant, type JsonRpcRequest, type JsonValue } from "@codex-ui/shared";
import { AgyCompatibleProcessManager, type AgyProcessConfig } from "./agyCompatibleProcessManager.js";
import {
  createAgyProjectorContext,
  projectAgyEvent,
  toAgyNotification,
  forceTerminateAgy,
  parseAskQuestionData,
  type AgyProjectorContext,
  type AgyProjectedQuestion,
} from "./agyCompatibleTurnProjector.js";
import type { AgyEvent } from "./agyCompatibleProtocol.js";
import {
  createAgyLineCapture,
  dumpAgyCapture,
  shouldDumpAgyCapture,
  type AgyLineCapture,
} from "./agyRawCapture.js";

export function getAgyTranscriptPath(conversationId: string): string {
  const baseDir = process.env.AGY_BRAIN_DIR ||
    (process.env.GEMINI_DIR ? join(process.env.GEMINI_DIR, "brain") : undefined) ||
    join(homedir(), ".gemini", "antigravity-cli", "brain");
  return join(baseDir, conversationId, ".system_generated", "logs", "transcript.jsonl");
}

export interface PendingAgyQuestion {
  id: string;
  turnId: string;
  threadId: string;
  questions: AgyProjectedQuestion[];
  timer?: ReturnType<typeof setTimeout>;
  createdAt: number;
}

export function extractUserInputAnswer(result?: JsonValue): string {
  if (!result || typeof result !== "object") return "";
  const record = result as Record<string, any>;
  if (record.answers && typeof record.answers === "object") {
    const selected: string[] = [];
    for (const qId of Object.keys(record.answers)) {
      const entry = record.answers[qId];
      if (Array.isArray(entry?.answers)) {
        for (const a of entry.answers) {
          const str = String(a).trim();
          if (str.startsWith("user_note:")) {
            selected.push(str.replace(/^user_note:\s*/, ""));
          } else if (str) {
            selected.push(str);
          }
        }
      }
    }
    if (selected.length > 0) return selected.join(", ");
  }
  if (typeof record.decision === "string") return record.decision;
  if (typeof record.response === "string") return record.response;
  return "";
}

export interface AgyRuntimeConfig {
  threadId: string;
  cwd: string;
  addDirs?: string[];
  conversationId?: string;
  model?: string;
  effort?: string;
  mode?: "accept-edits" | "plan";
  dangerouslySkipPermissions?: boolean;
  providerId?: string;
  groupId?: string;
  envOverrides?: Record<string, string>;
}

export class AgyCompatibleRuntime extends EventEmitter {
  private process: AgyCompatibleProcessManager | null = null;
  private ctx: AgyProjectorContext | null = null;
  private config: AgyRuntimeConfig;
  private pendingQuestion: PendingAgyQuestion | null = null;
  private emittedQuestionIds = new Set<string>();
  private turnWatchdog?: ReturnType<typeof setTimeout>;
  private printTimeoutGrace?: ReturnType<typeof setTimeout>;
  private watchedTurnId: string | null = null;

  constructor(config: AgyRuntimeConfig) {
    super();
    this.config = config;
  }

  setEnvOverrides(env: Record<string, string>): void {
    this.config.envOverrides = env;
  }

  updateConfig(updates: Partial<AgyRuntimeConfig>): void {
    Object.assign(this.config, updates);
  }

  get threadId(): string {
    return this.config.threadId;
  }

  get conversationId(): string | undefined {
    return this.ctx?.conversationId ?? this.config.conversationId;
  }

  hasPendingQuestion(id: string): boolean {
    return Boolean(this.pendingQuestion && this.pendingQuestion.id === id);
  }

  getPendingQuestion(): PendingAgyQuestion | null {
    return this.pendingQuestion;
  }

  private clearTurnWatchdog(): void {
    if (this.turnWatchdog) {
      clearTimeout(this.turnWatchdog);
      this.turnWatchdog = undefined;
    }
    if (this.printTimeoutGrace) {
      clearTimeout(this.printTimeoutGrace);
      this.printTimeoutGrace = undefined;
    }
    this.watchedTurnId = null;
  }

  private resolveTurnTimeoutMs(): number {
    const raw = Number(process.env.AGY_TURN_TIMEOUT_MS);
    if (Number.isFinite(raw) && raw > 0) return Math.floor(raw);
    return 8 * 60_000;
  }

  private resolvePrintTimeoutGraceMs(): number {
    const raw = Number(process.env.AGY_PRINT_TIMEOUT_GRACE_MS);
    if (Number.isFinite(raw) && raw > 0) return Math.floor(raw);
    return 60_000;
  }

  private armTurnWatchdog(turnId: string, turnCtx: AgyProjectorContext): void {
    this.clearTurnWatchdog();
    this.watchedTurnId = turnId;
    const timeoutMs = this.resolveTurnTimeoutMs();
    this.turnWatchdog = setTimeout(() => {
      if (this.watchedTurnId !== turnId || !this.ctx || this.ctx !== turnCtx) return;
      if (turnCtx.status !== "running") return;
      console.warn(`[agyRuntime] turn watchdog fired after ${timeoutMs}ms without terminal event (thread=${this.config.threadId} turn=${turnId}); force-terminating`);
      const fallback = forceTerminateAgy(turnCtx, "failed", `AGY turn timed out after ${Math.round(timeoutMs / 1000)}s without terminal event; process killed, please retry or interrupt`);
      for (const p of fallback) {
        const notif = toAgyNotification(p);
        if (notif) this.emit("notification", notif);
      }
      try {
        this.process?.stop();
      } catch {}
      this.clearTurnWatchdog();
      if (this.ctx === turnCtx) {
        this.ctx = null;
      }
      if (this.process === null) {
        // process exit handler will clean up; nothing else to do
      }
    }, timeoutMs);
    if (this.turnWatchdog.unref) {
      try { this.turnWatchdog.unref(); } catch {}
    }
  }

  private handlePrintTimeoutStderr(text: string, turnCtx: AgyProjectorContext, turnId: string): void {
    if (!/print timeout after/i.test(text) || !/turn in progress/i.test(text)) return;
    if (turnCtx.status !== "running") return;
    if (this.printTimeoutGrace) return;
    const graceMs = this.resolvePrintTimeoutGraceMs();
    console.warn(`[agyRuntime] detected agy print timeout for thread=${this.config.threadId} turn=${turnId}; allowing ${graceMs}ms grace for partial output/exit before force-terminating`);
    this.printTimeoutGrace = setTimeout(() => {
      this.printTimeoutGrace = undefined;
      if (this.watchedTurnId !== turnId || !this.ctx || this.ctx !== turnCtx) return;
      if (turnCtx.status !== "running") return;
      if (!this.process?.isRunning) return;
      console.warn(`[agyRuntime] agy print-timeout grace expired (thread=${this.config.threadId} turn=${turnId}); force-terminating stuck turn`);
      const fallback = forceTerminateAgy(turnCtx, "failed", "AGY reported print timeout with turn in progress and did not exit; process killed, partial output kept, please retry");
      for (const p of fallback) {
        const notif = toAgyNotification(p);
        if (notif) this.emit("notification", notif);
      }
      try {
        this.process?.stop();
      } catch {}
      this.clearTurnWatchdog();
      if (this.ctx === turnCtx) {
        this.ctx = null;
      }
    }, graceMs);
    if (this.printTimeoutGrace.unref) {
      try { this.printTimeoutGrace.unref(); } catch {}
    }
  }

  resolvePendingQuestion(requestId: string, result?: JsonValue, error?: unknown): void {
    if (!this.pendingQuestion || this.pendingQuestion.id !== requestId) return;
    const pending = this.pendingQuestion;
    if (pending.timer) clearTimeout(pending.timer);
    this.pendingQuestion = null;
    if (this.ctx) {
      this.ctx.awaitingQuestion = false;
      this.ctx.pendingQuestionId = undefined;
    }

    if (error) {
      console.log(`[agyRuntime] question rejected/cancelled (id=${requestId}):`, error instanceof Error ? error.message : String(error));
      return;
    }

    const rawAnswer = extractUserInputAnswer(result);
    const answerText = rawAnswer || "(用户跳过提问，请按推荐/默认选项继续，不要重复提问)";

    this.emit("questionAnswered", {
      threadId: this.config.threadId,
      turnId: pending.turnId,
      answerText,
    });
  }

  private emitQuestionRequest(questionId: string, turnId: string, questions: AgyProjectedQuestion[]): void {
    if (this.pendingQuestion?.timer) {
      clearTimeout(this.pendingQuestion.timer);
    }
    this.emittedQuestionIds.add(questionId);
    if (this.ctx) {
      this.ctx.pendingQuestionId = questionId;
      this.ctx.awaitingQuestion = true;
    }
    const timeoutMs = Number(process.env.AGY_QUESTION_TIMEOUT_MS) || 120_000;
    const timer = setTimeout(() => {
      if (this.pendingQuestion?.id === questionId) {
        console.warn(`[agyRuntime] question timed out after ${timeoutMs}ms (questionId=${questionId})`);
        this.resolvePendingQuestion(questionId, undefined, new Error("Question response timed out"));
      }
    }, timeoutMs);

    this.pendingQuestion = {
      id: questionId,
      turnId,
      threadId: this.config.threadId,
      questions,
      timer,
      createdAt: Date.now(),
    };

    const serverReq: JsonRpcRequest = {
      id: questionId,
      method: "item/tool/requestUserInput",
      params: {
        itemId: questionId,
        threadId: this.config.threadId,
        turnId,
        questions: questions as unknown as JsonValue[],
      } as Record<string, JsonValue>,
    };
    this.emit("serverRequest", serverReq);
  }

  private scanTranscriptForQuestions(turnId: string): void {
    const convId = this.conversationId;
    if (!convId) return;
    const transcriptPath = getAgyTranscriptPath(convId);
    if (!existsSync(transcriptPath)) return;
    try {
      const content = readFileSync(transcriptPath, "utf8");
      const lines = content.trim().split("\n");
      for (let i = lines.length - 1; i >= 0 && i >= lines.length - 15; i--) {
        const line = lines[i]?.trim();
        if (!line || !line.startsWith("{")) continue;
        try {
          const step = JSON.parse(line);
          if (Array.isArray(step.tool_calls)) {
            for (const tc of step.tool_calls) {
              if (tc.name === "ask_question") {
                const stepIdx = typeof step.step_index === "number" ? step.step_index : i;
                const questionId = `agy-ask-${convId}-${stepIdx}`;
                if (!this.emittedQuestionIds.has(questionId)) {
                  const rawQ = tc.args?.questions ?? tc.input?.questions;
                  const headerFallback = step.toolAction ?? step.toolSummary ?? tc.toolAction ?? tc.toolSummary;
                  const qList = parseAskQuestionData(rawQ, stepIdx, typeof headerFallback === "string" ? headerFallback : undefined);
                  if (qList.length > 0) {
                    this.emitQuestionRequest(questionId, turnId, qList);
                    return;
                  }
                }
              }
            }
          }
        } catch {}
      }
    } catch {}
  }

  async executeTurn(prompt: string, turnId: string): Promise<void> {
    if (this.process && this.process.isRunning) {
      this.process.stop();
      await this.process.waitForExit(3000);
    }
    this.clearTurnWatchdog();

    const turnCtx = createAgyProjectorContext(this.config.threadId, turnId);
    turnCtx.hasStartedTurn = true;
    if (this.config.conversationId) {
      turnCtx.conversationId = this.config.conversationId;
    }
    this.ctx = turnCtx;
    this.armTurnWatchdog(turnId, turnCtx);

    const effectiveProviderId = this.config.providerId || "agy-official";
    const gatewayUrl = this.config.envOverrides?.AGY_LLM_GATEWAY_URL;
    if (effectiveProviderId !== "agy-official") {
      if (!this.config.envOverrides?.CLOUD_CODE_URL && !gatewayUrl) {
        this.clearTurnWatchdog();
        this.ctx = null;
        throw new Error("AGY relay selected but CLOUD_CODE_URL is missing");
      }
    }

    const isRelayProxy = Boolean(
      effectiveProviderId !== "agy-official" &&
      this.config.envOverrides?.CLOUD_CODE_URL
    );
    const effortSuffix = (this.config.effort === "high" || this.config.effort === "medium")
      ? this.config.effort
      : "low";
    // Gateway mode: agy validates --model against the gateway's /models
    // discovery, so pass the relay's real model (context variant stripped),
    // never an agy-official Gemini id. Without a configured model, omit
    // --model entirely and let the gateway default apply.
    const cliModel = gatewayUrl
      ? (this.config.model
        ? (stripModelContextVariant(this.config.model).baseModel || this.config.model)
        : undefined)
      : isRelayProxy ? `gemini-3.8-flash-${effortSuffix}` : this.config.model;

    const procConfig: AgyProcessConfig = {
      cwd: this.config.cwd,
      addDirs: this.config.addDirs,
      conversationId: this.config.conversationId,
      model: cliModel,
      effort: this.config.effort,
      mode: this.config.mode,
      dangerouslySkipPermissions: this.config.dangerouslySkipPermissions !== false,
      envOverrides: this.config.envOverrides,
    };

    const proc = new AgyCompatibleProcessManager(procConfig);
    this.process = proc;

    const rawCapture: AgyLineCapture = createAgyLineCapture();
    let captureDumped = false;
    const maybeDumpCapture = (): void => {
      if (captureDumped || !shouldDumpAgyCapture()) return;
      captureDumped = true;
      void dumpAgyCapture(this.config.threadId, turnId, rawCapture.lines()).then((file) => {
        if (file) console.log(`[agyRuntime] raw capture dumped (thread=${this.config.threadId} turn=${turnId}): ${file}`);
      });
    };

    proc.on("rawLine", (line: string) => {
      rawCapture.push(line);
      this.scanTranscriptForQuestions(turnId);
    });

    proc.on("event", (event: AgyEvent) => {
      const projected = projectAgyEvent(event, turnCtx);
      for (const p of projected) {
        if (p.kind === "system/init") {
          this.config.conversationId = p.conversationId;
          this.emit("conversationId", p.conversationId);
        }
        if (p.kind === "question/asked") {
          this.emitQuestionRequest(p.questionId, p.turnId, p.questions);
        }
        const notif = toAgyNotification(p);
        if (notif) {
          this.emit("notification", notif);
        }
      }
      this.scanTranscriptForQuestions(turnId);
      if (turnCtx.status !== "running") {
        this.clearTurnWatchdog();
        maybeDumpCapture();
      }
    });

    proc.on("stderr", (text: string) => {
      console.error(`[agyRuntime] stderr (thread=${this.config.threadId}):`, text);
      this.handlePrintTimeoutStderr(text, turnCtx, turnId);
    });

    proc.on("exit", ({ code, signal, stopping, stderrTail }: { code: number | null; signal: string | null; stopping: boolean; stderrTail?: string }) => {
      this.clearTurnWatchdog();
      if (code !== 0 && !stopping) {
        console.warn(`[agyRuntime] process exited with code=${code} signal=${signal} (thread=${this.config.threadId})`);
      }
      if (turnCtx.status === "running") {
        const stderrDetail = typeof stderrTail === "string" ? stderrTail.trim().slice(-2000) : "";
        const detail = !stopping && code !== 0
          ? (stderrDetail ? `Process exited (code=${code ?? "unknown"})${signal ? ` signal=${signal}` : ""}: ${stderrDetail}` : `Process exited (code=${code ?? "unknown"})${signal ? ` signal=${signal}` : ""}`)
          : undefined;
        const fallback = forceTerminateAgy(turnCtx, stopping ? "interrupted" : "failed", detail);
        for (const p of fallback) {
          const notif = toAgyNotification(p);
          if (notif) this.emit("notification", notif);
        }
        maybeDumpCapture();
      }
      if (this.process === proc) {
        this.process = null;
      }
      if (this.ctx === turnCtx) {
        this.ctx = null;
      }
    });

    proc.on("error", (err) => {
      this.clearTurnWatchdog();
      if (turnCtx.status === "running") {
        const detail = err instanceof Error ? err.message : String(err);
        const fallback = forceTerminateAgy(turnCtx, "failed", detail ? `Process error: ${detail}` : undefined);
        for (const p of fallback) {
          const notif = toAgyNotification(p);
          if (notif) this.emit("notification", notif);
        }
        maybeDumpCapture();
      }
      this.emit("error", err);
    });

    proc.start();
    proc.writePrompt(prompt);
  }

  interrupt(): void {
    this.clearTurnWatchdog();
    if (this.pendingQuestion) {
      if (this.pendingQuestion.timer) clearTimeout(this.pendingQuestion.timer);
      this.pendingQuestion = null;
    }
    if (this.ctx && this.ctx.status === "running") {
      const fallback = forceTerminateAgy(this.ctx, "interrupted");
      for (const p of fallback) {
        const notif = toAgyNotification(p);
        if (notif) this.emit("notification", notif);
      }
    }
    if (this.process) {
      this.process.stop();
    }
  }
}
