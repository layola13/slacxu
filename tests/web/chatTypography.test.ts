import { expect, test } from "bun:test";
import { DEFAULT_CHAT_TYPOGRAPHY, parseChatTypographyPreference } from "../../apps/web/src/chatTypography.ts";

test("chat typography supplies the three-line goal default for older preferences", () => {
  expect(parseChatTypographyPreference({ fontSize: 13, lineHeight: 1.5, messageSpacing: 6 })?.goalMaxLines)
    .toBe(DEFAULT_CHAT_TYPOGRAPHY.goalMaxLines);
});

test("chat typography clamps goal panel lines", () => {
  expect(parseChatTypographyPreference({ fontSize: 13, lineHeight: 1.5, messageSpacing: 6, goalMaxLines: 99 })?.goalMaxLines).toBe(12);
  expect(parseChatTypographyPreference({ fontSize: 13, lineHeight: 1.5, messageSpacing: 6, goalMaxLines: 0 })?.goalMaxLines).toBe(1);
});
