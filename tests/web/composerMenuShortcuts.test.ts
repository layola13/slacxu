import { expect, test } from "bun:test";
import { shouldOpenComposerAddMenu } from "../../apps/web/src/composer/composerMenuShortcuts.ts";

test("the add menu shortcut only accepts @ as the first input character", () => {
  expect(shouldOpenComposerAddMenu("", "@")).toBe(true);
  expect(shouldOpenComposerAddMenu("hello", "hello@")).toBe(false);
  expect(shouldOpenComposerAddMenu(" ", " @")).toBe(false);
  expect(shouldOpenComposerAddMenu("a", "@")).toBe(false);
  expect(shouldOpenComposerAddMenu("", "@file")).toBe(false);
  expect(shouldOpenComposerAddMenu("@", "@@")).toBe(false);
});
