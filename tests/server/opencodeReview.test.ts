import { describe, expect, test } from "bun:test";
import {
  OPENCODE_REVIEW_SLASH_RE,
  buildOpencodeReviewPrompt,
  formatOpencodeReviewSlash,
  parseOpencodeReviewTarget,
} from "../../backends/opencode/src/runtime/opencodeReview.js";

describe("opencode /review (mini parity)", () => {
  test("slash regex captures the target text", () => {
    expect(OPENCODE_REVIEW_SLASH_RE.exec("/review")?.[1]).toBe("");
    expect(OPENCODE_REVIEW_SLASH_RE.exec("  /review branch main")?.[1]?.trim()).toBe("branch main");
    expect(OPENCODE_REVIEW_SLASH_RE.exec("/reviewer x")).toBeNull();
    expect(OPENCODE_REVIEW_SLASH_RE.exec("please /review")).toBeNull();
  });

  test("parseOpencodeReviewTarget mirrors mini grammar", () => {
    expect(parseOpencodeReviewTarget("")).toEqual({ type: "uncommittedChanges" });
    expect(parseOpencodeReviewTarget("uncommitted")).toEqual({ type: "uncommittedChanges" });
    expect(parseOpencodeReviewTarget("branch main")).toEqual({ type: "baseBranch", branch: "main" });
    expect(parseOpencodeReviewTarget("base main")).toEqual({ type: "baseBranch", branch: "main" });
    expect(parseOpencodeReviewTarget("commit abc1234")).toEqual({ type: "commit", sha: "abc1234", title: null });
    expect(parseOpencodeReviewTarget("commit abc1234 Fix bug")).toEqual({ type: "commit", sha: "abc1234", title: "Fix bug" });
    expect(parseOpencodeReviewTarget("focus on auth")).toEqual({ type: "custom", instructions: "focus on auth" });
    expect(parseOpencodeReviewTarget({ type: "branch", branch: "dev" })).toEqual({ type: "baseBranch", branch: "dev" });
    expect(parseOpencodeReviewTarget({ type: "commit", sha: "abc1234", title: "T" })).toEqual({ type: "commit", sha: "abc1234", title: "T" });
  });

  test("review prompt is read-only and uses opencode-native tools", () => {
    const prompt = buildOpencodeReviewPrompt({ type: "uncommittedChanges" });
    expect(prompt).toContain("do NOT implement anything");
    expect(prompt).toContain("never write, edit, or commit files");
    expect(prompt).toContain("git status");
    expect(prompt).toContain("git diff");
    expect(prompt).not.toContain("sa_vm");
  });

  test("review prompt renders branch/commit targets", () => {
    expect(buildOpencodeReviewPrompt({ type: "baseBranch", branch: "main" })).toContain("'main'");
    const commit = buildOpencodeReviewPrompt({ type: "commit", sha: "abc1234", title: "Fix" });
    expect(commit).toContain("abc1234");
    expect(commit).toContain("Fix");
  });

  test("formatOpencodeReviewSlash round-trips through the parser", () => {
    const targets = [
      { type: "uncommittedChanges" },
      { type: "baseBranch", branch: "main" },
      { type: "commit", sha: "abc1234", title: "Fix bug" },
      { type: "commit", sha: "abc1234", title: null },
      { type: "custom", instructions: "focus on auth" },
    ] as const;
    for (const target of targets) {
      const slash = formatOpencodeReviewSlash(target as never);
      const rest = OPENCODE_REVIEW_SLASH_RE.exec(slash)?.[1] ?? "";
      expect(parseOpencodeReviewTarget(rest)).toEqual(target);
    }
  });
});
