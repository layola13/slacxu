import { describe, expect, it } from "bun:test";
import { WINDOWS_POWERSHELL_UTF8_RULE, mergeWorkspaceAgentsContent } from "../../apps/server/src/workspaceAgents";

describe("workspace AGENTS.md rule", () => {
  it("creates the rule for a missing file", () => {
    const result = mergeWorkspaceAgentsContent(null);
    expect(result.created).toBe(true);
    expect(result.updated).toBe(false);
    expect(result.content).toBe(`${WINDOWS_POWERSHELL_UTF8_RULE}\n`);
  });

  it("appends the rule without replacing existing instructions", () => {
    const result = mergeWorkspaceAgentsContent("# Existing rules\n");
    expect(result.created).toBe(false);
    expect(result.updated).toBe(true);
    expect(result.content).toContain("# Existing rules");
    expect(result.content).toContain(WINDOWS_POWERSHELL_UTF8_RULE);
  });

  it("is idempotent when the rule already exists", () => {
    const existing = `${WINDOWS_POWERSHELL_UTF8_RULE}\n`;
    expect(mergeWorkspaceAgentsContent(existing)).toEqual({ content: existing, created: false, updated: false });
  });

  it("sanitizes contaminated Get-Content line from existing AGENTS.md", () => {
    const contaminated = [
      "# Existing rules",
      "在 Windows PowerShell 环境中处理包含中文的文件时，必须显式使用 UTF-8 编码。",
      "读取文本文件优先使用：Get-Content -Encoding UTF8",
      "不要用未指定编码的 Get-Content / Set-Content / Out-File 处理中文、Markdown、TOML、JSON 等文本文件"
    ].join("\n");
    const result = mergeWorkspaceAgentsContent(contaminated);
    expect(result.updated).toBe(true);
    expect(result.content).not.toContain("读取文本文件优先使用：Get-Content -Encoding UTF8");
    expect(result.content).not.toContain("Get-Content");
    expect(result.content).toContain("不要用未指定编码的 Set-Content / Out-File");
  });
});
