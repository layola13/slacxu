import { describe, expect, it } from "bun:test";
import { isSaVmBlockedToolName, rewriteRelayRequestToolsForSaVm } from "../../backends/free-mode/src/free/compactionRelayRequest.js";
import { workbenchThreadStartParams, workbenchTurnStartParams, type WorkbenchRuntime } from "../../apps/server/src/workbenchControlApi.js";

describe("saVmToolMasking", () => {
  it("identifies blocked host shell tool names across formats and namespaces", () => {
    expect(isSaVmBlockedToolName("exec_command")).toBe(true);
    expect(isSaVmBlockedToolName("write_stdin")).toBe(true);
    expect(isSaVmBlockedToolName("bash")).toBe(true);
    expect(isSaVmBlockedToolName("terminal")).toBe(true);
    expect(isSaVmBlockedToolName("execCommand")).toBe(true);
    expect(isSaVmBlockedToolName("commandExecution")).toBe(true);
    expect(isSaVmBlockedToolName("codex:exec_command")).toBe(true);
    expect(isSaVmBlockedToolName("default/bash")).toBe(true);

    // Allowed tools in SA-VM
    expect(isSaVmBlockedToolName("sa_vm_run")).toBe(false);
    expect(isSaVmBlockedToolName("apply_patch")).toBe(false);
    expect(isSaVmBlockedToolName("view_image")).toBe(false);
    expect(isSaVmBlockedToolName("web_search")).toBe(false);
    expect(isSaVmBlockedToolName("")).toBe(false);
  });

  it("filters out native shell tools from OpenAI chat request body", async () => {
    const originalBody = {
      model: "gpt-5.6-luna",
      messages: [{ role: "user", content: "hello" }],
      tools: [
        { type: "function", function: { name: "exec_command", description: "run shell" } },
        { type: "function", function: { name: "sa_vm_run", description: "run SLA" } },
        { type: "function", function: { name: "apply_patch", description: "patch file" } }
      ]
    };
    const req = new Request("http://127.0.0.1:43120/api/relay-gateway/p/g/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(originalBody)
    });

    const rewritten = await rewriteRelayRequestToolsForSaVm(req);
    const rewrittenBody = await rewritten.json();

    expect(rewrittenBody.tools).toHaveLength(2);
    expect(rewrittenBody.tools.map((t: any) => t.function?.name)).toEqual(["sa_vm_run", "apply_patch"]);
  });

  it("filters out native shell tools from Anthropic messages request body", async () => {
    const originalBody = {
      model: "claude-3-7-sonnet-20250219",
      messages: [{ role: "user", content: "hello" }],
      tools: [
        { name: "bash", description: "run bash" },
        { name: "sa_vm_run", description: "run SLA" },
        { name: "apply_patch", description: "patch file" }
      ]
    };
    const req = new Request("http://127.0.0.1:43120/api/relay-gateway/p/g/v1/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(originalBody)
    });

    const rewritten = await rewriteRelayRequestToolsForSaVm(req);
    const rewrittenBody = await rewritten.json();

    expect(rewrittenBody.tools).toHaveLength(2);
    expect(rewrittenBody.tools.map((t: any) => t.name)).toEqual(["sa_vm_run", "apply_patch"]);
  });

  it("filters out native shell tools from Responses API request body", async () => {
    const originalBody = {
      model: "gpt-5.6-luna",
      input: [{ role: "user", content: "run test" }],
      tools: [
        { name: "exec_command", description: "shell" },
        { name: "write_stdin", description: "stdin" },
        { name: "sa_vm_run", description: "SLA" }
      ]
    };
    const req = new Request("http://127.0.0.1:43120/api/relay-gateway/p/g/v1/responses", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(originalBody)
    });

    const rewritten = await rewriteRelayRequestToolsForSaVm(req);
    const rewrittenBody = await rewritten.json();

    expect(rewrittenBody.tools).toHaveLength(1);
    expect(rewrittenBody.tools[0].name).toBe("sa_vm_run");
  });

  it("leaves requests untouched if no blocked tools are present or tools is not an array", async () => {
    const safeBody = {
      model: "gpt-5.6-luna",
      tools: [{ name: "sa_vm_run" }]
    };
    const req = new Request("http://127.0.0.1:43120/api/relay-gateway/p/g/v1/responses", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(safeBody)
    });

    const result = await rewriteRelayRequestToolsForSaVm(req);
    expect(result).toBe(req);
  });

  it("omits dynamicTools and instructions in workbenchTurnStartParams to ensure 100% native tools", () => {
    const runtime: WorkbenchRuntime = {
      threadId: "th-123",
      providerId: "p1",
      groupId: "g1",
      model: "m1",
      reasoningEffort: "high",
      permission: "dangerBypass",
      agents: { mode: "inherit", childCount: null, model: "", reasoningEffort: "", roles: [] },
      cliBackend: "codex",
      vmEnabled: true,
      vmPolicy: { engine: "vm" }
    };
    const params = workbenchTurnStartParams({ cwd: process.cwd(), text: "run a test" }, runtime);

    expect(params.dynamicTools).toBeUndefined();
    expect(params.developerInstructions).toBeUndefined();
  });

  it("masks native shell tools whenever the thread is in VM mode", async () => {
    const chatBody = {
      model: "gpt-5.6-luna",
      tools: [
        { type: "function", function: { name: "exec_command", description: "Run shell command" } },
        { type: "function", function: { name: "apply_patch", description: "Apply code patch" } },
        { type: "function", function: { name: "sa_vm_run", description: "Run SLA script" } }
      ]
    };

    for (const toolsConfig of [{ replaceExec: false }, { replaceExec: true }, undefined]) {
      const req = new Request("http://localhost/api/chat/completions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(chatBody)
      });
      const masked = await rewriteRelayRequestToolsForSaVm(req, toolsConfig);
      const maskedBody = await masked.json() as any;
      expect(maskedBody.tools.map((t: any) => t.function.name)).toEqual(["apply_patch", "sa_vm_run"]);
    }
  });
});

