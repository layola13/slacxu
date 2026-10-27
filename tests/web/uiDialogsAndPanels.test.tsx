import { expect, test } from "bun:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { AgentRosterSetupControl } from "../../apps/web/src/components/AgentRosterSetupControl";
import { AgentRosterEditor } from "../../apps/web/src/components/AgentRosterEditor";
import { VmToolsSettingsTab } from "../../frontends/vmtool-security/src/security/VmToolsSettingsTab";
import { createDefaultSaVmPolicyConfig } from "@codex-ui/shared";

Object.defineProperty(globalThis, "localStorage", {
  configurable: true,
  value: { getItem: () => null, setItem: () => undefined, removeItem: () => undefined, clear: () => undefined }
});

test("AgentRosterSetupControl UI renders unconfigured state with add button", () => {
  const html = renderToStaticMarkup(
    <AgentRosterSetupControl
      roles={[]}
      providers={[]}
      models={[]}
      defaultModel="gpt-5.6-luna"
      onChange={() => {}}
    />
  );

  expect(html).toContain("协作角色");
  expect(html).toContain("未启用，创建普通单人对话");
  expect(html).toContain("添加角色");
});

test("AgentRosterSetupControl UI renders configured state with badge and edit button", () => {
  const html = renderToStaticMarkup(
    <AgentRosterSetupControl
      roles={[
        {
          id: "r1",
          name: "Researcher",
          responsibility: "Research codebase",
          model: "gpt-5.6-luna",
          reasoningEffort: "",
          instanceCount: 1,
          startPolicy: "onDemand",
          runtime: "native",
          enabled: true,
          fallbacks: []
        }
      ]}
      providers={[]}
      models={[]}
      defaultModel="gpt-5.6-luna"
      onChange={() => {}}
    />
  );

  expect(html).toContain("已配置 1 个角色");
  expect(html).toContain("编辑");
  expect(html).toContain("清空");
});

test("AgentRosterEditor UI renders role details and action controls", () => {
  const html = renderToStaticMarkup(
    <AgentRosterEditor
      roles={[
        {
          id: "r1",
          name: "SecurityAuditor",
          responsibility: "Audit system security",
          model: "gpt-5.6-luna",
          reasoningEffort: "",
          instanceCount: 1,
          startPolicy: "onDemand",
          runtime: "native",
          enabled: true,
          fallbacks: []
        }
      ]}
      providers={[]}
      models={[{ id: "gpt-5.6-luna", displayName: "GPT-5.6-Luna" }]}
      defaultModel="gpt-5.6-luna"
      onChange={() => {}}
    />
  );

  expect(html).toContain("SecurityAuditor");
  expect(html).toContain("Audit system security");
});

test("VmToolsSettingsTab UI renders switches for VM execution controls", () => {
  const policy = createDefaultSaVmPolicyConfig();
  const html = renderToStaticMarkup(
    <VmToolsSettingsTab
      vmDraft={policy}
      setVmDraft={() => {}}
    />
  );

  expect(html).toContain('data-testid="composer-vm-toggle-exec"');
  expect(html).toContain('data-testid="composer-vm-toggle-bun"');
  expect(html).not.toContain('data-testid="composer-vm-toggle-read"');
  expect(html).not.toContain('data-testid="composer-vm-toggle-write"');
  expect(html).toContain("命令拦截与执行沙箱");
});
