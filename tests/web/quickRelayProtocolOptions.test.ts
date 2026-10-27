import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

test("quick relay creation exposes all four response protocols for every provider", () => {
  const source = readFileSync(join(import.meta.dir, "../../apps/web/src/settings/SettingsDrawer.tsx"), "utf8");
  const start = source.indexOf("const AdvancedRelayConnectionStep");
  const end = source.indexOf("AdvancedRelayConnectionStep.displayName", start);
  expect(start).toBeGreaterThanOrEqual(0);
  expect(end).toBeGreaterThan(start);
  const stepSource = source.slice(start, end);

  expect(stepSource.match(/<MenuItem value="openai-response">/g)).toHaveLength(1);
  expect(stepSource.match(/<MenuItem value="openai">/g)).toHaveLength(1);
  expect(stepSource.match(/<MenuItem value="anthropic">/g)).toHaveLength(1);
  expect(stepSource.match(/<MenuItem value="gemini">/g)).toHaveLength(1);
});
