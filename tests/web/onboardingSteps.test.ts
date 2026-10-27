import { expect, test } from "bun:test";
import { filterAvailableSteps, getSteps } from "../../apps/web/src/onboarding/steps";

const translate = (key: string) => key;

test("solo onboarding uses a continuous path through visible primary controls", () => {
  const steps = getSteps("solo", translate);
  const selectors = steps.flatMap((step) => typeof step.element === "string" ? [step.element] : []);

  expect(selectors).toEqual([
    '[data-testid="new-task-tab-button"]',
    '[data-testid="composer-runtime-controls"]',
    '[data-testid="composer-input"]',
    '[data-testid="immersive-view-toggle"]'
  ]);
  expect(selectors.some((selector) => selector.includes("danger-new-chat-dialog"))).toBe(false);
  expect(selectors.some((selector) => selector.includes("immersive-exit-button"))).toBe(false);
  expect(steps.every((step) => step.popover?.showButtons?.includes("next"))).toBe(true);
});

test("team onboarding includes the collaboration control", () => {
  const selectors = getSteps("team", translate)
    .flatMap((step) => typeof step.element === "string" ? [step.element] : []);

  expect(selectors).toContain('[data-testid="composer-agents-button"]');
});

test("missing or responsive-only targets are skipped without blocking the tour", () => {
  const steps = getSteps("solo", translate);
  const available = filterAvailableSteps(steps, (selector) => !selector.includes("runtime-controls"));

  expect(available.length).toBe(steps.length - 1);
  expect(available[0]?.element).toBeUndefined();
  expect(available.at(-1)?.element).toBeUndefined();
});
