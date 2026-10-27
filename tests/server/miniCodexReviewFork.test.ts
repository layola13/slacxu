import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  buildReviewPrompt,
  parseReviewTarget,
  reviewTargetLabel,
} from "../../mini-codex/src/review.ts";
import {
  defaultThreadFile,
  forkThreadFile,
  loadThreadFile,
  runPrompt,
} from "../../mini-codex/src/loop.ts";

describe("mini-codex review target grammar (server parity)", () => {
  test("empty and keyword forms map to uncommittedChanges", () => {
    expect(parseReviewTarget("")).toEqual({ type: "uncommittedChanges" });
    expect(parseReviewTarget("changes")).toEqual({ type: "uncommittedChanges" });
    expect(parseReviewTarget("uncommitted")).toEqual({ type: "uncommittedChanges" });
    expect(parseReviewTarget({})).toEqual({ type: "uncommittedChanges" });
    expect(parseReviewTarget({ type: "changes" })).toEqual({ type: "uncommittedChanges" });
  });

  test("branch and commit forms", () => {
    expect(parseReviewTarget("branch main")).toEqual({ type: "baseBranch", branch: "main" });
    expect(parseReviewTarget("base release/1")).toEqual({ type: "baseBranch", branch: "release/1" });
    expect(parseReviewTarget("commit abc1234")).toEqual({ type: "commit", sha: "abc1234", title: null });
    expect(parseReviewTarget("commit abc1234 fix login")).toEqual({
      type: "commit",
      sha: "abc1234",
      title: "fix login",
    });
    expect(parseReviewTarget({ type: "commit", sha: "deadbee" })).toEqual({
      type: "commit",
      sha: "deadbee",
      title: null,
    });
  });

  test("anything else is a custom brief", () => {
    expect(parseReviewTarget("focus on auth")).toEqual({ type: "custom", instructions: "focus on auth" });
  });

  test("labels match the server wording", () => {
    expect(reviewTargetLabel({ type: "uncommittedChanges" })).toBe("uncommitted changes");
    expect(reviewTargetLabel({ type: "baseBranch", branch: "main" })).toBe("changes against 'main'");
    expect(reviewTargetLabel({ type: "commit", sha: "abc1234", title: null })).toBe("commit abc1234");
    expect(reviewTargetLabel({ type: "custom", instructions: "x" })).toBe("x");
  });

  test("prompt carries the read-only rubric and the target", () => {
    const prompt = buildReviewPrompt({ type: "uncommittedChanges" });
    expect(prompt).toContain("do NOT implement anything");
    expect(prompt).toContain("git_status");
    const commit = buildReviewPrompt({ type: "commit", sha: "abc1234", title: null });
    expect(commit).toContain("abc1234");
  });
});

describe("mini-codex transcript files", () => {
  test("defaultThreadFile lives next to the workspace", () => {
    expect(defaultThreadFile("/tmp/ws")).toBe(join("/tmp/ws", ".mini-codex-thread.jsonl"));
  });

  test("loadThreadFile round-trips and skips corrupt lines", () => {
    const dir = mkdtempSync(join(tmpdir(), "mini-cli-thread-"));
    try {
      const file = join(dir, ".mini-codex-thread.jsonl");
      writeFileSync(
        file,
        ['{"type":"user","text":"hi"}', "not-json{{{", "", '{"type":"message","text":"yo"}'].join("\n"),
        "utf8",
      );
      const items = loadThreadFile(file);
      expect(items?.length).toBe(2);
      expect(loadThreadFile(join(dir, "missing.jsonl"))).toBeNull();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("forkThreadFile copies and truncates to the last N user turns", () => {
    const dir = mkdtempSync(join(tmpdir(), "mini-cli-fork-"));
    try {
      const file = join(dir, ".mini-codex-thread.jsonl");
      const items = [
        { type: "user", text: "first" },
        { type: "message", text: "r1" },
        { type: "user", text: "second" },
        { type: "message", text: "r2" },
      ];
      writeFileSync(file, items.map((t) => JSON.stringify(t)).join("\n"), "utf8");

      const full = forkThreadFile(file);
      expect(full.items).toBe(4);
      expect(full.turns).toBe(2);
      const loaded = loadThreadFile(full.file);
      expect(loaded?.length).toBe(4);

      const one = forkThreadFile(file, 1);
      expect(one.turns).toBe(1);
      const oneLoaded = loadThreadFile(one.file);
      expect(oneLoaded?.length).toBe(2);
      expect((oneLoaded?.[0] as { text: string }).text).toBe("second");

      expect(() => forkThreadFile(join(dir, "nope.jsonl"))).toThrow("no transcript");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("runPrompt /fork is a pure file op (no relay, no tools)", async () => {
    const prevMcp = process.env.MINI_MCP;
    process.env.MINI_MCP = "off";
    const dir = mkdtempSync(join(tmpdir(), "mini-cli-fork-run-"));
    try {
      writeFileSync(
        join(dir, ".mini-codex-thread.jsonl"),
        [{ type: "user", text: "a" }, { type: "message", text: "b" }]
          .map((t) => JSON.stringify(t))
          .join("\n"),
        "utf8",
      );
      const exec = () => {
        throw new Error("must not run tools for /fork");
      };
      const out = await runPrompt(
        { baseUrl: "http://127.0.0.1:9/v1", apiKey: "x", model: "m", cwd: dir },
        "/fork 1",
        exec as never,
      );
      expect(out).toContain("forked 2 items (1 user turns) into");
      expect(out).toContain("--resume");
    } finally {
      if (prevMcp === undefined) delete process.env.MINI_MCP;
      else process.env.MINI_MCP = prevMcp;
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
