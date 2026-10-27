import { expect, test } from "bun:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { RightWorkspacePanel } from "../../apps/web/src/components/RightWorkspacePanel";

Object.defineProperty(globalThis, "localStorage", {
  configurable: true,
  value: { getItem: () => null, setItem: () => undefined, removeItem: () => undefined, clear: () => undefined }
});

// 测试环境 navigator.platform 为 Linux（Bun），默认会隐藏 Browser 页签；
// Windows 用例需显式桩平台，Linux 用例验证隐藏行为。
function stubClientPlatform(platform: string) {
  Object.defineProperty(globalThis.navigator, "platform", { configurable: true, value: platform });
  const withUserAgentData = globalThis.navigator as Navigator & { userAgentData?: unknown };
  if ("userAgentData" in globalThis.navigator) {
    Object.defineProperty(globalThis.navigator, "userAgentData", { configurable: true, value: undefined });
  } else {
    void withUserAgentData;
  }
}

test("RightWorkspacePanel UI renders workspace navigation tabs", () => {
  stubClientPlatform("Win32");
  const html = renderToStaticMarkup(
    <RightWorkspacePanel
      activeTab="explorer"
      sideChat={<div id="test-sidechat">SideChat Panel</div>}
      cwd="/workspace/test-app"
      fileDirectories={{ "/workspace/test-app": [] }}
      openFile={null}
      terminalSessions={[]}
      ptyTerminals={[]}
      onCreatePtyTerminal={() => {}}
      onWritePtyTerminal={() => {}}
      onKillPtyTerminal={() => {}}
      onForgetPtyTerminal={() => {}}
      onResizePtyTerminal={() => {}}
      onLoadPtyTail={async () => ""}
      onTabChange={() => {}}
      onClose={() => {}}
      onReadDirectory={() => {}}
      onReadFile={() => {}}
      onChangeOpenFileContent={() => {}}
      onSaveOpenFile={() => {}}
      onRunTerminalCommand={() => {}}
      onWriteTerminalInput={() => {}}
      onTerminateTerminal={() => {}}
      onResizeTerminal={() => {}}
      onGitRpc={async () => ({ success: true } as any)}
      onOpenTerminal={() => {}}
    />
  );

  expect(html).toContain('aria-label="Right workspace tabs"');
  expect(html).toContain("Side chat");
  expect(html).toContain("Explorer");
  expect(html).toContain("Git");
  expect(html).toContain("Browser");
  expect(html).toContain("Terminal");
});

test("RightWorkspacePanel UI renders sideChat content when active", () => {
  const html = renderToStaticMarkup(
    <RightWorkspacePanel
      activeTab="sidechat"
      sideChat={<div id="test-sidechat">SideChat Panel Content</div>}
      cwd="/workspace/test-app"
      fileDirectories={{ "/workspace/test-app": [] }}
      openFile={null}
      terminalSessions={[]}
      ptyTerminals={[]}
      onCreatePtyTerminal={() => {}}
      onWritePtyTerminal={() => {}}
      onKillPtyTerminal={() => {}}
      onForgetPtyTerminal={() => {}}
      onResizePtyTerminal={() => {}}
      onLoadPtyTail={async () => ""}
      onTabChange={() => {}}
      onClose={() => {}}
      onReadDirectory={() => {}}
      onReadFile={() => {}}
      onChangeOpenFileContent={() => {}}
      onSaveOpenFile={() => {}}
      onRunTerminalCommand={() => {}}
      onWriteTerminalInput={() => {}}
      onTerminateTerminal={() => {}}
      onResizeTerminal={() => {}}
      onGitRpc={async () => ({ success: true } as any)}
      onOpenTerminal={() => {}}
    />
  );

  expect(html).toContain("SideChat Panel Content");
});

test("RightWorkspacePanel UI hides the Browser tab on Linux clients", () => {
  stubClientPlatform("Linux x86_64");
  const html = renderToStaticMarkup(
    <RightWorkspacePanel
      activeTab="explorer"
      sideChat={<div id="test-sidechat">SideChat Panel</div>}
      cwd="/workspace/test-app"
      fileDirectories={{ "/workspace/test-app": [] }}
      openFile={null}
      terminalSessions={[]}
      ptyTerminals={[]}
      onCreatePtyTerminal={() => {}}
      onWritePtyTerminal={() => {}}
      onKillPtyTerminal={() => {}}
      onForgetPtyTerminal={() => {}}
      onResizePtyTerminal={() => {}}
      onLoadPtyTail={async () => ""}
      onTabChange={() => {}}
      onClose={() => {}}
      onReadDirectory={() => {}}
      onReadFile={() => {}}
      onChangeOpenFileContent={() => {}}
      onSaveOpenFile={() => {}}
      onRunTerminalCommand={() => {}}
      onWriteTerminalInput={() => {}}
      onTerminateTerminal={() => {}}
      onResizeTerminal={() => {}}
      onGitRpc={async () => ({ success: true } as any)}
      onOpenTerminal={() => {}}
    />
  );

  expect(html).toContain("Explorer");
  expect(html).toContain("Terminal");
  expect(html).not.toContain("Browser");
});

test("RightWorkspacePanel UI falls back to Explorer when Linux restores a persisted browser tab", () => {
  stubClientPlatform("Linux x86_64");
  const html = renderToStaticMarkup(
    <RightWorkspacePanel
      activeTab="browser"
      sideChat={<div id="test-sidechat">SideChat Panel</div>}
      cwd="/workspace/test-app"
      fileDirectories={{ "/workspace/test-app": [] }}
      openFile={null}
      terminalSessions={[]}
      ptyTerminals={[]}
      onCreatePtyTerminal={() => {}}
      onWritePtyTerminal={() => {}}
      onKillPtyTerminal={() => {}}
      onForgetPtyTerminal={() => {}}
      onResizePtyTerminal={() => {}}
      onLoadPtyTail={async () => ""}
      onTabChange={() => {}}
      onClose={() => {}}
      onReadDirectory={() => {}}
      onReadFile={() => {}}
      onChangeOpenFileContent={() => {}}
      onSaveOpenFile={() => {}}
      onRunTerminalCommand={() => {}}
      onWriteTerminalInput={() => {}}
      onTerminateTerminal={() => {}}
      onResizeTerminal={() => {}}
      onGitRpc={async () => ({ success: true } as any)}
      onOpenTerminal={() => {}}
    />
  );

  // Explorer 面板兜底渲染（workspace-explorer-panel），且无 Browser 字样。
  expect(html).toContain("workspace-explorer-panel");
  expect(html).not.toContain("Browser");
});
