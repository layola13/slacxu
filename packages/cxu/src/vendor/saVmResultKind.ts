export type SaVmRunResult = {
  ok: boolean;
  kind: "success" | "sa_error" | "capability_denied" | "fuel_exhausted" | "timeout" | "mem_quota" | "policy_invalid" | "stack_overflow" | "crashed" | "unavailable";
  exitCode: number | null;
  stdout: string;
  stderr: string;
  saVmEvents: Array<Record<string, unknown>>;
  saVmViolation: Record<string, unknown> | null;
  durationMs: number;
};

export type SaVmRunResultKind =
  | "success"
  |"sa_error"
  |"capability_denied"
  |"fuel_exhausted"
  |"timeout"
  |"mem_quota"
  |"policy_invalid"
  |"stack_overflow"
  |"crashed"
  |"unavailable";

export function resultKind(exitCode: number | null, stderr = ""): SaVmRunResultKind {
  if (exitCode === 228) return "capability_denied";
  if (exitCode === 229) return "fuel_exhausted";
  if (exitCode === 230) return "timeout";
  if (exitCode === 231) return "mem_quota";
  if (exitCode === 233) return "policy_invalid";
  if (exitCode === 235) return "stack_overflow";
  if (exitCode === 1 && stderr.trim()) return "sa_error";
  if (exitCode !== null && exitCode < 128) return "success";
  return "crashed";
}
