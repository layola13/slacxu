import { expect, test, describe } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { countActiveEnhanceTools, ENHANCE_TOOLS_KEYS, setAllEnhanceTools } from "@codex-ui/shared";

describe("Composer Enhance Tools UI & Decoupling", () => {
  const composerSource = readFileSync(join(import.meta.dir, "../../apps/web/src/composer/Composer.tsx"), "utf8");
  const dialogSource = readFileSync(join(import.meta.dir, "../../frontends/enhance/src/enhance/EnhanceToolsDialog.tsx"), "utf8");
  const appSource = readFileSync(join(import.meta.dir, "../../apps/web/src/App.tsx"), "utf8")
    + readFileSync(join(import.meta.dir, "../../apps/web/src/app/workbench/useComposerPipeline.ts"), "utf8")
    + readFileSync(join(import.meta.dir, "../../apps/web/src/app/workbench/useComposerThreadStart.ts"), "utf8")
    + readFileSync(join(import.meta.dir, "../../apps/web/src/app/workbench/useComposerSend.ts"), "utf8");

  test("Composer renders enhance tools button alongside VM tools button", () => {
    // Both VM tools and Enhance tools buttons exist in Composer
    expect(composerSource).toContain('data-testid="composer-vm-button"');
    expect(composerSource).toContain('data-testid="composer-enhance-button"');
    expect(composerSource).toContain("<EnhanceToolsDialog");
  });

  test("EnhanceToolsDialog supports all enhance tools grouped logically into 7 categories", () => {
    expect(dialogSource).toContain('data-testid="composer-enhance-dialog"');
    expect(dialogSource).toContain('data-testid="composer-enhance-toggle-all"');
    expect(dialogSource).toContain("setAllEnhanceTools(prev, checked)");

    // All enhance tool keys must be referenced (length follows ENHANCE_TOOLS_KEYS)
    for (const key of ENHANCE_TOOLS_KEYS) {
      expect(dialogSource).toContain(key);
    }

    // 7 major functional categories
    expect(dialogSource).toContain("防爆流大文件读取与日志追踪");
    expect(dialogSource).toContain("极速检索与全局浏览");
    expect(dialogSource).toContain("精准代码编辑与批量补丁");
    expect(dialogSource).toContain("AST 语义与智能重构");
    expect(dialogSource).toContain("代码诊断与智能编辑");
    expect(dialogSource).toContain("高效探索与上下文优化");
    expect(dialogSource).toContain('t("jev.enhance.sectionTitle")');
    expect(dialogSource).toContain('testId="composer-enhance-toggle-jev-choose"');
    expect(dialogSource).toContain('testId="composer-enhance-toggle-jev-checklist"');
    expect(dialogSource).toContain('testId="composer-enhance-toggle-jev-evaluate"');
    expect(dialogSource).toContain('testId="composer-enhance-toggle-jev-thinking"');
    expect(dialogSource).toContain('testId="composer-enhance-toggle-jev-redteam"');
    expect(dialogSource).toContain('testId="composer-enhance-toggle-jev-rank"');
    expect(dialogSource).toContain('testId="composer-enhance-toggle-jev-scope"');
    expect(dialogSource).toContain('testId="composer-enhance-toggle-jev-dispatch"');
    expect(dialogSource).toContain('testId="composer-enhance-toggle-jev-consistency"');
    expect(dialogSource).toContain('testId="composer-enhance-toggle-jev-done"');
    expect(dialogSource).toContain('testId="composer-enhance-toggle-jev-diagnose"');
    expect(dialogSource).toContain('testId="composer-enhance-toggle-jev-edge-cases"');
    expect(dialogSource).toContain('testId="composer-enhance-toggle-jev-blast-radius"');
    expect(dialogSource).toContain('testId="composer-enhance-toggle-jev-compress"');
    expect(dialogSource).toContain('testId="composer-enhance-toggle-jev-memory"');
    // 无 KEY 前置提示（JEV 面板凭据是硬依赖）
    expect(dialogSource).toContain("jevKeyConfigured");
    expect(dialogSource).toContain('data-testid="composer-enhance-jev-key-hint"');
    expect(dialogSource).toContain('t("jev.enhance.keyHint")');
  });

  test("toggle all follows the shared tool list without changing sandbox settings", () => {
    const initial = { replaceExec: true, jevMemory: false, readFiles: true };
    const enabled = setAllEnhanceTools(initial, true);
    expect(countActiveEnhanceTools(enabled)).toBe(ENHANCE_TOOLS_KEYS.length);
    expect(ENHANCE_TOOLS_KEYS.every((key) => enabled[key] === true)).toBe(true);
    expect(enabled.replaceExec).toBe(true);
    expect(initial.jevMemory).toBe(false);

    const disabled = setAllEnhanceTools(enabled, false);
    expect(countActiveEnhanceTools(disabled)).toBe(0);
    expect(ENHANCE_TOOLS_KEYS.every((key) => disabled[key] === false)).toBe(true);
    expect(disabled.replaceExec).toBe(true);
  });

  test("App.tsx decouples enhance instructions from VM sandbox restrictions", () => {
    expect(appSource).toContain("enhanceDynamicToolSpec");
    expect(appSource).toContain("enhanceDeveloperInstructions");

    // Dynamic tools spec preserves sa_vm_run without sending unsupported turn fields
    expect(appSource.match(/startParams\.dynamicTools = \[saVmDynamicToolSpec\([^)]*\)\]/g)).toHaveLength(2);
    expect(appSource).not.toContain("turnParams.dynamicTools");

    // Enhance instructions are injected on turn/start when enhance tools are active
    expect(appSource).toContain("enhanceDeveloperInstructions(threadSelection.vmPolicy)");
  });
});
