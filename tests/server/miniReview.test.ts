import { describe, expect, test } from "bun:test";
import {
  buildMiniReviewPrompt,
  miniReviewTargetLabel,
  parseMiniReviewTarget,
} from "../../backends/mini/src/runtime/miniBridge.ts";

describe("mini review target parsing", () => {
  test("empty and uncommitted spellings map to uncommittedChanges", () => {
    expect(parseMiniReviewTarget(undefined)).toEqual({ type: "uncommittedChanges" });
    expect(parseMiniReviewTarget("")).toEqual({ type: "uncommittedChanges" });
    expect(parseMiniReviewTarget("changes")).toEqual({ type: "uncommittedChanges" });
    expect(parseMiniReviewTarget({ type: "uncommittedChanges" })).toEqual({ type: "uncommittedChanges" });
  });

  test("parses baseBranch from object and text", () => {
    expect(parseMiniReviewTarget({ type: "baseBranch", branch: "main" })).toEqual({ type: "baseBranch", branch: "main" });
    expect(parseMiniReviewTarget("branch main")).toEqual({ type: "baseBranch", branch: "main" });
    expect(parseMiniReviewTarget("base main")).toEqual({ type: "baseBranch", branch: "main" });
  });

  test("parses commit with optional title", () => {
    expect(parseMiniReviewTarget({ type: "commit", sha: "abc1234", title: "Polish" })).toEqual({
      type: "commit",
      sha: "abc1234",
      title: "Polish",
    });
    expect(parseMiniReviewTarget("commit abc1234 Polish")).toEqual({ type: "commit", sha: "abc1234", title: "Polish" });
    expect(parseMiniReviewTarget("commit abc1234")).toEqual({ type: "commit", sha: "abc1234", title: null });
  });

  test("falls back to custom instructions", () => {
    expect(parseMiniReviewTarget("check the auth flow for races")).toEqual({
      type: "custom",
      instructions: "check the auth flow for races",
    });
    expect(parseMiniReviewTarget({ type: "custom", instructions: "  review login  " })).toEqual({
      type: "custom",
      instructions: "review login",
    });
  });
});

describe("mini review prompt", () => {
  test("uncommitted prompt starts from git status and stays read-only", () => {
    const prompt = buildMiniReviewPrompt({ type: "uncommittedChanges" });
    expect(prompt).toContain("sa_vm git_status");
    expect(prompt).toContain("sa_vm git_diff");
    expect(prompt).toContain("read-only");
    expect(prompt).toContain("do NOT implement");
  });

  test("baseBranch prompt names the branch and uses git_diff", () => {
    const prompt = buildMiniReviewPrompt({ type: "baseBranch", branch: "main" });
    expect(prompt).toContain("main");
    expect(prompt).toContain("sa_vm git_diff");
  });

  test("commit prompt shows the change first", () => {
    const prompt = buildMiniReviewPrompt({ type: "commit", sha: "abc1234", title: null });
    expect(prompt).toContain("abc1234");
    expect(prompt).toContain("sa_vm git_diff with stat_only");
  });

  test("custom prompt keeps caller instructions", () => {
    const prompt = buildMiniReviewPrompt({ type: "custom", instructions: "focus on auth races" });
    expect(prompt).toContain("focus on auth races");
  });

  test("labels match codex wording", () => {
    expect(miniReviewTargetLabel({ type: "uncommittedChanges" })).toBe("uncommitted changes");
    expect(miniReviewTargetLabel({ type: "baseBranch", branch: "main" })).toBe("changes against 'main'");
    expect(miniReviewTargetLabel({ type: "commit", sha: "abc1234567", title: "Polish" })).toBe("commit abc1234: Polish");
  });
});
