import type { CliBackend } from "@codex-ui/shared";
import { cliPluginId } from "./cliPlugins";
import type { CliPluginBackend } from "./useCliBackendPlugins";

export interface CliBackendUsage {
  inUse: boolean;
  threadCount: number;
  runningCount: number;
}

export interface CliBackendUsageInput {
  selections: Record<string, { cliBackend?: CliBackend | string | null } | null | undefined>;
  threads: ReadonlyArray<{ id: string; cliBackend?: CliBackend | string | null }>;
  runningThreadIds: ReadonlySet<string>;
}

const NEW_CONVERSATION_KEY = "__new__";

export function resolveUsageBackend(value: unknown): CliPluginBackend | "mini" | null {
  if (value == null || value === "") return null;
  const id = cliPluginId(value as CliBackend);
  if (id === "mini") return "mini";
  if (id === "codex" || id === "claude" || id === "agy" || id === "grok" || id === "muse" || id === "pi" || id === "opencode" || id === "opencode-v2") return id;
  return null;
}

export function describeCliBackendUsage(backend: CliPluginBackend, input: CliBackendUsageInput): CliBackendUsage {
  const users = new Set<string>();
  for (const [id, selection] of Object.entries(input.selections ?? {})) {
    if (id === NEW_CONVERSATION_KEY || !selection) continue;
    if (resolveUsageBackend(selection.cliBackend) === backend) users.add(id);
  }
  for (const thread of input.threads ?? []) {
    if (!thread?.id) continue;
    if (resolveUsageBackend(thread.cliBackend) === backend) users.add(thread.id);
  }
  const backendOf = (id: string): CliPluginBackend | "mini" | null =>
    resolveUsageBackend(input.selections?.[id]?.cliBackend) ??
    resolveUsageBackend(input.threads?.find((entry) => entry.id === id)?.cliBackend);
  let running = 0;
  for (const id of input.runningThreadIds ?? []) {
    if (backendOf(id) === backend) running += 1;
  }
  return { inUse: users.size > 0 || running > 0, threadCount: users.size, runningCount: running };
}
