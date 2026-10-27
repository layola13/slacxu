import { readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "bun:test";

test("relay share dialog exposes progress, timeout, and missing-session feedback", () => {
  const source = readFileSync(join(import.meta.dir, "../../apps/web/src/App.tsx"), "utf8")
    + readFileSync(join(import.meta.dir, "../../apps/web/src/components/dialogs/RelayShareDialogs.tsx"), "utf8")
    + readFileSync(join(import.meta.dir, "../../apps/web/src/app/workbench/useProvidersRuntime.ts"), "utf8");

  expect(source).toContain("当前登录会话不可用，请重新打开设置后再试");
  expect(source).toContain("生成分享内容超时，请检查服务连接或中转站配置大小后重试");
  expect(source).toContain("正在生成分享内容…");
  expect(source).toContain("disabled={relayShareExportBusy}");
});
