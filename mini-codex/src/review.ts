// Mirrors apps/server/src/miniBridge.ts (parseMiniReviewTarget /
// miniReviewTargetLabel / buildMiniReviewPrompt + MINI_REVIEW_RUBRIC).
// mini-codex is a zero-dependency standalone CLI: small logic is duplicated
// here on purpose instead of importing the server. Keep the two in sync.

export type ReviewTarget =
  | { type: "uncommittedChanges" }
  | { type: "baseBranch"; branch: string }
  | { type: "commit"; sha: string; title?: string | null }
  | { type: "custom"; instructions: string };

export function parseReviewTarget(value: unknown): ReviewTarget {
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

export function reviewTargetLabel(target: ReviewTarget): string {
  switch (target.type) {
    case "baseBranch":
      return `changes against '${target.branch}'`;
    case "commit": {
      const short = target.sha.slice(0, 7);
      return target.title ? `commit ${short}: ${target.title}` : `commit ${short}`;
    }
    case "custom":
      return target.instructions.slice(0, 120);
    default:
      return "uncommitted changes";
  }
}

const REVIEW_RUBRIC = [
  "You are acting as a code reviewer for a proposed change made by another engineer. Review the change, do NOT implement anything.",
  "Rules: read-only review - use sa_vm read/list/grep plus native git_status/git_diff and image_view for local images only; never write, edit, commit files, never bypass via python -c / bun -e / temp scripts / .git internals.",
  "Flag an issue only when it meaningfully impacts accuracy, performance, security, or maintainability; it is discrete and actionable; it was introduced by this change (never flag pre-existing issues); and it does not rely on unstated assumptions - cite the affected code as evidence, no speculation.",
  "Each finding gets one comment: severity, file:line, why it is a bug, and the scenario needed to trigger it. Keep each finding to one short paragraph, matter-of-fact tone.",
  "Use ```suggestion blocks ONLY for concrete minimal replacement code, preserving exact leading whitespace.",
  "Output: one scope line, then prioritized findings. If nothing meets the bar, say so plainly instead of inventing findings.",
].join("\n");

export function buildReviewPrompt(target: ReviewTarget): string {
  let targetPrompt: string;
  switch (target.type) {
    case "baseBranch":
      targetPrompt = `Review the code changes against the base branch '${target.branch}'. Use sa_vm git_diff for the uncommitted range (prefer the native git_diff action). Provide prioritized, actionable findings.`;
      break;
    case "commit":
      targetPrompt = target.title
        ? `Review the code changes introduced by commit ${target.sha} ("${target.title}"). Use sa_vm git_diff with stat_only for the overview, then git_diff for the full diff. Provide prioritized, actionable findings.`
        : `Review the code changes introduced by commit ${target.sha}. Use sa_vm git_diff with stat_only for the overview, then git_diff for the full diff. Provide prioritized, actionable findings.`;
      break;
    case "custom":
      targetPrompt = target.instructions;
      break;
    default:
      targetPrompt =
        "Review the current uncommitted changes (staged, unstaged, and untracked files). Start with sa_vm git_status, then sa_vm git_diff (native read-only git actions - prefer them over run_host for status/diff), and read untracked files with sa_vm read_file. Provide prioritized, actionable findings.";
      break;
  }
  return `${REVIEW_RUBRIC}\n\n${targetPrompt}`;
}

/** Extra system hint for review runs (mirrors the server: review is a normal turn, prompt carries the read-only contract). */
export const REVIEW_SYSTEM_SUFFIX =
  "This is a READ-ONLY code review run: inspect with sa_vm read/list/grep/git_status/git_diff and image_view only. Never write, edit, or execute workspace code to 'fix' findings - report them.";
