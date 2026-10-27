import "../../apps/server/src/pluginHostServices.js"; // register PluginHostServices for the code under test
import { expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  MiniBridge,
  isMiniSaVmToolName,
  miniToolArgValidationError,
  MINI_TOOLS,
  MINI_JEV_DONE_STEER_NOTE,
  type MiniSnapshot,
} from "../../backends/mini/src/runtime/miniBridge.js";
import { setSharedJevConfig } from "../../backends/jev/src/jev/saVmJev.js";

type ScriptedMessage = {
  content?: string | null;
  tool_calls?: Array<{ id: string; type: "function"; function: { name: string; arguments: string } }>;
};

function toolReply(name: string, args: Record<string, unknown>, content: string | null = null): ScriptedMessage {
  return {
    content,
    tool_calls: [{
      id: `call_${Math.random().toString(36).slice(2, 8)}`,
      type: "function",
      function: { name, arguments: JSON.stringify(args) },
    }],
  };
}

test("isMiniSaVmToolName recognizes canonical, aliases, and JEV actions", () => {
  expect(isMiniSaVmToolName("sa_vm")).toBe(true);
  expect(isMiniSaVmToolName("sa_vm_run")).toBe(true);
  expect(isMiniSaVmToolName("jev_done")).toBe(true);
  expect(isMiniSaVmToolName("jev_choose")).toBe(true);
  expect(isMiniSaVmToolName("jev_checklist")).toBe(true);
  expect(isMiniSaVmToolName("jev_diagnose")).toBe(true);
  expect(isMiniSaVmToolName("mcp__sa_vm__write_file")).toBe(true);
  expect(isMiniSaVmToolName("mcp__sa-vm__jev_done")).toBe(true);
  expect(isMiniSaVmToolName("unknown_tool")).toBe(false);
  expect(isMiniSaVmToolName("exec_command")).toBe(false);
});

test("miniToolArgValidationError validates jev_done requirements", () => {
  // Missing user_request
  const errNoReq = miniToolArgValidationError("sa_vm", { action: "jev_done", actual_work: "fixed bug" });
  expect(errNoReq).toContain("needs");
  expect(errNoReq).toContain("user_request");

  // Missing actual_work
  const errNoWork = miniToolArgValidationError("sa_vm", { action: "jev_done", user_request: "fix bug" });
  expect(errNoWork).toContain("needs");
  expect(errNoWork).toContain("actual_work");

  // Success via sa_vm
  const okSaVm = miniToolArgValidationError("sa_vm", {
    action: "jev_done",
    user_request: "fix the bug",
    actual_work: "modified file",
    evidence: "tests pass",
  });
  expect(okSaVm).toBeNull();

  // Top-level jev_done call
  const okDirect = miniToolArgValidationError("jev_done", {
    user_request: "fix the bug",
    actual_work: "modified file",
    evidence: "tests pass",
  });
  expect(okDirect).toBeNull();

  // Top-level sa_vm_run without explicit action inferred from fields
  const okInferred = miniToolArgValidationError("sa_vm_run", {
    user_request: "fix the bug",
    actual_work: "modified file",
  });
  expect(okInferred).toBeNull();
});

test("MINI_TOOLS schema advertises jev_done and JEV decision fields", () => {
  const saVmTool = MINI_TOOLS.find((t) => t.name === "sa_vm");
  expect(saVmTool).toBeDefined();
  const desc = saVmTool?.description ?? "";
  expect(desc).toContain("jev_done");
  expect(desc).toContain("user_request");
  expect(desc).toContain("actual_work");
  expect(desc).toContain("evidence");

  const props = (saVmTool?.schema as any)?.properties;
  expect(props?.user_request).toBeDefined();
  expect(props?.actual_work).toBeDefined();
  expect(props?.evidence).toBeDefined();
  expect(props?.question).toBeDefined();
});

test("mini execution loop: steers jev_done on file write completion and succeeds on JEV call", async () => {
  setSharedJevConfig({
    apiKey: "dummy-key-for-test",
    model: "dummy-jev-model",
  });

  const cwd = mkdtempSync(join(tmpdir(), "mini-jev-completion-"));
  await Bun.write(join(cwd, "test.txt"), "hello world\n");

  let script: (round: number) => ScriptedMessage = () => ({ content: "All done" });
  const requests: Record<string, unknown>[] = [];
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    async fetch(request) {
      requests.push(await request.json() as Record<string, unknown>);
      const message = script(requests.length);
      return Response.json({
        choices: [{ message, finish_reason: message.tool_calls ? "tool_calls" : "stop" }],
      });
    },
  });

  let snapshot: MiniSnapshot | undefined;
  const bridge = new MiniBridge({
    resolveRelayTarget: async () => ({
      baseUrl: `http://127.0.0.1:${server.port}/v1`,
      apiKey: "fixture",
      protocol: "chat",
      contextWindow: 100_000,
      streamMaxRetries: 0,
    }),
    onSnapshot: (value) => { snapshot = value; },
  });

  const started = await bridge.request("thread/start", {
    cwd,
    providerId: "fixture",
    model: "fixture-model",
    sandbox: "danger-full-access",
    approvalPolicy: "never",
  }) as { thread: { id: string } };

  const threadId = started.thread.id;

  // Round 1: Model performs write_file.
  // Round 2: Model attempts to conclude with text without running jev_done.
  // Round 3: Harness steers with JEV delivery sign-off note; Model calls jev_done (using sa_vm_run or sa_vm).
  // Round 4: Model concludes with final answer.
  script = (round) => {
    if (round === 1) {
      return toolReply("sa_vm", { action: "write_file", path: "test.txt", content: "updated content\n" });
    }
    if (round === 2) {
      return { content: "I have updated the file test.txt." };
    }
    if (round === 3) {
      // Check that harness steered with JEV delivery sign-off note
      return toolReply("sa_vm_run", {
        action: "jev_done",
        user_request: "update test.txt and run jev_done",
        actual_work: "wrote updated content to test.txt",
        evidence: "file updated",
      });
    }
    return { content: "All done" };
  };

  const turnCompleted = new Promise<{ method: string; params: Record<string, unknown> }>((resolve, reject) => {
    const timer = setTimeout(() => {
      bridge.off("notification", handler);
      reject(new Error("Mini fixture turn timed out"));
    }, 15_000);
    const handler = (notification: { method: string; params: Record<string, unknown> }) => {
      if (!["turn/completed", "turn/failed"].includes(notification.method)) return;
      clearTimeout(timer);
      bridge.off("notification", handler);
      resolve(notification);
    };
    bridge.on("notification", handler);
    void bridge.request("turn/start", {
      threadId,
      prompt: "update test.txt and run jev_done",
    }).catch((error) => {
      clearTimeout(timer);
      bridge.off("notification", handler);
      reject(error);
    });
  });

  const result = await turnCompleted;
  expect(result.method).toBe("turn/completed");
  expect(await Bun.file(join(cwd, "test.txt")).text()).toBe("updated content\n");

  // Verify that the steer occurred (4 requests total instead of stopping at 2)
  expect(requests.length).toBe(4);

  // Verify that round 3 received the JEV delivery steer directive
  const req3 = requests[2] as { messages: Array<{ role: string; content: string }> };
  const userMessages = req3.messages.filter((m) => m.role === "user");
  const lastUserMsg = userMessages[userMessages.length - 1]?.content ?? "";
  expect(lastUserMsg).toContain("[JEV Delivery Sign-Off Required]");

  server.stop();
});

test("jev_next momentum hint is injected only when the skill is visible and the task is real work", async () => {
  async function firstTurnTexts(policyTools?: Record<string, boolean>): Promise<{ system: string; live: string }> {
    const cwd = mkdtempSync(join(tmpdir(), "mini-jev-next-"));
    const requests: Record<string, unknown>[] = [];
    const server = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      async fetch(request) {
        requests.push(await request.json() as Record<string, unknown>);
        return Response.json({
          choices: [{ message: { content: "done" }, finish_reason: "stop" }],
        });
      },
    });
    const bridge = new MiniBridge({
      resolveRelayTarget: async () => ({
        baseUrl: `http://127.0.0.1:${server.port}/v1`,
        apiKey: "fixture",
        protocol: "chat",
        contextWindow: 100_000,
        streamMaxRetries: 0,
      }),
      resolveThreadPolicy: () => (policyTools ? { tools: policyTools } : undefined),
    });
    try {
      const started = await bridge.request("thread/start", {
        cwd,
        providerId: "fixture",
        model: "fixture-model",
        sandbox: "danger-full-access",
        approvalPolicy: "never",
      }) as { thread: { id: string } };
      const done = new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error("turn timeout")), 15_000);
        const handler = (n: { method: string }) => {
          if (n.method !== "turn/completed" && n.method !== "turn/failed") return;
          clearTimeout(timer); bridge.off("notification", handler); resolve();
        };
        bridge.on("notification", handler);
        void bridge.request("turn/start", {
          threadId: started.thread.id,
          prompt: "add a retry counter to test.txt and verify the file",
        }).catch(reject);
      });
      await done;
      const first = requests[0] as { messages: Array<{ role: string; content: unknown }> };
      const system = first.messages.find((m) => m.role === "system")?.content ?? "";
      const users = first.messages.filter((m) => m.role === "user");
      const live = users[users.length - 1]?.content ?? "";
      return { system: String(system), live: JSON.stringify(live) };
    } finally {
      bridge.stop(); server.stop(true);
    }
  }

  // Skill on + real work: the momentum hint is present in the live tail
  // (no fabrication: the thread policy really enables jev_next here), and
  // absent from the cached system prefix.
  const withSkill = await firstTurnTexts({ jevNext: true });
  expect(withSkill.live).toContain("jev_next");
  expect(withSkill.live).toContain("Task momentum");
  expect(withSkill.system).not.toContain("Task momentum");
  // Skill off: the momentum hint is absent. (The generic skill catalog may
  // still name jev_next; only the injected instruction is asserted here.)
  const withoutSkill = await firstTurnTexts(undefined);
  expect(withoutSkill.live).not.toContain("Task momentum");
});
