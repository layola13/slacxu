import { describe, expect, test } from "bun:test";
import { probeLocalCodexCliUpdate, probeSshCodexCliUpdate } from "../../apps/server/src/codexCliUpdate";

describe("Codex CLI update capability detection", () => {
  test("detects either the local CLI or the embedded app-server runtime", async () => {
    const result = await probeLocalCodexCliUpdate();
    expect(result.scope).toBe("local");
    expect(result.version).toMatch(/codex-(?:cli|app-server)\s+\d+/);
    expect(result.updateSupported).toBe(result.version.startsWith("codex-cli"));
  });

  test("detects remote Linux CLI version without updating it", async () => {
    let result;
    try { result = await probeSshCodexCliUpdate("ssh -o ConnectTimeout=8 -o ConnectionAttempts=1 vscode@45.129.8.163"); }
    catch (error) {
      if (/timed out|connection|killed|unreachable/i.test(error instanceof Error ? error.message : String(error))) return;
      throw error;
    }
    expect(result.scope).toBe("ssh");
    expect(result.path).toContain("codex");
    expect(result.version).toMatch(/codex-cli\s+\d+/);
    expect(result.updateSupported).toBe(true);
  }, 15000);
});
