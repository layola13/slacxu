import { expect, test } from "bun:test";
import { applyWorkbenchLayoutAction, contextUsageView, createWorkbenchLayout, isTransientThreadMetadataError, isUnmaterializedThreadError, parseWorkbenchRuntime, saVmDeveloperInstructions, saVmDynamicToolSpec, workbenchThreadStartParams, workbenchTurnStartParams } from "../../apps/server/src/workbenchControlApi";

test("creates validated runtime and danger send params", () => {
  const runtime = parseWorkbenchRuntime({ threadId: "t", providerId: "p", groupId: "g", model: "m", reasoningEffort: "high", permission: "dangerBypass" });
  const params = workbenchTurnStartParams({ cwd: "C:\\work", text: "hello" }, runtime);
  expect(params.approvalPolicy).toBe("never");
  expect(params.sandboxPolicy).toEqual({ type: "dangerFullAccess" });
});

test("defaults an enabled headless runtime to a thread-scoped SA-VM policy", () => {
  const runtime = parseWorkbenchRuntime({
    threadId: "vm-thread",
    providerId: "p",
    groupId: "g",
    model: "m",
    vmEnabled: true
  });
  expect(runtime.vmPolicy).toMatchObject({
    fs: { delete: "rename", backupDir: "${PROJECT}/.codex-ultra/vm-trash/**" },
    http: { allow: [] },
    env: { allow: ["CWD", "PROJECT"] },
    process: { spawn: false, exec: [{ path: "git", args: ["status", "*"] }, { path: "git", args: ["pull"] }, { path: "git", args: ["push"] }] },
    execution: { javascript: false, python: false }
  });
});

test("does not register SA-VM tools for disabled headless threads", () => {
  const runtime = parseWorkbenchRuntime({
    threadId: "plain-thread",
    providerId: "p",
    groupId: "g",
    model: "m",
    vmEnabled: false
  });
  const params = workbenchThreadStartParams({ cwd: "C:\\work" }, runtime, "relay-p");
  expect(params.dynamicTools).toBeUndefined();
  expect(params.developerInstructions).toBeUndefined();
});

test("does not inject dynamic tools or SLA instructions into workbench threads", () => {
  const runtime = parseWorkbenchRuntime({
    threadId: "vm-thread",
    providerId: "p",
    groupId: "g",
    model: "m",
    vmEnabled: true,
    vmPolicy: { engine: "vm" }
  });
  const params = workbenchThreadStartParams({ cwd: "C:\\work" }, runtime, "relay-p");
  expect(params.developerInstructions).toBeUndefined();
  expect(params.dynamicTools).toBeUndefined();
});

test("defaults headless threads to native mode without SA-VM tools when engine is native", () => {
  const runtime = parseWorkbenchRuntime({
    threadId: "native-thread",
    providerId: "p",
    groupId: "g",
    model: "m",
    vmEnabled: true,
    vmPolicy: { engine: "native" }
  });
  const params = workbenchThreadStartParams({ cwd: "C:\\work" }, runtime, "relay-p");
  expect(params.dynamicTools).toBeUndefined();
  expect(params.developerInstructions).toBeUndefined();
});

test("passes per-conversation agent settings through headless thread creation", () => {
  const runtime = parseWorkbenchRuntime({
    threadId: "pending",
    providerId: "p",
    groupId: "g",
    model: "gpt-5.6-terra",
    agents: { mode: "enabled", childCount: 5, model: "gpt-5.6-terra", reasoningEffort: "max" }
  });
  expect(workbenchThreadStartParams({ cwd: "C:\\work" }, runtime, "relay-p").config).toEqual({
    "features.multi_agent_v2.enabled": true,
    "features.multi_agent_v2.max_concurrent_threads_per_session": 6,
    "agents.default_subagent_model": "gpt-5.6-terra",
    "agents.default_subagent_reasoning_effort": "max"
  });
});

test("creates editable workbench conversations with legacy history", () => {
  const runtime = parseWorkbenchRuntime({
    threadId: "pending",
    providerId: "p",
    groupId: "g",
    model: "gpt-5.6-terra"
  });
  const params = workbenchThreadStartParams({ cwd: "C:\\work" }, runtime, "relay-p");
  expect(params.historyMode).toBe("legacy");
});

test("supports tmux-style split, focus, replace and close actions", () => {
  const initial = createWorkbenchLayout(["a", "b"], "columns");
  const split = applyWorkbenchLayoutAction(initial, { action: "split", paneId: "pane-1", direction: "down", threadId: "c" })!;
  expect((split.panes as unknown[]).length).toBe(3);
  const newPane = (split.panes as Array<{ id: string }>).find((pane) => !["pane-1", "pane-2"].includes(pane.id))!;
  const replaced = applyWorkbenchLayoutAction(split, { action: "replace", paneId: newPane.id, threadId: "d" })!;
  const closed = applyWorkbenchLayoutAction(replaced, { action: "close", paneId: newPane.id })!;
  expect((closed.panes as unknown[]).length).toBe(2);
});

test("creates common split presets with bounded unique panes", () => {
  const layout = createWorkbenchLayout(["a", "b", "c", "d"], "grid-2x2");
  expect(layout?.version).toBe(2);
  expect((layout?.panes as unknown[]).length).toBe(4);
  expect(() => createWorkbenchLayout(["a", "a"], "columns")).toThrow();
});

test("projects context window usage as percent", () => {
  expect(contextUsageView({ total: { totalTokens: 900 }, last: { totalTokens: 250 }, modelContextWindow: 1000 })?.percent).toBe(25);
  expect(contextUsageView({ total: { totalTokens: 250 }, modelContextWindow: 1000 })?.percent).toBe(25);
});

test("recognizes only the fresh-thread turns-list boundary", () => {
  expect(isUnmaterializedThreadError(new Error("thread x is not materialized yet; thread/turns/list is unavailable before first user message"))).toBe(true);
  expect(isUnmaterializedThreadError({ message: "thread x is not materialized yet" })).toBe(true);
  expect(isUnmaterializedThreadError(new Error("thread-store conflict"))).toBe(false);
  expect(isTransientThreadMetadataError({ message: "rollout at C:\\x.jsonl is empty" })).toBe(true);
});

test("saVmDeveloperInstructions enforces packaged action tools and forbids raw SLA", () => {
  const instructions = saVmDeveloperInstructions({
    tools: { replaceRead: true, replaceWrite: true, replaceApplyPatch: true, replaceExec: true }
  }, "C:\\work");

  expect(instructions).toContain("Packaged function tools are active");
  expect(instructions).toContain("DO NOT write raw inline script code");
  expect(instructions).toContain("find_files");
  expect(instructions).toContain("read_file");
  expect(instructions).toContain("write_file");
  expect(instructions).toContain("edit_file");
  expect(instructions).toContain("action: 'read_file' or 'read_lines'");
  expect(instructions).not.toContain("sa_fs_read_to_stdout");
  expect(instructions).not.toContain("@import");
});

test("saVmDeveloperInstructions dynamically tailors skill guide path to cliBackend", () => {
  const codex = saVmDeveloperInstructions(undefined, "C:\\work", undefined, "codex");
  expect(codex).toContain(".codex/skills/sa-vm/SKILL.md");

  const claude = saVmDeveloperInstructions(undefined, "C:\\work", undefined, "claude");
  expect(claude).toContain(".claude/skills/sa-vm/SKILL.md");

  const agy = saVmDeveloperInstructions(undefined, "C:\\work", undefined, "agy");
  expect(agy).toContain(".gemini/skills/sa-vm/SKILL.md");
  expect(agy).toContain("[CRITICAL FOR AGY / ANTIGRAVITY AGENT]");
  expect(agy).toContain("call_mcp_tool");
  expect(agy).toContain("ServerName: \"sa-vm\"");
  expect(agy).toContain("ToolName: \"sa_vm_run\"");

   const grok = saVmDeveloperInstructions(undefined, "C:\\work", undefined, "grok");
   expect(grok).toContain(".grok/skills/sa-vm/SKILL.md");
   expect(grok).toContain("[CRITICAL FOR GROK AGENT]");
   expect(grok).toContain("call_mcp_tool");
   expect(grok).toContain("ServerName: \"sa-vm\"");
   expect(grok).toContain("ToolName: \"sa_vm_run\"");

   const claudeGuide = saVmDeveloperInstructions(undefined, "C:\\work", undefined, "claude");
   expect(claudeGuide).toContain("[CRITICAL FOR CLAUDE CODE AGENT]");
   expect(claudeGuide).toContain("\"sa-vm\" MCP server");
   expect(claudeGuide).toContain("jev_choose");
});

test("saVmDynamicToolSpec specifies action parameter and packaged tools", () => {
  const spec = saVmDynamicToolSpec();
  expect(spec.name).toBe("sa_vm_run");
  expect(spec.description).toContain("packaged native function tools");
  const actionProp = (spec.inputSchema as { properties: { action: { type: string; enum: string[] } } }).properties.action;
  expect(actionProp.type).toBe("string");
  expect(actionProp.enum).toContain("apply_patch");
  expect(actionProp.enum).toContain("find_files");
  expect(actionProp.enum).toContain("read_file");
  expect(actionProp.enum).toContain("read_file_tail");
  expect(actionProp.enum).toContain("grep_search_async");
  expect(actionProp.enum).toContain("write_file");
  expect(actionProp.enum).toContain("edit_file");
  expect(actionProp.enum).toContain("copy_file");
  expect(actionProp.enum).toContain("file_info");
  expect(actionProp.enum).toContain("http_fetch");
  const splitSpec = saVmDynamicToolSpec({ tools: { extractToFile: true } } as never);
  const splitAction = (splitSpec.inputSchema as { properties: { action: { enum: string[] } } }).properties.action;
  for (const action of ["split_plan", "split_stage", "split_refine", "split_repair", "split_status"]) expect(splitAction.enum).toContain(action);
  const splitProps = (splitSpec.inputSchema as { properties: Record<string, unknown> }).properties;
  for (const parameter of ["session_id", "phase", "module_name", "confirm", "ops"]) expect(splitProps[parameter]).toBeDefined();
  // run_py and run_js are omitted by default
  expect(actionProp.enum).not.toContain("run_py");
  expect(actionProp.enum).not.toContain("run_js");

  // run_py is included when explicitly enabled in policy
  const specWithPy = saVmDynamicToolSpec({ execution: { python: true } } as never);
  const actionPropWithPy = (specWithPy.inputSchema as { properties: { action: { type: string; enum: string[] } } }).properties.action;
  expect(actionPropWithPy.enum).toContain("run_py");
  expect(actionPropWithPy.enum).not.toContain("run_js");

  // run_project_check and run_bun are included when enabled in policy
  const specWithBun = saVmDynamicToolSpec({
    process: {
      bunProfiles: ["web-test-file"],
      bun: true
    }
  } as never);
  const actionPropWithBun = (specWithBun.inputSchema as { properties: { action: { type: string; enum: string[] } } }).properties.action;
  expect(actionPropWithBun.enum).toContain("run_project_check");
  expect(actionPropWithBun.enum).toContain("run_bun");

  const schemaProps = (specWithBun.inputSchema as { properties: Record<string, { type: string; description?: string }> }).properties;
  expect(schemaProps.profile).toBeDefined();
  expect(schemaProps.test_file).toBeDefined();
  expect(schemaProps.subcommand).toBeDefined();
  expect(schemaProps.filter).toBeDefined();
  expect(schemaProps.parallel).toBeDefined();
  expect(schemaProps.parallel?.description).toContain("preferred for multi-file content writes");
  expect(schemaProps.lines).toBeDefined();
  expect(schemaProps.tail).toBeDefined();
  expect(schemaProps.queries).toBeDefined();
});

test("saVmDynamicToolSpec gates jev actions on policy flags with matching params", () => {
  const readSpec = (policy?: never) => {
    const spec = saVmDynamicToolSpec(policy);
    const schema = spec.inputSchema as {
      properties: {
        action: { type: string; enum: string[] };
      } & Record<string, { type: string; description?: string }>;
    };
    return schema.properties;
  };

  const off = readSpec({ tools: {} } as never);
  expect(off.action.enum).not.toContain("jev_choose");
  expect(off.action.enum).not.toContain("jev_thinking");
  expect(off.action.enum).not.toContain("jev_redteam");
  expect(off.action.enum).not.toContain("jev_done");
  expect(off.action.enum).not.toContain("jev_diagnose");
  expect(off.action.enum).not.toContain("jev_edge_cases");
  expect(off.action.enum).not.toContain("jev_blast_radius");

  const on = readSpec({ tools: { jevChoose: true, jevChecklist: true, jevEvaluate: true, jevThinking: true, jevRedteam: true, jevRank: true, jevScope: true, jevDispatch: true, jevConsistency: true, jevDone: true, jevDiagnose: true, jevEdgeCases: true, jevBlastRadius: true } } as never);
  expect(on.action.enum).toContain("jev_choose");
  expect(on.action.enum).toContain("jev_checklist");
  expect(on.action.enum).toContain("jev_evaluate");
  expect(on.action.enum).toContain("jev_thinking");
  expect(on.action.enum).toContain("jev_redteam");
  expect(on.action.enum).toContain("jev_rank");
  expect(on.action.enum).toContain("jev_scope");
  expect(on.action.enum).toContain("jev_dispatch");
  expect(on.action.enum).toContain("jev_consistency");
  expect(on.action.enum).toContain("jev_done");
  expect(on.action.enum).toContain("jev_diagnose");
  expect(on.action.enum).toContain("jev_edge_cases");
  expect(on.action.enum).toContain("jev_blast_radius");
  for (const key of ["question", "options", "checks", "questions", "goal", "thoughts", "target", "context", "items", "criterion", "task", "phases", "plan", "constraints", "user_request", "actual_work", "evidence", "error_summary", "hypotheses", "proposed_fix", "code", "diff", "target_component"]) {
    expect(on[key]).toBeDefined();
  }
});

test("saVmDynamicToolSpec exposes code_graph trio by default and honors explicit opt-out", () => {
  const readEnum = (policy?: never) => {
    const spec = saVmDynamicToolSpec(policy);
    return (spec.inputSchema as { properties: { action: { type: string; enum: string[] } } }).properties.action.enum;
  };
  // Default (undefined) and empty-tools policies must expose the trio (default-open, regression guard for === true gate)
  for (const e of [readEnum(), readEnum({ tools: {} } as never)]) {
    expect(e).toContain("code_graph");
    expect(e).toContain("relation_graph");
    expect(e).toContain("symbol_graph");
    expect(e).toContain("read_many");
    expect(e).toContain("git_status");
    expect(e).toContain("git_diff");
  }
  // Explicit opt-out hides the trio
  const off = readEnum({ tools: { codeGraph: false } } as never);
  expect(off).not.toContain("code_graph");
  expect(off).not.toContain("relation_graph");
  expect(off).not.toContain("symbol_graph");
  // Gated companions appear with their flags
  const gated = readEnum({ tools: { fileOutline: true, getDiagnostics: true } } as never);
  expect(gated).toContain("workspace_outline");
  expect(gated).toContain("repo_map");
  expect(gated).toContain("verify_loop");
  expect(gated).toContain("verify_changed");
  // code_graph schema params are declared
  const props = (saVmDynamicToolSpec().inputSchema as { properties: Record<string, { type: string }> }).properties;
  for (const key of ["mode", "depth", "direction", "format", "output_file", "candidate_files"]) {
    expect(props[key]).toBeDefined();
  }
});

