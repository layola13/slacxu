import { expect, test } from "bun:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { TopBarRelayTreeSelector } from "../../apps/web/src/components/TopBarRelayTreeSelector";
import { NewChatButton } from "../../apps/web/src/components/NewChatButton";
import { ThreadStatusDot } from "../../apps/web/src/components/ThreadStatusDot";
import { ThemeQuickSwitcher } from "../../apps/web/src/components/ThemeQuickSwitcher";
import type { ProviderConfig } from "@codex-ui/shared";

Object.defineProperty(globalThis, "localStorage", {
  configurable: true,
  value: { getItem: () => null, setItem: () => undefined, removeItem: () => undefined, clear: () => undefined }
});

const t = (k: string) => k;

const sampleProviders: ProviderConfig[] = [
  {
    id: "relay-jiji",
    name: "吉吉 中转",
    groups: [
      {
        id: "default",
        name: "default x1",
        multiplier: 1,
        models: ["gpt-5.6-luna", "gpt-5.6-sol"]
      }
    ]
  }
];

test("TopBarRelayTreeSelector UI renders active provider and group selection", () => {
  const html = renderToStaticMarkup(
    <TopBarRelayTreeSelector
      providers={sampleProviders}
      activeProviderId="relay-jiji"
      activeGroupId="default"
      t={t}
      onActivateProvider={async () => {}}
      onSelectGroup={async () => {}}
    />
  );

  expect(html).toContain("吉吉 中转");
  expect(html).toContain("default x1");
});

test("TopBarRelayTreeSelector UI renders setup relay fallback when unconfigured", () => {
  const html = renderToStaticMarkup(
    <TopBarRelayTreeSelector
      providers={[]}
      activeProviderId={null}
      activeGroupId={null}
      t={t}
      onActivateProvider={async () => {}}
      onSelectGroup={async () => {}}
    />
  );

  expect(html).toContain("topbar.relay.setupRelay");
});

test("NewChatButton UI renders split button and action targets", () => {
  const html = renderToStaticMarkup(
    <NewChatButton
      currentPermission="fullAccess"
      t={t}
      onNew={() => {}}
    />
  );

  expect(html).toContain("newChat.label");
  expect(html).toContain("MuiButtonGroup-root");
});

test("ThreadStatusDot UI renders across idle, running, and error states", () => {
  const idleHtml = renderToStaticMarkup(<ThreadStatusDot status="idle" />);
  const runningHtml = renderToStaticMarkup(<ThreadStatusDot status="running" />);
  const errorHtml = renderToStaticMarkup(<ThreadStatusDot status="error" />);

  expect(idleHtml).toContain("MuiBox-root");
  expect(runningHtml).toContain("MuiBox-root");
  expect(errorHtml).toContain("MuiBox-root");
});

test("ThemeQuickSwitcher UI renders switcher button with color lens icon", () => {
  const html = renderToStaticMarkup(
    <ThemeQuickSwitcher
      themeMode="system"
      themes={[]}
      installedThemePluginIds={[]}
      t={t}
      onThemeChange={() => {}}
      onOpenAppearance={() => {}}
    />
  );

  expect(html).toContain('data-testid="theme-quick-switcher-button"');
  expect(html).toContain('aria-label="themeQuickSwitcher.open"');
});
