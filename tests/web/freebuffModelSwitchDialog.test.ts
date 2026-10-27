import { expect, test } from "bun:test";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const root = join(import.meta.dir, "../..");
const appSource = readFileSync(join(root, "apps/web/src/shell/AppRoot.tsx"), "utf8")
  + readFileSync(join(root, "apps/web/src/shell/RuntimeControlSet.tsx"), "utf8")
  + readFileSync(join(root, "apps/web/src/shell/AuthenticatedWorkbench.tsx"), "utf8")
  + readFileSync(join(root, "apps/web/src/shell/WorkbenchRoot.tsx"), "utf8");
const dialogPath = join(root, "apps/web/src/components/FreebuffModelSwitchDialog.tsx");

test("FreebuffModelSwitchDialog component exists and contains key UI elements", () => {
  expect(existsSync(dialogPath)).toBe(true);
  const dialogSource = readFileSync(dialogPath, "utf8");
  expect(dialogSource).toContain("FreebuffModelSwitchDialog");
  expect(dialogSource).toContain("freebuff-model-switch-dialog");
  expect(dialogSource).toContain("切换 Freebuff 免费模型确认");
  expect(dialogSource).toContain("当前激活插槽");
  expect(dialogSource).toContain("待切换新模型");
  expect(dialogSource).toContain("确认删除插槽并切换");
  expect(dialogSource).toContain("保持当前模型 (推荐)");
});

test("App.tsx integrates Freebuff session management, green dot indicator, and switch dialog", () => {
  // Freebuff dialog mounted in JSX
  expect(appSource).toContain("<FreebuffModelSwitchDialog");
  expect(appSource).toContain("freebuffSwitchDialogOpen");
  expect(appSource).toContain("freebuffSwitchTargetModel");
  expect(appSource).toContain("handleConfirmFreebuffSwitch");
  expect(appSource).toContain("handleKeepCurrentFreebuffModel");

  // Green dot indicator for active Freebuff model lives in the extracted
  // Composer components (ComposerQuotaChip / ComposerModelSelect).
  const quotaChipSource = readFileSync(join(root, "apps/web/src/composer/ComposerQuotaChip.tsx"), "utf8");
  expect(quotaChipSource).toContain("isFreebuffActive");
  const modelSelectSource = readFileSync(join(root, "apps/web/src/composer/ComposerModelSelect.tsx"), "utf8");
  expect(modelSelectSource).toContain("isActiveSlot");
  expect(modelSelectSource).toContain("当前激活");

  // Selection interception when selecting a different model under freebuff group
  expect(appSource).toContain('activeGroupId === "freebuff" && freebuffSession?.active && freebuffSession.model && model !== freebuffSession.model');
  expect(appSource).toContain("setFreebuffSwitchDialogOpen(true)");
});
