import { expect, test } from "bun:test";
import { submitComposerWhenAccepted } from "../../apps/web/src/composer/composerSubmission";

test("keeps the draft when workspace confirmation interrupts sending", async () => {
  let clears = 0;
  expect(await submitComposerWhenAccepted(async () => false, () => { clears += 1; })).toBe(false);
  expect(clears).toBe(0);
});

test("clears the draft only after the send is accepted", async () => {
  let clears = 0;
  expect(await submitComposerWhenAccepted(async () => true, () => { clears += 1; })).toBe(true);
  expect(clears).toBe(1);
});
