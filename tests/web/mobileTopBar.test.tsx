import { expect, test } from "bun:test";
import React from "react";
import { createRoot } from "react-dom/client";
import { act } from "react";
import { Window } from "happy-dom";
import { MobileTopBar } from "../../apps/web/src/mobile/MobileTopBar";

function setupDom() {
  const window = new Window();
  globalThis.window = window as any;
  globalThis.document = window.document as any;
  globalThis.HTMLElement = window.HTMLElement as any;
  globalThis.navigator = window.navigator as any;
  return window;
}

function renderBar(props: Partial<React.ComponentProps<typeof MobileTopBar>> = {}) {
  setupDom();
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => {
    root.render(
      <MobileTopBar
        title="hello thread"
        providerLabel="DeepKey Relay"
        modelLabel="gpt-5.6-luna"
        statusKind="idle"
        running={false}
        onOpenHistory={() => {}}
        onOpenRelay={() => {}}
        onNewChat={() => {}}
        {...props}
      />,
    );
  });
  return { container, root };
}

test("mobile top bar leads with the conversation title, relay stays a status dot", () => {
  const { container, root } = renderBar();
  try {
    const title = container.querySelector('[data-testid="mobile-conversation-title"]');
    expect(title?.textContent).toBe("hello thread");
    const capsule = container.querySelector('[data-testid="mobile-status-capsule"]');
    expect(capsule).not.toBeNull();
    // The relay name must not occupy bar space: dot only, label removed
    // (emotion injects a <style> tag, so assert on elements, not text).
    expect(capsule?.querySelector("p,span")).toBeNull();
    expect(container.querySelector('[data-testid="mobile-status-dot"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="mobile-status-label"]')).toBeNull();
  } finally {
    root.unmount();
  }
});

test("mobile top bar exposes collapse affordance when wired", () => {
  const { container: withCollapse, root: root1 } = renderBar({
    onCollapseTopBar: () => {},
    collapseTopBarLabel: "切换顶栏",
  });
  try {
    const btn = withCollapse.querySelector('[data-testid="mobile-collapse-topbar-button"]');
    expect(btn).not.toBeNull();
    expect(btn?.getAttribute("aria-label")).toBe("切换顶栏");
  } finally {
    root1.unmount();
  }
  const { container: withoutCollapse, root: root2 } = renderBar();
  try {
    expect(withoutCollapse.querySelector('[data-testid="mobile-collapse-topbar-button"]')).toBeNull();
  } finally {
    root2.unmount();
  }
});
