import { expect, test } from "bun:test";
import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { join } from "node:path";

test("sa-vm-mcp server handles JSON-RPC 2.0 stdio protocol", async () => {
  const scriptPath = join(process.cwd(), "scripts", "sa-vm-mcp.mjs");
  const proc = spawn("node", [scriptPath], {
    stdio: ["pipe", "pipe", "inherit"],
    env: { ...process.env, CODEX_UI_API_URL: "http://127.0.0.1:9999" }
  });

  const responses: any[] = [];
  const rl = createInterface({ input: proc.stdout });

  rl.on("line", (line) => {
    try {
      responses.push(JSON.parse(line));
    } catch {}
  });

  const send = (msg: any) => {
    proc.stdin.write(JSON.stringify(msg) + "\n");
  };

  // 1. initialize
  send({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2024-11-05" } });
  // 2. ping
  send({ jsonrpc: "2.0", id: 2, method: "ping", params: {} });
  // 3. tools/list
  send({ jsonrpc: "2.0", id: 3, method: "tools/list", params: {} });
  // 4. unknown method
  send({ jsonrpc: "2.0", id: 4, method: "unknown/method", params: {} });

  // Wait a bit for responses
  await new Promise((resolve) => setTimeout(resolve, 500));

  proc.kill();

  expect(responses.length).toBeGreaterThanOrEqual(4);

  const initRes = responses.find((r) => r.id === 1);
  expect(initRes).toBeDefined();
  expect(initRes.result.serverInfo.name).toBe("sa-vm");
  expect(initRes.result.capabilities.tools).toBeDefined();

  const pingRes = responses.find((r) => r.id === 2);
  expect(pingRes).toBeDefined();
  expect(pingRes.result).toEqual({});

  const listRes = responses.find((r) => r.id === 3);
  expect(listRes).toBeDefined();
  expect(Array.isArray(listRes.result.tools)).toBe(true);
  const saVmTool = listRes.result.tools.find((t: any) => t.name === "sa_vm_run");
  expect(saVmTool).toBeDefined();
  expect(saVmTool.inputSchema.properties.action).toBeDefined();
  const actionsEnum = saVmTool.inputSchema.properties.action.enum;
  expect(actionsEnum).toContain("ensure_dir");
  expect(actionsEnum).toContain("mkdir");
  expect(actionsEnum).toContain("exists");
  expect(actionsEnum).toContain("stat");
  expect(actionsEnum).toContain("vm-read");
  expect(actionsEnum).toContain("vm_read");
  expect(actionsEnum).toContain("jev_choose");
  expect(actionsEnum).toContain("jev_checklist");
  expect(actionsEnum).toContain("jev_evaluate");
  expect(actionsEnum).toContain("jev_thinking");
  expect(actionsEnum).toContain("jev_redteam");
  expect(actionsEnum).toContain("jev_rank");
  expect(actionsEnum).toContain("jev_scope");
  expect(actionsEnum).toContain("jev_dispatch");
  expect(actionsEnum).toContain("jev_consistency");
  expect(actionsEnum).toContain("jev_done");
  expect(actionsEnum).toContain("jev_diagnose");
  expect(actionsEnum).toContain("jev_edge_cases");
  expect(actionsEnum).toContain("jev_blast_radius");
  expect(saVmTool.inputSchema.properties.question).toBeDefined();
  expect(saVmTool.inputSchema.properties.options).toBeDefined();
  expect(saVmTool.inputSchema.properties.checks).toBeDefined();
  expect(saVmTool.inputSchema.properties.goal).toBeDefined();
  expect(saVmTool.inputSchema.properties.thoughts).toBeDefined();
  expect(saVmTool.inputSchema.properties.context).toBeDefined();
  expect(saVmTool.inputSchema.properties.task).toBeDefined();
  expect(saVmTool.inputSchema.properties.code).toBeDefined();
  expect(saVmTool.inputSchema.properties.diff).toBeDefined();
  expect(saVmTool.inputSchema.properties.type).toBeDefined();
  expect(saVmTool.inputSchema.properties.type.enum).toEqual(["all", "file", "directory"]);
  expect(saVmTool.inputSchema.properties.max_file_bytes).toBeDefined();
  expect(saVmTool.inputSchema.properties.max_results).toBeDefined();
  expect(saVmTool.inputSchema.properties.page).toBeDefined();
  expect(saVmTool.inputSchema.properties.page_size).toBeDefined();
  expect(saVmTool.inputSchema.properties.count_cap).toBeDefined();

  const errRes = responses.find((r) => r.id === 4);
  expect(errRes).toBeDefined();
  expect(errRes.error.code).toBe(-32601);
});

test("sa-vm-mcp server forwards grep pagination arguments to mock HTTP endpoint", async () => {
  let receivedBody: any = null;
  const mockServer = Bun.serve({
    port: 0,
    fetch(req) {
      if (req.url.endsWith("/api/tools/sa_vm_run")) {
        return req.json().then((body) => {
          receivedBody = body;
          return Response.json({
            data: {
              ok: true,
              stdout: "Mock SA-VM file output",
              stderr: ""
            }
          });
        });
      }
      return new Response("Not found", { status: 404 });
    }
  });

  const scriptPath = join(process.cwd(), "scripts", "sa-vm-mcp.mjs");
  const proc = spawn("node", [scriptPath], {
    stdio: ["pipe", "pipe", "inherit"],
    env: { ...process.env, CODEX_UI_API_URL: `http://127.0.0.1:${mockServer.port}`, MUSE_SA_VM_ENVELOPE: "" }
  });

  const responses: any[] = [];
  const rl = createInterface({ input: proc.stdout });
  rl.on("line", (line) => {
    try {
      responses.push(JSON.parse(line));
    } catch {}
  });

  const send = (msg: any) => {
    proc.stdin.write(JSON.stringify(msg) + "\n");
  };

  send({
    jsonrpc: "2.0",
    id: 10,
    method: "tools/call",
    params: {
      name: "sa_vm_run",
      arguments: {
        action: "grep_search_async",
        query: "useCallback",
        dir: "apps/web/src/App.tsx",
        max_file_bytes: 5242880,
        page: 2,
        page_size: 5,
        max_results: 5
      }
    }
  });

  await new Promise((resolve) => setTimeout(resolve, 800));
  proc.kill();
  mockServer.stop();

  const callRes = responses.find((r) => r.id === 10);
  expect(callRes).toBeDefined();
  expect(callRes.result.isError).toBe(false);
  expect(callRes.result.content[0].text).toBe("Mock SA-VM file output");
  expect(receivedBody).toEqual({
    action: "grep_search_async",
    query: "useCallback",
    dir: "apps/web/src/App.tsx",
    max_file_bytes: 5242880,
    page: 2,
    page_size: 5,
    max_results: 5,
    cwd: process.cwd()
  });
});

test("sa-vm-mcp server forwards jev_* arguments verbatim", async () => {
  let receivedBody: any = null;
  const mockServer = Bun.serve({
    port: 0,
    fetch(req) {
      if (req.url.endsWith("/api/tools/sa_vm_run")) {
        return req.json().then((body) => {
          receivedBody = body;
          return Response.json({
            data: {
              ok: true,
              stdout: "Mock JEV output",
              stderr: ""
            }
          });
        });
      }
      return new Response("Not found", { status: 404 });
    }
  });

  const scriptPath = join(process.cwd(), "scripts", "sa-vm-mcp.mjs");
  const proc = spawn("node", [scriptPath], {
    stdio: ["pipe", "pipe", "inherit"],
    env: { ...process.env, CODEX_UI_API_URL: `http://127.0.0.1:${mockServer.port}`, MUSE_SA_VM_ENVELOPE: "" }
  });

  const responses: any[] = [];
  const rl = createInterface({ input: proc.stdout });
  rl.on("line", (line) => {
    try {
      responses.push(JSON.parse(line));
    } catch {}
  });

  const send = (msg: any) => {
    proc.stdin.write(JSON.stringify(msg) + "\n");
  };

  send({
    jsonrpc: "2.0",
    id: 20,
    method: "tools/call",
    params: {
      name: "sa_vm_run",
      arguments: {
        action: "jev_choose",
        question: "Which runtime should the TS rewrite target?",
        options: { bun: "Bun-native Hono server", node: "Node+Express server" },
        context: "duck2api Go proxy needs TS rewrite"
      }
    }
  });

  await new Promise((resolve) => setTimeout(resolve, 800));
  proc.kill();
  mockServer.stop();

  const callRes = responses.find((r) => r.id === 20);
  expect(callRes).toBeDefined();
  expect(callRes.result.isError).toBe(false);
  expect(receivedBody).toBeDefined();
  expect(receivedBody.action).toBe("jev_choose");
  expect(receivedBody.question).toBe("Which runtime should the TS rewrite target?");
  expect(receivedBody.options).toEqual({ bun: "Bun-native Hono server", node: "Node+Express server" });
  expect(receivedBody.context).toBe("duck2api Go proxy needs TS rewrite");
});

test("sa-vm-mcp server forwards jev canonical params verbatim (goal/thoughts/diff)", async () => {
  const received: any[] = [];
  const mockServer = Bun.serve({
    port: 0,
    fetch(req) {
      if (req.url.endsWith("/api/tools/sa_vm_run")) {
        return req.json().then((body) => {
          received.push(body);
          return Response.json({
            data: {
              ok: true,
              stdout: "Mock JEV output",
              stderr: ""
            }
          });
        });
      }
      return new Response("Not found", { status: 404 });
    }
  });

  const scriptPath = join(process.cwd(), "scripts", "sa-vm-mcp.mjs");
  const proc = spawn("node", [scriptPath], {
    stdio: ["pipe", "pipe", "inherit"],
    env: { ...process.env, CODEX_UI_API_URL: `http://127.0.0.1:${mockServer.port}`, MUSE_SA_VM_ENVELOPE: "" }
  });

  const responses: any[] = [];
  const rl = createInterface({ input: proc.stdout });
  rl.on("line", (line) => {
    try {
      responses.push(JSON.parse(line));
    } catch {}
  });

  const send = (msg: any) => {
    proc.stdin.write(JSON.stringify(msg) + "\n");
  };

  send({
    jsonrpc: "2.0",
    id: 30,
    method: "tools/call",
    params: {
      name: "sa_vm_run",
      arguments: {
        action: "jev_thinking",
        goal: "Evaluate duck2api integration and TS rewrite strategy",
        thoughts: { t1: "Keep Go sidecar", t2: "Full TS rewrite", t3: "TS relay provider" },
        context: "dispatch regression"
      }
    }
  });
  send({
    jsonrpc: "2.0",
    id: 31,
    method: "tools/call",
    params: {
      name: "sa_vm_run",
      arguments: {
        action: "jev_blast_radius",
        diff: "Add duck.ai relay provider + remove Go sidecar",
        target_component: "relay registry",
        context: "dispatch regression"
      }
    }
  });
  send({
    jsonrpc: "2.0",
    id: 32,
    method: "tools/call",
    params: {
      name: "sa_vm_run",
      arguments: {
        action: "jev_diagnose",
        error_summary: "Duck.ai returns 418 repeatedly",
        hypotheses: { h1: "VQD hash stale", h2: "FE version expired" },
        proposed_fix: "Reset VQD token on 418",
        context: "dispatch regression"
      }
    }
  });

  await new Promise((resolve) => setTimeout(resolve, 1200));
  proc.kill();
  mockServer.stop();

  for (const id of [30, 31, 32]) {
    const callRes = responses.find((r) => r.id === id);
    expect(callRes).toBeDefined();
    expect(callRes.result.isError).toBe(false);
  }
  expect(received.length).toBe(3);

  const thinking = received.find((b) => b.action === "jev_thinking");
  expect(thinking.goal).toBe("Evaluate duck2api integration and TS rewrite strategy");
  expect(thinking.thoughts).toEqual({ t1: "Keep Go sidecar", t2: "Full TS rewrite", t3: "TS relay provider" });
  expect(thinking.context).toBe("dispatch regression");

  const blast = received.find((b) => b.action === "jev_blast_radius");
  expect(blast.diff).toBe("Add duck.ai relay provider + remove Go sidecar");
  expect(blast.target_component).toBe("relay registry");

  const diagnose = received.find((b) => b.action === "jev_diagnose");
  expect(diagnose.error_summary).toBe("Duck.ai returns 418 repeatedly");
  expect(diagnose.hypotheses).toEqual({ h1: "VQD hash stale", h2: "FE version expired" });
  expect(diagnose.proposed_fix).toBe("Reset VQD token on 418");
});
