import { expect, test } from "bun:test";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { checkFreeCompactionReadiness } from "../../frontends/free-mode/src/free/freeCompactionReadiness";
import { clampFreeAutoCompactThreshold } from "../../frontends/free-mode/src/free/freeAutoCompactPreferences";
import { saVmDynamicToolSpec } from "../../apps/server/src/workbenchControlApi";
import type { ProviderConfig } from "@codex-ui/shared";

const root = join(import.meta.dir, "../..");

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
const appSource = assembledAppSource(root);
const composerSource = readFileSync(join(root, "apps/web/src/composer/Composer.tsx"), "utf8");
const composerModelSelectSource = readFileSync(join(root, "apps/web/src/composer/ComposerModelSelect.tsx"), "utf8");

test("Composer exposes runtime controls, model selector, reasoning, and agents button", () => {
  expect(appSource).toContain('data-testid="composer-runtime-controls"');
  expect(appSource + composerModelSelectSource).toContain('data-testid="composer-model-select"');
  expect(composerModelSelectSource).toContain("composer-model-filter");
  expect(appSource).toContain('data-testid="composer-reasoning-button"');
  expect(appSource).toContain('data-testid="composer-agents-button"');
  expect(appSource).toContain('data-testid="composer-free-savings-button"');
});

test("Free Savings Mode readiness verification and threshold clamping", () => {
  const mockProviders: ProviderConfig[] = [
    {
      id: "free-relay",
      name: "Free Relay",
      nativeModels: ["free-model-1"],
      groups: [
        { id: "free-group", label: "Free Group", multiplier: 0, models: ["free-model-1"] }
      ]
    } as never
  ];

  // Incomplete selection reports ok: false
  const missingSel = checkFreeCompactionReadiness({
    activeThreadId: "t-1",
    workspaceMode: "local",
    currentModel: "gpt-5.6",
    providers: mockProviders,
    manualProviderId: null,
    manualGroupId: null,
    manualFreeModel: null
  });
  expect(missingSel.ok).toBe(false);
  if (!missingSel.ok) {
    expect(missingSel.reason).toBe("manual-route-incomplete");
  }

  // Complete selection with valid free group reports ok: true
  const readySel = checkFreeCompactionReadiness({
    activeThreadId: "t-1",
    workspaceMode: "local",
    currentModel: "gpt-5.6",
    providers: mockProviders,
    manualProviderId: "free-relay",
    manualGroupId: "free-group",
    manualFreeModel: "free-model-1"
  });
  expect(readySel.ok).toBe(true);

  // Threshold clamping
  expect(clampFreeAutoCompactThreshold(40)).toBe(50);
  expect(clampFreeAutoCompactThreshold(80)).toBe(80);
  expect(clampFreeAutoCompactThreshold(120)).toBe(95);

  // App threshold wiring
  expect(appSource).toContain("setFreeAutoCompactThreshold");
  expect(appSource).toContain("clampFreeAutoCompactThreshold");
});

test("Runtime selection is isolated per thread and persisted independently", () => {
  expect(appSource).toContain("loadPersistedThreadRuntimeSelection");
  expect(appSource).toContain("persistThreadRuntimeSelection");
  expect(appSource).toContain("patchThreadRuntimeSelection");
});

test("SA-VM modal button and dynamic tool schema omission of script runners when disabled", () => {
  expect(composerSource).toContain('data-testid="composer-vm-button"');
  expect(appSource).toContain("saVmDynamicToolSpec(runtimeSelection.vmPolicy)");

  // When python execution is disabled, run_py is omitted from tool actions
  const specDisabled = saVmDynamicToolSpec({ execution: { python: false, javascript: false } } as never);
  const actions = (specDisabled.inputSchema as { properties: { action: { enum: string[] } } }).properties.action.enum;
  expect(actions).toContain("read_file");
  expect(actions).toContain("write_file");
  expect(actions).toContain("apply_patch");
  expect(actions).toContain("grep_search");
  expect(actions).toContain("find_files");
  expect(actions).not.toContain("run_py");
  expect(actions).not.toContain("run_js");

  // saVmExecutionSpec specifies run_project_check and profile/test_file for dynamic tools
  const saVmSpecSource = readFileSync(join(import.meta.dir, "../../apps/web/src/app/cli/saVmExecutionSpec.ts"), "utf8");
  expect(saVmSpecSource).toContain('"run_project_check"');
  expect(saVmSpecSource).toContain('profile: { type: "string"');
  expect(saVmSpecSource).toContain('test_file: { type: "string"');
  expect(saVmSpecSource).toContain("preferred for multi-file content writes");

  const parallelProp = (specDisabled.inputSchema as { properties: { parallel?: { description?: string } } }).properties.parallel;
  expect(parallelProp?.description).toContain("preferred for multi-file content writes");
});

test("Model selection handles available models and displays notices", () => {
  expect(appSource).toContain("resolveSelectedModel");
  expect(appSource).toContain("resolveTextRuntimeGroupId");
  expect(appSource).toContain("setSlashNotice");
});
