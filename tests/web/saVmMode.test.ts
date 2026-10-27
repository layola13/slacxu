import { expect, test } from "bun:test";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { createDefaultSaVmPolicyConfig } from "@codex-ui/shared";
import { parseThreadRuntimeSelections } from "../../apps/web/src/app/runtime/useThreadRuntimeSelections";
import { buildSaVmWorkspaceSkillMarkdown } from "../../apps/server/src/saVmWorkspaceSkill";


function readTree(dir) {
  if (!existsSync(dir)) return "";
  return readdirSync(dir, { withFileTypes: true })
    .flatMap((entry) => {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) return [readTree(path)];
      return entry.name.endsWith(".ts") || entry.name.endsWith(".tsx") ? [readFileSync(path, "utf8")] : [];
    })
    .join("\n");
}
function assembledAppSource(rootDir) {
  return [
    readFileSync(join(rootDir, "apps/web/src/App.tsx"), "utf8"),
    readTree(join(rootDir, "apps/web/src/shell")),
    readTree(join(rootDir, "apps/web/src/components/dialogs")),
    readTree(join(rootDir, "apps/web/src/app/workbench")),
    readTree(join(rootDir, "frontends/free-mode/src/free")),
  ].join("\n");
}
const appSource = assembledAppSource(join(import.meta.dir, "../.."));
const composerSource = readFileSync(join(import.meta.dir, "../../apps/web/src/composer/Composer.tsx"), "utf8");
const serverSource = readFileSync(join(import.meta.dir, "../../apps/server/src/index.ts"), "utf8");
const desktopSource = readFileSync(join(import.meta.dir, "../../desktop/main.cjs"), "utf8");
const prepareDesktopSource = readFileSync(join(import.meta.dir, "../../scripts/prepare-desktop.mjs"), "utf8");
const vmSkillPath = join(import.meta.dir, "../../.codex/skills/sa-vm/SKILL.md");
const vmSkillSource = existsSync(vmSkillPath)
  ? readFileSync(vmSkillPath, "utf8")
  : buildSaVmWorkspaceSkillMarkdown({ cwd: join(import.meta.dir, "../.."), enabled: true });

test("composer exposes a per-thread SA-VM policy button and dialog", () => {
  expect(composerSource).toContain('data-testid="composer-vm-button"');
  expect(composerSource).toContain('data-testid="composer-vm-dialog"');
  expect(composerSource).toContain('data-testid="composer-vm-policy-preview"');
  expect(composerSource).toContain('data-testid={`composer-vm-browse-${access}`}');
  expect(composerSource).not.toContain('value="tools"');
  expect(composerSource).toContain('value="execution"');
  expect(composerSource).toContain('value="filesystem"');
  expect(composerSource).toContain('value="network"');
  expect(composerSource).toContain('value="savings"');
  expect(composerSource).toContain('value="preview"');
  expect(composerSource).toContain("<VmToolsSettingsTab");
  const vmToolsTabSource = readFileSync(join(import.meta.dir, "../../frontends/vmtool-security/src/security/VmToolsSettingsTab.tsx"), "utf8");
  expect(vmToolsTabSource).toContain('data-testid="composer-vm-toggle-all-replacements"');
  expect(vmToolsTabSource).toContain('data-testid="composer-vm-decoupled-enhance-info"');
  expect(vmToolsTabSource.indexOf('data-testid="composer-vm-toggle-all-replacements"')).toBeLessThan(vmToolsTabSource.indexOf('data-testid="composer-vm-toggle-exec"'));
  expect(vmToolsTabSource.indexOf('data-testid="composer-vm-decoupled-enhance-info"')).toBeLessThan(vmToolsTabSource.indexOf("Fixed Project Check Profiles"));
  expect(vmToolsTabSource).not.toContain('data-testid="composer-vm-toggle-read"');
  expect(vmToolsTabSource).not.toContain('data-testid="composer-vm-toggle-write"');
  expect(vmToolsTabSource).not.toContain('data-testid="composer-vm-toggle-patch"');
  expect(vmToolsTabSource).toContain('data-testid="composer-vm-toggle-exec"');
  expect(vmToolsTabSource).toContain('data-testid="composer-vm-toggle-javascript"');
  expect(vmToolsTabSource).toContain('data-testid="composer-vm-toggle-python"');
  expect(vmToolsTabSource).toContain('data-testid="composer-vm-toggle-bun"');
  expect(vmToolsTabSource).toContain('data-testid="composer-vm-toggle-all-bun-profiles"');
  // AST and context tools have been decoupled to EnhanceToolsDialog & composer-enhance-button
  expect(vmToolsTabSource).not.toContain('data-testid="composer-vm-toggle-all-context-ide-tools"');
  expect(vmToolsTabSource).not.toContain('data-testid="composer-vm-toggle-file-outline"');
  expect(vmToolsTabSource).not.toContain('data-testid="composer-vm-toggle-find-definition"');
  expect(vmToolsTabSource).not.toContain('data-testid="composer-vm-toggle-rename-symbol"');
  expect(vmToolsTabSource).not.toContain('data-testid="composer-vm-toggle-get-diagnostics"');
  const vmSavingsTabSource = readFileSync(join(import.meta.dir, "../../frontends/free-mode/src/free/VmContextSavingsTab.tsx"), "utf8");
  expect(vmSavingsTabSource).toContain('data-testid="composer-vm-toggle-all-context-savings"');
  const cnLocales = readFileSync(join(import.meta.dir, "../../apps/web/src/locales/cn.json"), "utf8");
  const enLocales = readFileSync(join(import.meta.dir, "../../apps/web/src/locales/en.json"), "utf8");
  expect(cnLocales).toContain('"composer.vmTabSavings": "上下文节省"');
  expect(enLocales).toContain('"composer.vmTabSavings": "Context Savings"');
  expect(composerSource).toContain('data-testid={`composer-vm-git-${option.command}`}');
  expect(composerSource).toContain("VM_GIT_COMMAND_OPTIONS");
  expect(composerSource).not.toContain('data-testid="composer-vm-switch"');
  expect(appSource).toContain("createDefaultSaVmPolicyConfig()");
  expect(appSource).toContain("onVmPolicyChange={(policy: SaVmPolicyConfig) => updateRuntimeSelection({ vmPolicy: policy })}");
  expect(appSource).not.toContain("onVmPolicyChange={(policy) => updateRuntimeSelection({ vmPolicy: policy, vmEnabled: true })}");
  expect(appSource).toContain("...(enabled && !runtimeSelection.vmPolicy ? { vmPolicy: createDefaultSaVmPolicyConfig() } : {})");
  expect(composerSource).toContain('"&.Mui-disabled": {');
  expect(composerSource).toContain('borderColor: vmEnabled ? "primary.main" : "divider"');
});

test("ships the SA-VM skill in the Codex skill directory format", () => {
  const skill = existsSync(vmSkillPath)
    ? readFileSync(vmSkillPath, "utf8")
    : buildSaVmWorkspaceSkillMarkdown({ cwd: join(import.meta.dir, "../.."), enabled: true });
  expect(skill).toContain("name: sa-vm");
  expect(skill).toContain("description:");
  expect(skill).toContain("apply_patch");
  expect(skill).toContain("封装函数工具");
});

test("restores a default policy for an enabled legacy thread", () => {
  const parsed = parseThreadRuntimeSelections({
    "legacy-vm-thread": {
      providerId: null,
      groupId: null,
      model: "gpt-5.5",
      reasoningEffort: "medium",
      vmEnabled: true
    }
  });
  expect(parsed["legacy-vm-thread"]?.vmPolicy).toEqual(createDefaultSaVmPolicyConfig());
});

test("keeps SA-VM tool registration behind the VM switch", () => {
  expect(appSource).toContain("if (runtimeSelection.vmEnabled) {");
  expect(appSource).toContain("if (targetSelection.vmEnabled) {");
  expect(serverSource).toContain("if (!runtime?.vmEnabled)");
});
test("new Codex threads register the dynamic tool without sending unsupported turn fields", () => {
  expect(appSource.match(/startParams\.dynamicTools = \[saVmDynamicToolSpec\([^)]*\)\]/g)).toHaveLength(2);
  expect(appSource).not.toContain("turnParams.dynamicTools");
});

test("VM broker mode preserves code generation and host tools for policy inspection", () => {
  expect(appSource).toContain("saVmDeveloperInstructions");
  expect(appSource).not.toContain('"features.shell_tool": false');
  expect(appSource).not.toContain('"features.unified_exec": false');
  expect(appSource).not.toContain('runtimeSelection.vmEnabled ? "readonlyAsk" : permission');
  expect(appSource).not.toContain('threadSelection.vmEnabled ? "readonlyAsk" : effectivePermission');
});

test("server binds VM execution to enabled thread metadata and packaged DLL paths", () => {
  expect(serverSource).toContain('code: "CUX-SA-VM-DISABLED"');
  expect(serverSource).toContain("cwd: effectiveCwd");
  expect(serverSource).toContain("cwd: vmRuntime.cwd");
  expect(prepareDesktopSource).toContain('"vm.dll"');
  expect(prepareDesktopSource).toContain('"sla.dll"');
  expect(prepareDesktopSource).toContain('"salaDist"');
  const saVmSpecSource = readFileSync(join(import.meta.dir, "../../apps/web/src/app/cli/saVmExecutionSpec.ts"), "utf8");
  expect(saVmSpecSource).toContain("find_files");
  expect(vmSkillSource).toContain("封装函数工具");
  expect(desktopSource).toContain('ipcMain.handle("desktop:pick-directory"');
  expect(serverSource).toContain("isSystemWebSearchPermissionRequest(reason)");
});

test("packages the latest sala tutorial on every Windows desktop build", () => {
  expect(prepareDesktopSource).toContain('process.env.SALA_SOURCE_DIR || join(saRoot, "sala")');
  expect(prepareDesktopSource).toContain('"salaDist": join(salaSource, "dist")');
  expect(prepareDesktopSource).toContain('rmSync(salaOutput, { recursive: true, force: true })');
  expect(prepareDesktopSource).toContain('cpSync(candidates.salaDist, join(salaOutput, "dist"), { recursive: true, dereference: true })');
  expect(prepareDesktopSource).toContain('cpSync(candidates.salaReadme, join(salaOutput, "README.md"))');
  expect(prepareDesktopSource).toContain('writeFileSync(join(salaOutput, "source.json"');
  expect(prepareDesktopSource).toContain('entry: "dist/index.html"');
});
