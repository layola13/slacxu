import type { JsonValue } from "@codex-ui/shared";

export type MiniCapabilityKind = "browser" | "desktop" | "plugin" | "connector";

export interface MiniCapabilityContext {
  threadId: string;
  turnId: string;
  cwd: string;
  ownerId?: string;
  kind: MiniCapabilityKind;
}

export interface MiniCapability {
  name: string;
  description: string;
  schema: Record<string, unknown>;
  kind: MiniCapabilityKind;
  readOnly?: boolean;
  invoke: (args: Record<string, unknown>, context: MiniCapabilityContext) => Promise<JsonValue | string>;
}

export type MiniCapabilityResolver = (context: Omit<MiniCapabilityContext, "kind">) =>
  Promise<MiniCapability[] | undefined> | MiniCapability[] | undefined;

const CAPABILITY_NAME = /^(?:browser|desktop|plugin|connector)\.[a-z0-9][a-z0-9_.-]{0,95}$/;

export function normalizeMiniCapabilities(capabilities: MiniCapability[] | undefined): MiniCapability[] {
  if (!capabilities?.length) return [];
  const seen = new Set<string>();
  const result: MiniCapability[] = [];
  for (const capability of capabilities) {
    if (!capability || !CAPABILITY_NAME.test(capability.name) || seen.has(capability.name)) continue;
    if (!capability.description.trim() || !capability.schema || typeof capability.invoke !== "function") continue;
    seen.add(capability.name);
    result.push(capability);
  }
  return result;
}

export function miniCapabilityTool(capability: MiniCapability): { name: string; description: string; schema: Record<string, unknown> } {
  return { name: capability.name, description: capability.description, schema: capability.schema };
}

export function miniCapabilityKind(name: string): MiniCapabilityKind | undefined {
  const prefix = name.split(".")[0];
  return prefix === "browser" || prefix === "desktop" || prefix === "plugin" || prefix === "connector" ? prefix : undefined;
}
