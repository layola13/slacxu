import { expect, test } from "bun:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { Composer } from "../../apps/web/src/composer/Composer";
import { createDefaultSaVmPolicyConfig } from "@codex-ui/shared";

Object.defineProperty(globalThis, "localStorage", {
  configurable: true,
  value: { getItem: () => null, setItem: () => undefined, removeItem: () => undefined, clear: () => undefined }
});

const t = (k: string) => k;

test("Composer UI renders idle state with text input, send button, and cwd label", () => {
  const html = renderToStaticMarkup(
    <Composer
      cwd="/workspace/test-project"
      permission="fullAsk"
      disabled={false}
      pendingMention={null}
      dangerBypassConfirmed={false}
      t={t}
      onMentionConsumed={() => {}}
      onSend={() => true}
    />
  );

  expect(html).toContain("<textarea");
  expect(html).toContain('aria-label="composer.send"');
  expect(html).toContain("/workspace/test-project");
  expect(html).toContain("newChat.fullAccess");
});

test("Composer UI renders running state with stop and steer controls", () => {
  const html = renderToStaticMarkup(
    <Composer
      cwd="/workspace/test-project"
      permission="dangerBypass"
      disabled={false}
      pendingMention={null}
      dangerBypassConfirmed={true}
      running={true}
      statusLabel="Thinking and writing code..."
      t={t}
      onMentionConsumed={() => {}}
      onSend={() => true}
      onStop={() => {}}
      onSteer={() => true}
    />
  );

  expect(html).toContain('aria-label="composer.stop"');
  expect(html).toContain('aria-label="Steer"');
  expect(html).toContain("Thinking and writing code...");
});

test("Composer UI renders SA-VM controls and badges", () => {
  const policy = createDefaultSaVmPolicyConfig();
  const html = renderToStaticMarkup(
    <Composer
      cwd="/workspace/test-project"
      permission="fullAsk"
      disabled={false}
      pendingMention={null}
      dangerBypassConfirmed={false}
      vmEnabled={true}
      onVmEnabledChange={() => {}}
      vmPolicy={policy}
      modeBadges={{ fast: true, plan: true, goalActive: true }}
      t={t}
      onMentionConsumed={() => {}}
      onSend={() => true}
    />
  );

  expect(html).toContain('data-testid="composer-vm-button"');
  expect(html).toContain("composer.fastBadge");
  expect(html).toContain("composer.planBadge");
  expect(html).toContain("composer.goalBadge");
});

test("Composer UI renders context usage progress and metrics", () => {
  const html = renderToStaticMarkup(
    <Composer
      cwd="/workspace/test-project"
      permission="fullAsk"
      disabled={false}
      pendingMention={null}
      dangerBypassConfirmed={false}
      contextUsage={{ usedTokens: 48000, contextWindow: 128000 }}
      t={t}
      onMentionConsumed={() => {}}
      onSend={() => true}
    />
  );

  expect(html).toContain("48");
});

test("Composer UI renders sendBlockedReason alert when send is gated", () => {
  const html = renderToStaticMarkup(
    <Composer
      cwd="/workspace/test-project"
      permission="fullAsk"
      disabled={true}
      sendBlockedReason="Workspace confirmation required"
      pendingMention={null}
      dangerBypassConfirmed={false}
      t={t}
      onMentionConsumed={() => {}}
      onSend={() => true}
    />
  );

  expect(html).toContain('aria-label="composer.statusNotice"');
});
