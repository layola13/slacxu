import { expect, test } from "bun:test";
import { anthropicBudgetToEffort } from "../../backends/relay-config/src/relay/relayProtocolGateway.ts";

test("anthropic enabled thinking budget maps to effort tier", () => {
  expect(anthropicBudgetToEffort({ type: "enabled", budget_tokens: 1024 })).toBe("low");
  expect(anthropicBudgetToEffort({ type: "enabled", budget_tokens: 2048 })).toBe("medium");
  expect(anthropicBudgetToEffort({ type: "enabled", budget_tokens: 4096 })).toBe("high");
  expect(anthropicBudgetToEffort({ type: "enabled", budget_tokens: 8192 })).toBe("xhigh");
});

test("non-enabled or missing budgets yield no effort", () => {
  expect(anthropicBudgetToEffort({ type: "disabled" })).toBeUndefined();
  expect(anthropicBudgetToEffort({ type: "adaptive" })).toBeUndefined();
  expect(anthropicBudgetToEffort({ type: "enabled" })).toBeUndefined();
});
