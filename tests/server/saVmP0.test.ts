import { describe, expect, test, beforeAll, afterAll } from "bun:test";
import { mkdtemp, rm, writeFile, mkdir } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";
import { nativeRepoMap, nativeVerifyLoop, runSaVmTool } from "../../apps/server/src/saVmTool.js";
import { createDefaultSaVmPolicyConfig } from "@codex-ui/shared";

describe("P0 repo_map + verify_loop", () => {
  let tempDir: string;

  beforeAll(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "codex-test-p0-"));
    const srcDir = join(tempDir, "src");
    await mkdir(srcDir, { recursive: true });
    await writeFile(join(srcDir, "a.ts"), "import { b } from './b';\nexport function hello(): string { return b; }\n", "utf8");
    await writeFile(join(srcDir, "b.ts"), "export const b: string = 'hi';\n", "utf8");
    await writeFile(join(srcDir, "broken.ts"), "export function oops( { \n", "utf8");
  });

  afterAll(async () => {
    await rm(tempDir, { recursive: true, force: true }).catch(() => {});
  });

  test("nativeRepoMap returns entries with symbols + depends_on", async () => {
    const policy = createDefaultSaVmPolicyConfig();
    policy.tools = { ...policy.tools, fileOutline: true };
    const res = await nativeRepoMap("src", { max_files: 20, max_tokens: 8000 }, policy, tempDir, Date.now());
    expect(res.ok).toBe(true);
    const parsed = JSON.parse(res.stdout);
    expect(parsed.action).toBe("repo_map");
    expect(parsed.files).toBeGreaterThanOrEqual(2);
    expect(Array.isArray(parsed.entries)).toBe(true);
    const aFile = parsed.entries.find((e: any) => String(e.file).endsWith("a.ts"));
    expect(aFile).toBeDefined();
    expect(aFile.symbols.length).toBeGreaterThan(0);
    expect(aFile.depends_on.join(" ")).toContain("./b");
  });

  test("nativeVerifyLoop reports syntax fail with file/line info", async () => {
    const policy = createDefaultSaVmPolicyConfig();
    policy.tools = { ...policy.tools, getDiagnostics: true };
    const res = await nativeVerifyLoop("src", { max_files: 20, max_errors: 10 }, policy, tempDir, Date.now());
    expect(res.ok).toBe(true);
    const parsed = JSON.parse(res.stdout);
    expect(parsed.action).toBe("verify_loop");
    expect(parsed.typecheck).toBe("fail");
    expect(parsed.error_count).toBeGreaterThanOrEqual(1);
    expect(parsed.errors[0].file).toContain("broken.ts");
  });

  test("dispatches repo_map + verify_loop through runSaVmTool", async () => {
    const policy = createDefaultSaVmPolicyConfig();
    policy.tools = { ...policy.tools, fileOutline: true, getDiagnostics: true };
    const mapRes = await runSaVmTool({ action: "repo_map", dir: "src" } as any, policy, tempDir);
    expect(mapRes.ok).toBe(true);
    expect(JSON.parse(mapRes.stdout).action).toBe("repo_map");
    const verifyRes = await runSaVmTool({ action: "verify_loop", dir: "src" } as any, policy, tempDir);
    expect(verifyRes.ok).toBe(true);
    expect(JSON.parse(verifyRes.stdout).action).toBe("verify_loop");
  });

  test("policy gates deny when tools disabled", async () => {
    const policy = createDefaultSaVmPolicyConfig();
    policy.tools = { ...policy.tools, fileOutline: false, getDiagnostics: false };
    const mapRes = await runSaVmTool({ action: "repo_map", dir: "src" } as any, policy, tempDir);
    expect(mapRes.ok).toBe(false);
    expect(mapRes.kind).toBe("capability_denied");
    const verifyRes = await runSaVmTool({ action: "verify_loop", dir: "src" } as any, policy, tempDir);
    expect(verifyRes.ok).toBe(false);
    expect(verifyRes.kind).toBe("capability_denied");
  });

  test("save_note, read_notes, delete_note lifecycle and max limit", async () => {
    const policy = createDefaultSaVmPolicyConfig();
    // 1. save note
    const saveRes = await runSaVmTool({
      action: "save_note",
      key: "port_rule",
      content: "Isolated port is 43121, never stop 43120."
    } as any, policy, tempDir);
    expect(saveRes.ok).toBe(true);
    const saveJson = JSON.parse(saveRes.stdout);
    expect(saveJson.action).toBe("save_note");
    expect(saveJson.key).toBe("port_rule");

    // 2. read note single key
    const readSingle = await runSaVmTool({
      action: "read_notes",
      key: "port_rule"
    } as any, policy, tempDir);
    expect(readSingle.ok).toBe(true);
    const singleJson = JSON.parse(readSingle.stdout);
    expect(singleJson.found).toBe(true);
    expect(singleJson.note.content).toContain("43121");

    // 3. read notes list all
    const readAll = await runSaVmTool({
      action: "read_notes"
    } as any, policy, tempDir);
    expect(readAll.ok).toBe(true);
    const allJson = JSON.parse(readAll.stdout);
    expect(allJson.total_notes).toBeGreaterThanOrEqual(1);
    expect(allJson.notes.some((n: any) => n.key === "port_rule")).toBe(true);

    // 4. delete note
    const delRes = await runSaVmTool({
      action: "delete_note",
      key: "port_rule"
    } as any, policy, tempDir);
    expect(delRes.ok).toBe(true);
    const delJson = JSON.parse(delRes.stdout);
    expect(delJson.deleted).toBe(true);

    // 5. verify deleted
    const readAfterDel = await runSaVmTool({
      action: "read_notes",
      key: "port_rule"
    } as any, policy, tempDir);
    expect(JSON.parse(readAfterDel.stdout).found).toBe(false);

    // 6. test truncation at 1000 chars and clear_notes / all: true
    const longContent = "A".repeat(1500);
    const saveLong = await runSaVmTool({
      action: "add_note",
      key: "long_note",
      content: longContent
    } as any, policy, tempDir);
    expect(saveLong.ok).toBe(true);
    expect(JSON.parse(saveLong.stdout).truncated).toBe(true);
    const readLong = await runSaVmTool({
      action: "read_note",
      key: "long_note"
    } as any, policy, tempDir);
    expect(JSON.parse(readLong.stdout).note.content.length).toBe(1000);

    // 7. test priority levels (low, normal, important, critical) and sorting
    await runSaVmTool({
      action: "save_note",
      key: "normal_item",
      content: "This is normal priority",
      level: "normal"
    } as any, policy, tempDir);
    await runSaVmTool({
      action: "save_note",
      key: "critical_item",
      content: "This is critical priority",
      level: "critical"
    } as any, policy, tempDir);
    await runSaVmTool({
      action: "save_note",
      key: "low_item",
      content: "This is low priority",
      level: "low"
    } as any, policy, tempDir);

    const readSorted = await runSaVmTool({
      action: "read_notes"
    } as any, policy, tempDir);
    const sortedNotes = JSON.parse(readSorted.stdout).notes;
    // Critical must be first, low must be last
    expect(sortedNotes[0].key).toBe("critical_item");
    expect(sortedNotes[0].level).toBe("critical");
    expect(sortedNotes[sortedNotes.length - 1].key).toBe("low_item");

    // 8. test remaining_tokens dynamic budget reduction
    const readWithTokens = await runSaVmTool({
      action: "read_notes",
      remaining_tokens: 1250
    } as any, policy, tempDir);
    expect(readWithTokens.ok).toBe(true);

    // 9. clear all notes
    const clearRes = await runSaVmTool({
      action: "clear_notes"
    } as any, policy, tempDir);
    expect(clearRes.ok).toBe(true);
    const readCleared = await runSaVmTool({
      action: "list_notes"
    } as any, policy, tempDir);
    expect(JSON.parse(readCleared.stdout).total_notes).toBe(0);
  });

  test("add_memory, edit_memory, read_memory, delete_memory lifecycle", async () => {
    const policy = createDefaultSaVmPolicyConfig();

    // 1. add_memory with memory parameter alias
    const addRes = await runSaVmTool({
      action: "add_memory",
      key: "arch_guideline",
      memory: "All UI components must be modular and decoupled from App.tsx.",
      level: "important"
    } as any, policy, tempDir);
    expect(addRes.ok).toBe(true);
    const addJson = JSON.parse(addRes.stdout);
    expect(addJson.action).toBe("add_memory");
    expect(addJson.key).toBe("arch_guideline");
    expect(addJson.total_memories).toBeGreaterThanOrEqual(1);
    expect(addJson.message).toContain("memory");

    // 2. read_memory by key
    const readSingle = await runSaVmTool({
      action: "read_memory",
      key: "arch_guideline"
    } as any, policy, tempDir);
    expect(readSingle.ok).toBe(true);
    const singleJson = JSON.parse(readSingle.stdout);
    expect(singleJson.action).toBe("read_memory");
    expect(singleJson.found).toBe(true);
    expect(singleJson.memory.content).toContain("modular and decoupled");

    // 3. edit_memory (in-place update)
    const editRes = await runSaVmTool({
      action: "edit_memory",
      key: "arch_guideline",
      memory: "All UI components must be modular and decoupled from App.tsx. Strictly enforced.",
      level: "critical"
    } as any, policy, tempDir);
    expect(editRes.ok).toBe(true);
    const editJson = JSON.parse(editRes.stdout);
    expect(editJson.action).toBe("edit_memory");

    const readUpdated = await runSaVmTool({
      action: "read_memory",
      key: "arch_guideline"
    } as any, policy, tempDir);
    expect(JSON.parse(readUpdated.stdout).memory.content).toContain("Strictly enforced");
    expect(JSON.parse(readUpdated.stdout).memory.level).toBe("critical");

    // 4. search_memory fuzzy substring
    const searchRes = await runSaVmTool({
      action: "search_memory",
      key: "decoupled"
    } as any, policy, tempDir);
    expect(searchRes.ok).toBe(true);
    const searchJson = JSON.parse(searchRes.stdout);
    expect(searchJson.matches.length).toBeGreaterThanOrEqual(1);
    expect(searchJson.matches[0].key).toBe("arch_guideline");

    // 5. list all memories
    const listRes = await runSaVmTool({
      action: "read_memory"
    } as any, policy, tempDir);
    expect(listRes.ok).toBe(true);
    const listJson = JSON.parse(listRes.stdout);
    expect(Array.isArray(listJson.memories)).toBe(true);
    expect(listJson.memories.some((m: any) => m.key === "arch_guideline")).toBe(true);

    // 6. delete_memory by key
    const delRes = await runSaVmTool({
      action: "delete_memory",
      key: "arch_guideline"
    } as any, policy, tempDir);
    expect(delRes.ok).toBe(true);
    const delJson = JSON.parse(delRes.stdout);
    expect(delJson.action).toBe("delete_memory");
    expect(delJson.deleted).toBe(true);

    // 7. verify deleted
    const readAfterDel = await runSaVmTool({
      action: "read_memory",
      key: "arch_guideline"
    } as any, policy, tempDir);
    expect(JSON.parse(readAfterDel.stdout).found).toBe(false);

    // 8. clear_memory (all: true)
    await runSaVmTool({ action: "add_memory", key: "temp_m1", content: "temp 1" } as any, policy, tempDir);
    await runSaVmTool({ action: "add_memory", key: "temp_m2", content: "temp 2" } as any, policy, tempDir);
    const clearRes = await runSaVmTool({ action: "clear_memory" } as any, policy, tempDir);
    expect(clearRes.ok).toBe(true);
    const afterClear = await runSaVmTool({ action: "read_memory" } as any, policy, tempDir);
    expect(JSON.parse(afterClear.stdout).total_memories).toBe(0);
  });
});
