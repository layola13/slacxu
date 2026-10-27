import { expect, test, describe } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const expectedKeys = [
  "jev.settings.title",
  "jev.settings.close",
  "jev.settings.enabledLabel",
  "jev.settings.upstreamLabel",
  "jev.settings.upstreamJev",
  "jev.settings.upstreamCloudflare",
  "jev.settings.upstreamHelper",
  "jev.settings.apiKeyPlaceholderCloudflare",
  "jev.settings.baseUrlHelper",
  "jev.settings.modelHelper",
  "jev.settings.bridgeTitle",
  "jev.settings.bridgeDesc",
  "jev.settings.relayLabel",
  "jev.settings.relayLoadingLabel",
  "jev.settings.relayHelper",
  "jev.settings.relayNoToken",
  "jev.settings.relayLoadFailed",
  "jev.settings.relayDirect",
  "jev.settings.groupLabel",
  "jev.settings.groupPlaceholder",
  "jev.settings.bridgeModelLabel",
  "jev.settings.bridgeModelHelper",
  "jev.settings.bridgeProtocolLabel",
  "jev.settings.bridgeProtocolHelper",
  "jev.settings.bridgeActive",
  "jev.settings.activeToolsLabel",
  "jev.settings.activeToolsDesc",
  "jev.settings.passiveTitle",
  "jev.settings.autoNudgeLabel",
  "jev.settings.planReviewLabel",
  "jev.settings.briefLabel",
  "jev.settings.reportLabel",
  "jev.settings.planReviewTimingLabel",
  "jev.settings.planReviewTimingHelper",
  "jev.settings.maxNudgesLabel",
  "jev.settings.maxNudgesHelper",
  "jev.settings.testButton",
  "jev.settings.needKeyOrRelay",
  "jev.settings.connectionFailed",
  "jev.settings.disabledInfo",
  "jev.settings.cancel",
  "jev.settings.save",
  "jev.settings.saveFailed",
  "jev.settings.showKey",
  "jev.settings.hideKey",
  "jev.planReview.off",
  "jev.planReview.created",
  "jev.planReview.every",
  "jev.enhance.sectionTitle",
  "jev.enhance.keyHint",
  "jev.enhance.chooseTitle",
  "jev.enhance.chooseDesc",
  "jev.enhance.checklistTitle",
  "jev.enhance.checklistDesc",
  "jev.enhance.evaluateTitle",
  "jev.enhance.evaluateDesc",
  "jev.enhance.thinkingTitle",
  "jev.enhance.thinkingDesc",
  "jev.enhance.redteamTitle",
  "jev.enhance.redteamDesc",
  "jev.enhance.rankTitle",
  "jev.enhance.rankDesc",
  "jev.enhance.scopeTitle",
  "jev.enhance.scopeDesc",
  "jev.enhance.dispatchTitle",
  "jev.enhance.dispatchDesc",
  "jev.enhance.consistencyTitle",
  "jev.enhance.consistencyDesc",
  "jev.enhance.doneTitle",
  "jev.enhance.doneDesc",
  "jev.enhance.diagnoseTitle",
  "jev.enhance.diagnoseDesc",
  "jev.enhance.edgeCasesTitle",
  "jev.enhance.edgeCasesDesc",
  "jev.enhance.blastRadiusTitle",
  "jev.enhance.blastRadiusDesc",
  "jev.enhance.intentTitle",
  "jev.enhance.intentDesc",
  "jev.enhance.nextTitle",
  "jev.enhance.nextDesc",
  "jev.enhance.compressTitle",
  "jev.enhance.compressDesc",
  "jev.enhance.progressTitle",
  "jev.enhance.progressDesc",
  "jev.composer.title",
  "jev.composer.failed",
  "jev.composer.enabled",
  "jev.composer.paused",
  "jev.composer.activate",
  "jev.composer.nudge",
  "jev.composer.dismissVerdict",
  "jev.drawer.subLabel",
  "jev.drawer.subAria",
  "jev.drawer.tokenLabel",
  "jev.drawer.tokenAria",
  "jev.drawer.thresholdAria",
  "jev.drawer.thresholdCaption",
];

describe("JEV i18n coverage", () => {
  const root = join(import.meta.dir, "../../apps/web/src");
  const en = JSON.parse(readFileSync(join(root, "locales/en.json"), "utf8")) as Record<string, string>;
  const cn = JSON.parse(readFileSync(join(root, "locales/cn.json"), "utf8")) as Record<string, string>;
  const tc = JSON.parse(readFileSync(join(root, "locales/tc.json"), "utf8")) as Record<string, string>;
  const zhTw = JSON.parse(readFileSync(join(root, "locales/zh-TW.json"), "utf8")) as Record<string, string>;
  const dialog = readFileSync(join(root, "../../../frontends/jev/src/jev/JevSettingsDialog.tsx"), "utf8");
  const enhance = readFileSync(join(root, "../../../frontends/enhance/src/enhance/EnhanceToolsDialog.tsx"), "utf8");
  const composer = readFileSync(join(root, "composer/Composer.tsx"), "utf8");
  const drawer = readFileSync(join(root, "settings/SettingsDrawer.tsx"), "utf8");
  const jevConfig = readFileSync(join(root, "../../../sdk-frontend/src/jevConfig.ts"), "utf8");

  test("every jev.* key exists in en, cn, tc and zh-TW packs with non-empty values", () => {
    for (const key of expectedKeys) {
      expect(en[key], `en missing ${key}`).toBeTruthy();
      expect(cn[key], `cn missing ${key}`).toBeTruthy();
      expect(tc[key], `tc missing ${key}`).toBeTruthy();
      expect(zhTw[key], `zh-TW missing ${key}`).toBeTruthy();
    }
  });

  test("interpolated keys keep their placeholders", () => {
    expect(en["jev.settings.bridgeActive"]).toContain("{provider}");
    expect(en["jev.settings.bridgeActive"]).toContain("{protocol}");
    expect(en["jev.settings.maxNudgesHelper"]).toContain("{max}");
    expect(cn["jev.settings.bridgeActive"]).toContain("{provider}");
    expect(cn["jev.settings.maxNudgesHelper"]).toContain("{max}");
  });

  test("JevSettingsDialog renders through t() instead of hardcoded Chinese", () => {
    expect(dialog).toContain('t("jev.settings.title")');
    expect(dialog).toContain("t(`jev.planReview.${option.value}`)");
    expect(dialog).not.toContain("JEV 智能评判配置</Box>");
    expect(dialog).not.toContain("最多自动督促次数");
    expect(dialog).not.toContain("测试连接");
  });

  test("EnhanceTools section 7 renders through t()", () => {
    expect(enhance).toContain('t("jev.enhance.sectionTitle")');
    expect(enhance).toContain('t("jev.enhance.keyHint")');
    expect(enhance).toContain('t("jev.enhance.chooseTitle")');
    expect(enhance).toContain('t("jev.enhance.progressDesc")');
    expect(enhance).not.toContain("方案分叉单选决策");
  });

  test("Composer JEV user-visible strings render through t()", () => {
    expect(composer).toContain('t("jev.composer.title")');
    expect(composer).toContain('t("jev.composer.failed")');
    expect(composer).toContain('t("jev.composer.activate")');
    expect(composer).toContain('t("jev.composer.nudge")');
    expect(composer).toContain('t("jev.composer.dismissVerdict")');
    expect(composer).not.toContain("JEV 智能评判${");
    expect(composer).not.toContain("关闭 JEV 裁决提示");
    expect(composer).not.toContain("督促继续");
  });

  test("plan-review option labels fall back to English", () => {
    expect(jevConfig).toContain("Review once on creation");
    expect(jevConfig).toContain("Review on every update");
    expect(jevConfig).not.toContain("仅创建时审一次");
  });

  test("SettingsDrawer JEV compression strings render through t()", () => {
    expect(drawer).toContain('t("jev.drawer.subLabel")');
    expect(drawer).toContain('t("jev.drawer.tokenLabel")');
    expect(drawer).toContain('t("jev.drawer.thresholdAria")');
    expect(drawer).toContain('t("jev.drawer.thresholdCaption"');
    expect(drawer).not.toContain("JEV订阅高频剪");
    expect(drawer).not.toContain("JEV Token阈值剪");
    expect(drawer).not.toContain("JEV压缩阈值");
  });
});
