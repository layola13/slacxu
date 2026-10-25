/**
 * `/review` support for the opencode backend (mini parity).
 *
 * Mini implements review with VM-enforced read-only tools (`sa_vm ...`); the
 * opencode backend has no such hard sandbox, so the constraint here is
 * prompt-level only: review with the native `read` / `grep` / `glob` tools
 * plus `bash` for `git status` / `git diff`, and never write, edit, or
 * commit. Callers must not present this as hard-enforced read-only.
 */

export type OpencodeReviewTarget =
  | { type: "uncommittedChanges" }
  | { type: "baseBranch"; branch: string }
  | { type: "commit"; sha: string; title?: string | null }
  | { type: "custom"; instructions: string };

export const OPENCODE_REVIEW_SLASH_RE = /^\s*\/review\b([\s\S]*)$/;

const REVIEW_RUBRIC = [
  "You are acting as a code reviewer for a proposed change made by another engineer. Review the change, do NOT implement anything.",
  "Rules: read-only review - use the read tool to read files, grep/glob to search, and bash ONLY for `git status` and `git diff` (never run any other command, never write, edit, or commit files, never work around this via scripts or temp files).",
  "Flag an issue only when it meaningfully impacts accuracy, performance, security, or maintainability; it is discrete and actionable; it was introduced by this change (never flag pre-existing issues); and it does not rely on unstated assumptions - cite the affected code as evidence, no speculation.",
  "Each finding gets one comment: severity, file:line, why it is a bug, and the scenario needed to trigger it. Keep each finding to one short paragraph, matter-of-fact tone.",
  "Use ```suggestion blocks ONLY for concrete minimal replacement code, preserving exact leading whitespace.",
  "Output: one scope line, then prioritized findings. If nothing meets the bar, say so plainly instead of inventing findings.",
].join("\n");

export function parseOpencodeReviewTarget(value: unknown): OpencodeReviewTarget {
  if (value && typeof value === "object") {
    const rec = value as Record<string, unknown>;
    const kind = String(rec.type ?? rec.kind ?? "").trim().toLowerCase();
    if (kind === "uncommittedchanges" || kind === "uncommitted" || kind === "changes" || kind === "") {
      return { type: "uncommittedChanges" };
    }
    if (kind === "basebranch" || kind === "branch" || kind === "base") {
      const branch = String(rec.branch ?? "").trim();
      if (branch) return { type: "baseBranch", branch };
      return { type: "uncommittedChanges" };
    }
    if (kind === "commit") {
      const sha = String(rec.sha ?? "").trim();
      if (sha) {
        const title = rec.title == null ? null : String(rec.title).trim() || null;
        return { type: "commit", sha, title };
      }
      return { type: "uncommittedChanges" };
    }
    const instructions = String(rec.instructions ?? rec.value ?? rec.text ?? rec.prompt ?? "").trim();
    if (instructions) return { type: "custom", instructions };
    return { type: "uncommittedChanges" };
  }
  const rest = String(value ?? "").trim();
  const normalized = rest.toLowerCase();
  if (!rest || ["changes", "uncommitted", "uncommitted changes"].includes(normalized)) {
    return { type: "uncommittedChanges" };
  }
  const branch = /^(?:branch|base|base-branch)\s+(.+)$/i.exec(rest);
  if (branch?.[1]?.trim()) return { type: "baseBranch", branch: branch[1].trim() };
  const commit = /^commit\s+([0-9a-fA-F]{6,64})(?:\s+(.+))?$/i.exec(rest);
  if (commit?.[1]) return { type: "commit", sha: commit[1], title: commit[2]?.trim() || null };
  return { type: "custom", instructions: rest };
}

export function buildOpencodeReviewPrompt(target: OpencodeReviewTarget): string {
  let targetPrompt: string;
  switch (target.type) {
    case "baseBranch":
      targetPrompt = `Review the code changes against the base branch '${target.branch}'. Use bash 'git diff' for the range and the read tool for file context. Provide prioritized, actionable findings.`;
      break;
    case "commit":
      targetPrompt = target.title
        ? `Review the code changes introduced by commit ${target.sha} ("${target.title}"). Use bash 'git diff' (stat overview first, then full diff) and the read tool for file context. Provide prioritized, actionable findings.`
        : `Review the code changes introduced by commit ${target.sha}. Use bash 'git diff' (stat overview first, then full diff) and the read tool for file context. Provide prioritized, actionable findings.`;
      break;
    case "custom":
      targetPrompt = target.instructions;
      break;
    default:
      targetPrompt = "Review the current uncommitted changes (staged, unstaged, and untracked files). Start with bash `git status`, then bash `git diff`, and read untracked files with the read tool. Provide prioritized, actionable findings.";
      break;
  }
  return `${REVIEW_RUBRIC}\n\n${targetPrompt}`;
}

/** Re-encode a target as `/review ...` text so `review/start` can delegate to `turn/start`. */
export function formatOpencodeReviewSlash(target: OpencodeReviewTarget): string {
  switch (target.type) {
    case "baseBranch":
      return `/review branch ${target.branch}`;
    case "commit":
      return target.title ? `/review commit ${target.sha} ${target.title}` : `/review commit ${target.sha}`;
    case "custom":
      return `/review ${target.instructions}`;
    default:
      return "/review";
  }
}
