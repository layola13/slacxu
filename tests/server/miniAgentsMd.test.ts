import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  buildAgentsMdCompactionNote,
  collectAgentsMdFiles,
  collectExtraRootsAgentsMd,
  extractAgentsMdTouchedPaths,
  findAgentsMdProjectRoot,
  findNestedAgentsMdFiles,
  miniAgentsMdMode,
  renderAgentsMdNestedBlock,
  renderAgentsMdSystemBlock,
  resolveAgentsMdScopes,
} from "../../backends/mini/src/runtime/agentsMdInventory.js";

let dirs: string[] = [];
afterEach(async () => {
  for (const dir of dirs) await rm(dir, { recursive: true, force: true });
  dirs = [];
  delete process.env.MINI_AGENTS_MD;
});

async function makeTree(structure: Record<string, string>): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "agents-md-"));
  dirs.push(root);
  for (const [rel, content] of Object.entries(structure)) {
    const abs = join(root, rel);
    await mkdir(join(abs, ".."), { recursive: true });
    await writeFile(abs, content, "utf8");
  }
  return root;
}

describe("miniAgentsMdMode", () => {
  test("defaults to fallback and parses off/both", () => {
    expect(miniAgentsMdMode()).toBe("fallback");
    process.env.MINI_AGENTS_MD = "off";
    expect(miniAgentsMdMode()).toBe("off");
    process.env.MINI_AGENTS_MD = "both";
    expect(miniAgentsMdMode()).toBe("both");
  });
});

describe("findAgentsMdProjectRoot", () => {
  test("walks up to the nearest .git marker", async () => {
    const root = await makeTree({ ".git": "", "a/b/c.txt": "x" });
    expect(await findAgentsMdProjectRoot(join(root, "a", "b"))).toBe(root);
  });

  test("falls back to cwd without any marker", async () => {
    const root = await makeTree({ "a.txt": "x" });
    expect(await findAgentsMdProjectRoot(root)).toBe(root);
  });
});

describe("collectAgentsMdFiles", () => {
  test("loads root-first down to cwd", async () => {
    const root = await makeTree({
      "AGENTS.md": "root rules",
      "sub/AGENTS.md": "sub rules",
    });
    const files = await collectAgentsMdFiles(root, join(root, "sub"), "fallback");
    expect(files.map((f) => f.content)).toEqual(["root rules", "sub rules"]);
  });

  test("fallback skips a directory claimed by CLAUDE.md, both loads it", async () => {
    const root = await makeTree({
      "AGENTS.md": "root rules",
      "sub/AGENTS.md": "sub rules",
      "sub/CLAUDE.md": "native",
    });
    const fallback = await collectAgentsMdFiles(root, join(root, "sub"), "fallback");
    expect(fallback.map((f) => f.content)).toEqual(["root rules"]);
    const both = await collectAgentsMdFiles(root, join(root, "sub"), "both");
    expect(both.map((f) => f.content)).toEqual(["root rules", "sub rules"]);
  });

  test("dedupes identical content across filenames", async () => {
    const root = await makeTree({
      "AGENTS.md": "same",
      ".claude/AGENTS.md": "same",
    });
    expect((await collectAgentsMdFiles(root, root, "both")).length).toBe(1);
  });

  test("expands @-imports and guards cycles", async () => {
    const root = await makeTree({
      "AGENTS.md": "top\n@parts/extra.md",
      "parts/extra.md": "extra rules",
      "loop.md": "@loop.md",
    });
    const files = await collectAgentsMdFiles(root, root, "fallback");
    expect(files[0]?.content).toContain("extra rules");
    expect(files[0]?.content).toContain("@import parts/extra.md");
  });

  test("missing files resolve to empty", async () => {
    const root = await makeTree({ "a.txt": "x" });
    expect(await collectAgentsMdFiles(root, root, "fallback")).toEqual([]);
  });
});

describe("findNestedAgentsMdFiles", () => {
  test("attaches deepest scope first, once per turn", async () => {
    const root = await makeTree({
      "AGENTS.md": "root",
      "sub/AGENTS.md": "sub",
      "sub/deep/AGENTS.md": "deep",
      "sub/deep/f.txt": "x",
    });
    const delivered = new Set<string>([join(root, "AGENTS.md").toLowerCase()]);
    const found = await findNestedAgentsMdFiles(root, root, ["sub/deep/f.txt"], delivered, "fallback");
    expect(found.map((f) => f.content)).toEqual(["deep", "sub"]);
    // Second touch in the same turn attaches nothing new.
    expect(await findNestedAgentsMdFiles(root, root, ["sub/deep/f.txt"], delivered, "fallback")).toEqual([]);
  });

  test("ignores paths outside the root and the cwd itself", async () => {
    const root = await makeTree({ "sub/AGENTS.md": "sub" });
    const delivered = new Set<string>();
    expect(await findNestedAgentsMdFiles(root, root, ["../outside.txt"], delivered, "fallback")).toEqual([]);
    expect(await findNestedAgentsMdFiles(root, join(root, "sub"), ["f.txt"], delivered, "fallback")).toEqual([]);
  });
});

describe("rendering", () => {
  test("system block frames root-first with relative paths", () => {
    const block = renderAgentsMdSystemBlock([
      { path: "/r/AGENTS.md", scopeDir: "/r", content: "root rules", truncated: false },
      { path: "/r/sub/AGENTS.md", scopeDir: "/r/sub", content: "sub rules", truncated: false },
    ]);
    expect(block.indexOf("root rules")).toBeLessThan(block.indexOf("sub rules"));
    expect(block).toContain("# Project instructions (");
  });

  test("empty collection renders empty", () => {
    expect(renderAgentsMdSystemBlock([])).toBe("");
  });

  test("nested block frames Contents of path", () => {
    const block = renderAgentsMdNestedBlock({ path: "/r/sub/AGENTS.md", scopeDir: "/r/sub", content: "sub", truncated: false });
    expect(block.startsWith("Contents of ")).toBe(true);
    expect(block).toContain("sub");
  });

  test("long files are capped and flagged", async () => {
    const root = await makeTree({ "AGENTS.md": "x".repeat(20_000) });
    const files = await collectAgentsMdFiles(root, root, "fallback");
    expect(files[0]?.truncated).toBe(true);
    expect(files[0]?.content.length).toBe(12_000);
  });
});

describe("extractAgentsMdTouchedPaths", () => {
  test("picks path-like args and skips the rest", () => {
    expect(extractAgentsMdTouchedPaths({ action: "read_file", path: "a/b.md", query: "x" }))
      .toEqual(["a/b.md"]);
    expect(extractAgentsMdTouchedPaths({ action: "grep_search", dir: "src", pattern: "*.ts" }))
      .toEqual(["src"]);
    expect(extractAgentsMdTouchedPaths({ action: "run_bun", subcommand: "test" })).toEqual([]);
  });
});

describe("collectExtraRootsAgentsMd", () => {
  test("collects each extra root's own files and skips junk", async () => {
    const root = await makeTree({
      "AGENTS.md": "main",
      "extra/AGENTS.md": "extra rules",
    });
    const files = await collectExtraRootsAgentsMd(
      [join(root, "extra"), join(root, "missing"), join(root, "AGENTS.md"), ""],
      "fallback",
    );
    expect(files.map((f) => f.content)).toEqual(["extra rules"]);
    expect(await collectExtraRootsAgentsMd(undefined, "fallback")).toEqual([]);
  });

  test("respects fallback claim inside extra roots", async () => {
    const root = await makeTree({
      "extra/AGENTS.md": "extra rules",
      "extra/CLAUDE.md": "native",
    });
    expect(await collectExtraRootsAgentsMd([join(root, "extra")], "fallback")).toEqual([]);
    expect((await collectExtraRootsAgentsMd([join(root, "extra")], "both")).length).toBe(1);
  });
});

describe("resolveAgentsMdScopes", () => {
  test("returns main scope plus valid extra roots, deduped", async () => {
    const root = await makeTree({ "extra/AGENTS.md": "x" });
    const scopes = await resolveAgentsMdScopes(root, root, [join(root, "extra"), root, join(root, "missing")]);
    expect(scopes).toEqual([
      { root, base: root },
      { root: join(root, "extra"), base: join(root, "extra") },
    ]);
  });
});

describe("buildAgentsMdCompactionNote", () => {
  test("empty input renders empty", () => {
    expect(buildAgentsMdCompactionNote(undefined, "/r")).toBe("");
    expect(buildAgentsMdCompactionNote([], "/r")).toBe("");
  });

  test("lists unique relative paths", () => {
    const note = buildAgentsMdCompactionNote(
      ["/r/AGENTS.md", "/r/sub/AGENTS.md", "/r/AGENTS.md"],
      "/r",
    );
    expect(note).toContain("still in effect after compaction");
    expect(note).toContain("- AGENTS.md");
    expect(note).toContain("- sub/AGENTS.md");
  });
});
