import { readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "bun:test";
import { parseQuickManualModelsText } from "../../apps/web/src/settings/SettingsDrawer";

test("manual models parse comma separated input", () => {
  expect(parseQuickManualModelsText("gpt-4o,gpt-4o-mini")).toEqual(["gpt-4o", "gpt-4o-mini"]);
});

test("manual models accept chinese commas, newlines, and extra spaces", () => {
  expect(parseQuickManualModelsText("gpt-4o， gpt-4o-mini、claude\n  gemini ")).toEqual(
    ["gpt-4o", "gpt-4o-mini", "claude", "gemini"]
  );
});

test("manual models dedupe and drop empty entries", () => {
  expect(parseQuickManualModelsText("a,,a, ,b")).toEqual(["a", "b"]);
  expect(parseQuickManualModelsText("   ")).toEqual([]);
});

test("quick save skips remote fetch when manual models are provided", () => {
  const source = readFileSync(join(import.meta.dir, "../../apps/web/src/settings/SettingsDrawer.tsx"), "utf8");
  expect(source).toContain("quickManualModels ? manualModels : await fetchQuickChannelModels(connection)");
  expect(source).toContain('data-testid="quick-manual-models-toggle"');
  expect(source).toContain('data-testid="quick-manual-models-input"');
  expect(source).toContain("settings.relay.quickManualModelsRequired");
});
