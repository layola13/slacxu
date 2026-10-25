import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AGENTS_MD_MAX_BYTES, findAgentsMdFiles, loadAgentsMd } from "../src/agentsMd.ts";

describe("findAgentsMdFiles", () => {
  test("finds nested scopes root-first, ignores missing", () => {
    const dir = mkdtempSync(join(tmpdir(), "mini-agents-"));
    const sub = join(dir, "a", "b");
    mkdirSync(sub, { recursive: true });
    writeFileSync(join(dir, "AGENTS.md"), "root rules");
    writeFileSync(join(sub, "AGENTS.md"), "leaf rules");
    const found = findAgentsMdFiles(sub, 4);
    expect(found).toEqual([join(dir, "AGENTS.md"), join(sub, "AGENTS.md")]);
  });
  test("empty dir -> []", () => {
    expect(findAgentsMdFiles(mkdtempSync(join(tmpdir(), "mini-agents-empty-")), 1)).toEqual([]);
  });
});

describe("loadAgentsMd", () => {
  test("concatenates scopes, nearest last (highest precedence)", () => {
    const dir = mkdtempSync(join(tmpdir(), "mini-agents-"));
    const sub = join(dir, "pkg");
    mkdirSync(sub, { recursive: true });
    writeFileSync(join(dir, "AGENTS.md"), "root rules");
    writeFileSync(join(sub, "AGENTS.md"), "leaf rules");
    const out = loadAgentsMd(sub, AGENTS_MD_MAX_BYTES, 4);
    expect(out).toContain("root rules");
    expect(out).toContain("leaf rules");
    expect(out!.indexOf("root rules")).toBeLessThan(out!.indexOf("leaf rules"));
  });
  test("no AGENTS.md -> null", () => {
    expect(loadAgentsMd(mkdtempSync(join(tmpdir(), "mini-agents-none-")), AGENTS_MD_MAX_BYTES, 1)).toBeNull();
  });
  test("total output capped", () => {
    const dir = mkdtempSync(join(tmpdir(), "mini-agents-"));
    writeFileSync(join(dir, "AGENTS.md"), `x\n${"y".repeat(AGENTS_MD_MAX_BYTES + 100)}`);
    const out = loadAgentsMd(dir)!;
    expect(out.length).toBeLessThanOrEqual(AGENTS_MD_MAX_BYTES + 64);
    expect(out).toContain("truncated");
  });
});
