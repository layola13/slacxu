import { useCallback, useRef, useState } from "react";
import type { JsonRpcNotification } from "@codex-ui/shared";
import type { GoalBannerState, GoalStatus } from "../../components/ChatPanel";
import type { CodexSocketClient, WorkbenchTurn } from "../../state/codexClient";
import { buildGoalContinuationPrompt } from "../../goalContinuation";
import { latestActionableRunningTurn } from "../transcripts/topicRuntimeIndex";
import { markGoalResumeHandled, resetGoalResumeDecision, shouldPromptGoalResume } from "./goalResumeDecision";
import { buildLocalGoal, parseGoal } from "./goalState";

export interface GoalResumePrompt {
  threadId: string;
  goal: GoalBannerState;
}

export interface GoalLifecycle {
  goals: Record<string, GoalBannerState>;
  resumePrompt: GoalResumePrompt | null;
  resumeSubmitting: boolean;
  handleNotification(notification: JsonRpcNotification): void;
  loadThreadGoal(threadId: string): Promise<GoalBannerState | null>;
  freezeActiveGoalBeforeResume(threadId: string): Promise<GoalBannerState | null>;
  promptResume(threadId: string, goal: GoalBannerState): void;
  resetResume(): void;
  setGoal(threadId: string, objective: string, tokenBudget?: number | null): Promise<boolean>;
  setGoalStatus(status: GoalStatus, threadId?: string): Promise<boolean>;
  confirmResume(): Promise<void>;
  pauseResume(): Promise<void>;
  cancelActiveGoal(): Promise<void>;
  clearActiveGoal(): Promise<void>;
  discardThreadGoal(threadId: string): void;
}

export function useGoalLifecycle(input: {
  client: CodexSocketClient;
  activeThreadId: string | null;
  getTurns(): WorkbenchTurn[];
  startContinuation(prompt: string, onTurnStarted: (threadId: string, turnId: string) => void): Promise<string | null>;
  reportError(message: string): void;
}): GoalLifecycle {
  const [goals, setGoals] = useState<Record<string, GoalBannerState>>({});
  const [resumePrompt, setResumePrompt] = useState<GoalResumePrompt | null>(null);
  const [resumeSubmitting, setResumeSubmitting] = useState(false);
  const goalsRef = useRef(goals);
  const resumePromptRef = useRef(resumePrompt);
  const activeThreadIdRef = useRef(input.activeThreadId);
  const getTurnsRef = useRef(input.getTurns);
  const startContinuationRef = useRef(input.startContinuation);
  const reportErrorRef = useRef(input.reportError);
  const resumeEpochRef = useRef(0);
  const resumeInFlightRef = useRef(new Set<string>());
  const interruptedTurnIdsRef = useRef(new Set<string>());
  const mutationEpochsRef = useRef(new Map<string, number>());
  const resumeHandledThreadIdsRef = useRef(new Set<string>());
  const freezeInFlightRef = useRef(new Map<string, Promise<GoalBannerState | null>>());

  goalsRef.current = goals;
  resumePromptRef.current = resumePrompt;
  activeThreadIdRef.current = input.activeThreadId;
  getTurnsRef.current = input.getTurns;
  startContinuationRef.current = input.startContinuation;
  reportErrorRef.current = input.reportError;

  const commitGoal = useCallback((threadId: string, goal: GoalBannerState | null) => {
    const next = { ...goalsRef.current };
    if (goal) next[threadId] = goal;
    else delete next[threadId];
    goalsRef.current = next;
    setGoals(next);
  }, []);

  const handleNotification = useCallback((notification: JsonRpcNotification) => {
    const params = record(notification.params);
    if (notification.method === "thread/goal/updated") {
      const goal = parseGoal(record(params.goal));
      if (goal) {
        if (goal.status === "paused" && goalsRef.current[goal.threadId]?.status !== "paused") {
          resetGoalResumeDecision(resumeHandledThreadIdsRef.current, goal.threadId);
        }
        commitGoal(goal.threadId, goal);
      }
      return;
    }
    if (notification.method === "thread/goal/cleared") {
      const threadId = text(params.threadId);
      if (threadId) commitGoal(threadId, null);
    }
  }, [commitGoal]);

  const loadThreadGoal = useCallback(async (threadId: string) => {
    try {
      const result = await input.client.rpc("thread/goal/get", { threadId });
      const goal = parseGoal(record(record(result).goal));
      commitGoal(threadId, goal);
      return goal;
    } catch {
      // Older app-server builds may not expose goal reads.
      return goalsRef.current[threadId] ?? null;
    }
  }, [commitGoal, input.client]);

  const setGoalStatus = useCallback(async (status: GoalStatus, requestedThreadId?: string): Promise<boolean> => {
    const threadId = requestedThreadId ?? activeThreadIdRef.current;
    if (!threadId) {
      reportErrorRef.current("Select or start a conversation before changing goal status");
      return false;
    }
    const existing = goalsRef.current[threadId];
    if (!existing) {
      reportErrorRef.current("No goal is active for this conversation");
      return false;
    }
    if (status === "paused") resetGoalResumeDecision(resumeHandledThreadIdsRef.current, threadId);
    const mutationEpoch = (mutationEpochsRef.current.get(threadId) ?? 0) + 1;
    mutationEpochsRef.current.set(threadId, mutationEpoch);
    commitGoal(threadId, buildLocalGoal(threadId, existing.objective, status, existing));
    try {
      const result = await input.client.rpc("thread/goal/set", { threadId, status });
      if (mutationEpochsRef.current.get(threadId) !== mutationEpoch) return true;
      commitGoal(threadId, parseGoal(record(record(result).goal)) ?? buildLocalGoal(threadId, existing.objective, status, existing));
      if (status === "active") markGoalResumeHandled(resumeHandledThreadIdsRef.current, threadId);
      return true;
    } catch (error) {
      if (mutationEpochsRef.current.get(threadId) === mutationEpoch) commitGoal(threadId, existing);
      reportErrorRef.current(`Goal status: ${errorText(error)}`);
      return false;
    }
  }, [commitGoal, input.client]);

  const freezeActiveGoalBeforeResume = useCallback(async (threadId: string) => {
    const existing = freezeInFlightRef.current.get(threadId);
    if (existing) return existing;
    const pending = (async () => {
      const goal = await loadThreadGoal(threadId);
      if (!goal || goal.status !== "active") return goal;
      if (!shouldPromptGoalResume(resumeHandledThreadIdsRef.current, threadId)) return null;
      const paused = await setGoalStatus("paused", threadId);
      return paused ? goalsRef.current[threadId] ?? buildLocalGoal(threadId, goal.objective, "paused", goal) : goal;
    })();
    freezeInFlightRef.current.set(threadId, pending);
    void pending.then(
      () => {
        if (freezeInFlightRef.current.get(threadId) === pending) freezeInFlightRef.current.delete(threadId);
      },
      () => {
        if (freezeInFlightRef.current.get(threadId) === pending) freezeInFlightRef.current.delete(threadId);
      }
    );
    return pending;
  }, [loadThreadGoal, setGoalStatus]);

  const promptResume = useCallback((threadId: string, goal: GoalBannerState) => {
    if (!shouldPromptGoalResume(resumeHandledThreadIdsRef.current, threadId)) return;
    resumeEpochRef.current += 1;
    const next = { threadId, goal };
    resumePromptRef.current = next;
    setResumeSubmitting(false);
    setResumePrompt(next);
  }, []);

  const resetResume = useCallback(() => {
    resumeEpochRef.current += 1;
    resumePromptRef.current = null;
    setResumeSubmitting(false);
    setResumePrompt(null);
  }, []);

  const setGoal = useCallback(async (threadId: string, objective: string, tokenBudget?: number | null): Promise<boolean> => {
    const normalized = objective.trim();
    const previous = goalsRef.current[threadId] ?? null;
    const optimistic = {
      ...buildLocalGoal(threadId, normalized, "active", previous ?? undefined),
      ...(tokenBudget !== undefined ? { tokenBudget } : {}),
    };
    const mutationEpoch = (mutationEpochsRef.current.get(threadId) ?? 0) + 1;
    mutationEpochsRef.current.set(threadId, mutationEpoch);
    commitGoal(threadId, optimistic);
    try {
      const result = await input.client.rpc("thread/goal/set", {
        threadId,
        objective: normalized,
        status: "active",
        ...(tokenBudget !== undefined ? { tokenBudget } : {}),
      });
      if (mutationEpochsRef.current.get(threadId) === mutationEpoch) {
        commitGoal(threadId, parseGoal(record(record(result).goal)) ?? optimistic);
        markGoalResumeHandled(resumeHandledThreadIdsRef.current, threadId);
      }
      return true;
    } catch (error) {
      if (mutationEpochsRef.current.get(threadId) === mutationEpoch) commitGoal(threadId, previous);
      reportErrorRef.current(`Goal set: ${errorText(error)}`);
      return false;
    }
  }, [commitGoal, input.client]);

  const interruptTurnOnce = useCallback(async (threadId: string, turnId: string) => {
    if (interruptedTurnIdsRef.current.has(turnId)) return;
    interruptedTurnIdsRef.current.add(turnId);
    try {
      await input.client.rpc("turn/interrupt", { threadId, turnId });
    } catch {
      // A paused goal remains authoritative if the turn already completed.
    }
  }, [input.client]);

  const confirmResume = useCallback(async () => {
    const prompt = resumePromptRef.current;
    if (!prompt || resumeInFlightRef.current.has(prompt.threadId)) return;
    const { threadId, goal } = prompt;
    const resumeEpoch = ++resumeEpochRef.current;
    resumeInFlightRef.current.add(threadId);
    setResumeSubmitting(true);
    try {
      if (activeThreadIdRef.current !== threadId) return;
      const startedThreadId = await startContinuationRef.current(
        buildGoalContinuationPrompt(goal.objective),
        (startedThread, turnId) => {
          if (resumeEpoch !== resumeEpochRef.current) void interruptTurnOnce(startedThread, turnId);
        }
      );
      if (resumeEpoch !== resumeEpochRef.current) {
        if (startedThreadId === threadId) {
          const running = latestActionableRunningTurn(getTurnsRef.current(), threadId);
          if (running) await interruptTurnOnce(threadId, running.id);
        }
        return;
      }
      if (startedThreadId !== threadId) return;
      const resumed = await setGoalStatus("active", threadId);
      if (resumed && resumeEpoch === resumeEpochRef.current) {
        markGoalResumeHandled(resumeHandledThreadIdsRef.current, threadId);
        resetResume();
      }
    } finally {
      resumeInFlightRef.current.delete(threadId);
      if (resumePromptRef.current?.threadId === threadId || !resumePromptRef.current) setResumeSubmitting(false);
    }
  }, [interruptTurnOnce, resetResume, setGoalStatus]);

  const pauseResume = useCallback(async () => {
    const prompt = resumePromptRef.current;
    if (!prompt || activeThreadIdRef.current !== prompt.threadId) return;
    const { threadId } = prompt;
    resetResume();
    const running = latestActionableRunningTurn(getTurnsRef.current(), threadId);
    if (running) await interruptTurnOnce(threadId, running.id);
    if (goalsRef.current[threadId]?.status !== "paused") {
      const paused = await setGoalStatus("paused", threadId);
      if (!paused) return;
    }
    markGoalResumeHandled(resumeHandledThreadIdsRef.current, threadId);
  }, [interruptTurnOnce, resetResume, setGoalStatus]);

  const cancelActiveGoal = useCallback(async () => {
    const threadId = activeThreadIdRef.current;
    if (!threadId) return;
    const running = latestActionableRunningTurn(getTurnsRef.current(), threadId);
    if (running) {
      try {
        await input.client.rpc("turn/interrupt", { threadId, turnId: running.id });
      } catch (error) {
        reportErrorRef.current(`Stop goal turn: ${errorText(error)}`);
      }
    }
    await setGoalStatus("paused", threadId);
  }, [input.client, setGoalStatus]);

  const clearActiveGoal = useCallback(async () => {
    const threadId = activeThreadIdRef.current;
    if (!threadId) {
      reportErrorRef.current("Select or start a conversation before clearing a goal");
      return;
    }
    const existing = goalsRef.current[threadId] ?? null;
    resetGoalResumeDecision(resumeHandledThreadIdsRef.current, threadId);
    const mutationEpoch = (mutationEpochsRef.current.get(threadId) ?? 0) + 1;
    mutationEpochsRef.current.set(threadId, mutationEpoch);
    commitGoal(threadId, null);
    try {
      await input.client.rpc("thread/goal/clear", { threadId });
    } catch (error) {
      if (mutationEpochsRef.current.get(threadId) === mutationEpoch) commitGoal(threadId, existing);
      reportErrorRef.current(`Goal clear: ${errorText(error)}`);
    }
  }, [commitGoal, input.client]);

  const discardThreadGoal = useCallback((threadId: string) => {
    mutationEpochsRef.current.set(threadId, (mutationEpochsRef.current.get(threadId) ?? 0) + 1);
    resetGoalResumeDecision(resumeHandledThreadIdsRef.current, threadId);
    if (resumePromptRef.current?.threadId === threadId) resetResume();
    commitGoal(threadId, null);
  }, [commitGoal, resetResume]);

  return {
    goals,
    resumePrompt,
    resumeSubmitting,
    handleNotification,
    loadThreadGoal,
    freezeActiveGoalBeforeResume,
    promptResume,
    resetResume,
    setGoal,
    setGoalStatus,
    confirmResume,
    pauseResume,
    cancelActiveGoal,
    clearActiveGoal,
    discardThreadGoal
  };
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function errorText(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  try { return JSON.stringify(error); } catch { return String(error); }
}
