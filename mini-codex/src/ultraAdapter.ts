import type { UltraToolExecutor } from "./loop.ts";

export function formatSaVmResult(v: unknown): string {
  if (typeof v === "string") return v.slice(0, 8000);
  try { return JSON.stringify(v).slice(0, 8000); } catch { return String(v).slice(0, 8000); }
}

export async function createUltraExecutor(): Promise<UltraToolExecutor> {
  const mod = await import("../../apps/server/src/saVmTool.ts");
  return async (toolName, args, cwd) => {
    if (toolName === "sa_vm") {
      const { action, ...rest } = args;
      // Canonicalize through the shared expander (no-action sniffing,
      // parallel-string coercion) so alias tolerance matches the server path.
      // Fall back to raw input on expander errors so runSaVmTool still
      // converts them into error results instead of executor throws.
      const base = { action: String(action ?? ""), ...rest };
      let expanded: Record<string, unknown> = base;
      try {
        expanded = mod.expandSaVmActionInput(base) as Record<string, unknown>;
      } catch {
        expanded = base;
      }
      const r = await mod.runSaVmTool({ ...expanded, cwd } as never, { cwd } as never);
      return formatSaVmResult(r);
    }
    throw new Error(`unknown tool for ultra executor: ${toolName}`);
  };
}
