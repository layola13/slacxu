import { expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { findCommandCodeBin } from "../../backends/command-code/src/runtime/commandCodeCommand.js";
import {
  COMMAND_CODE_RELAY_KEY_ENV,
  commandCodeMcpPath,
  commandCodeProvidersPath,
  ensureCommandCodeMcpFile,
  writeCommandCodeRelayProvider,
} from "../../backends/command-code/src/runtime/commandCodeProviders.js";
import { CommandCodeAgentBridge } from "../../backends/command-code/src/runtime/commandCodeAgentBridge.js";

function tempHome(): string {
  return mkdtempSync(join(tmpdir(), "command-code-test-"));
}

test("writeCommandCodeRelayProvider writes the BYOK format the CLI parses", () => {
  const home = tempHome();
  writeCommandCodeRelayProvider(home, "cxu-relay", {
    baseUrl: "http://127.0.0.1:9999/api/relay-gateway/p1/g1/v1",
    model: "fake-model",
  });
  const parsed = JSON.parse(readFileSync(commandCodeProvidersPath(home), "utf8"));
  const entry = parsed.provider["cxu-relay"];
  expect(entry.api).toBe("openai-completions");
  expect(entry.baseURL).toContain("/api/relay-gateway/p1/g1/v1");
  // Raw secrets are rejected by the CLI's own config parser; the key must
  // be an env reference the bridge satisfies at spawn time.
  expect(entry.apiKey).toBe(`$${COMMAND_CODE_RELAY_KEY_ENV}`);
  expect(Object.keys(entry.models)).toEqual(["fake-model"]);
});

test("writeCommandCodeRelayProvider preserves other providers on rewrite", () => {
  const home = tempHome();
  writeCommandCodeRelayProvider(home, "cxu-relay", { baseUrl: "http://a/v1", model: "m1" });
  const path = commandCodeProvidersPath(home);
  const withOwn = JSON.parse(readFileSync(path, "utf8"));
  withOwn.provider.mine = { api: "openai-completions", baseURL: "http://mine/v1", models: { x: {} } };
  writeFileSync(path, JSON.stringify(withOwn, null, 2));
  writeCommandCodeRelayProvider(home, "cxu-relay", { baseUrl: "http://b/v1", model: "m2" });
  const parsed = JSON.parse(readFileSync(path, "utf8"));
  expect(parsed.provider.mine.baseURL).toBe("http://mine/v1");
  expect(parsed.provider["cxu-relay"].baseURL).toBe("http://b/v1");
  expect(Object.keys(parsed.provider["cxu-relay"].models)).toEqual(["m2"]);
});

test("ensureCommandCodeMcpFile seeds {mcpServers:{}} once", () => {
  const home = tempHome();
  const path = ensureCommandCodeMcpFile(home);
  expect(path).toBe(commandCodeMcpPath(home));
  expect(JSON.parse(readFileSync(path, "utf8"))).toEqual({ mcpServers: {} });
  writeFileSync(path, JSON.stringify({ mcpServers: { "sa-vm": { command: "node" } } }));
  ensureCommandCodeMcpFile(home);
  expect(JSON.parse(readFileSync(path, "utf8")).mcpServers["sa-vm"].command).toBe("node");
});

test("findCommandCodeBin resolves env override and PATH", () => {
  const dir = tempHome();
  const fakeBin = join(dir, "command-code");
  writeFileSync(fakeBin, "#!/bin/sh\n echo 1.88.0\n");
  expect(findCommandCodeBin({ COMMAND_CODE_BIN: fakeBin, PATH: "" })).toBe(fakeBin);
  expect(findCommandCodeBin({ PATH: dir })).toBe(fakeBin);
  expect(findCommandCodeBin({ PATH: "/nonexistent-dir-for-command-code-test" })).toBeUndefined();
});

test("bridge restores history from the CLI transcript + mapping store", async () => {
  const home = tempHome();
  const sessionId = "11111111-2222-3333-4444-555555555555";
  const threadId = "thread-abc";
  const projectDir = join(home, ".commandcode", "projects", "tmp");
  mkdirSync(projectDir, { recursive: true });
  writeFileSync(join(projectDir, `${sessionId}.jsonl`), [
    JSON.stringify({ type: "session", version: 3, id: sessionId, timestamp: "2026-10-24T00:00:00.000Z", cwd: "/tmp" }),
    JSON.stringify({ type: "message", id: "m1", message: { role: "user", content: [{ type: "text", text: "hello there" }] } }),
    JSON.stringify({ type: "message", id: "m2", message: { role: "assistant", content: [{ type: "text", text: "general kenobi" }] } }),
    "",
  ].join("\n"));
  writeFileSync(join(home, ".commandcode", "cxu-threads.json"), JSON.stringify({
    [threadId]: { sessionId, cwd: "/tmp", model: "fake-model", providerId: "cxu-relay", createdAt: 1792806405000 },
  }));

  const bridge = new CommandCodeAgentBridge(home);
  const items = await bridge.request("thread/items/list", { threadId }) as { items: Array<Record<string, unknown>> };
  expect(items.items).toHaveLength(2);
  expect(items.items[0]?.type).toBe("userMessage");
  expect(items.items[1]?.type).toBe("agentMessage");
  expect(items.items[1]?.content).toBe("general kenobi");
  const turns = await bridge.request("thread/turns/list", { threadId }) as { turns: Array<Record<string, unknown>> };
  expect(turns.turns).toHaveLength(1);
  const list = await bridge.request("thread/list", {}) as { data: Array<Record<string, unknown>> };
  expect(list.data.map((entry) => entry.id)).toContain(threadId);
  bridge.stop();
});

test("bridge restores tool cards from transcript tool blocks", async () => {
  const home = tempHome();
  const sessionId = "22222222-3333-4444-5555-666666666666";
  const threadId = "thread-tools";
  const projectDir = join(home, ".commandcode", "projects", "tmp");
  mkdirSync(projectDir, { recursive: true });
  writeFileSync(join(projectDir, `${sessionId}.jsonl`), [
    JSON.stringify({ type: "session", version: 3, id: sessionId, timestamp: "2026-10-24T00:00:00.000Z", cwd: "/tmp" }),
    JSON.stringify({ type: "message", id: "m1", message: { role: "user", content: [{ type: "text", text: "edit the file" }] } }),
    JSON.stringify({
      type: "message",
      id: "m2",
      message: {
        role: "assistant",
        content: [
          { type: "tool_use", id: "tool-1", name: "edit", input: { path: "src/a.ts" } },
          { type: "tool_result", tool_use_id: "tool-1", content: "edited ok" },
        ],
      },
    }),
    "",
  ].join("\n"));
  writeFileSync(join(home, ".commandcode", "cxu-threads.json"), JSON.stringify({
    [threadId]: { sessionId, cwd: "/tmp", model: "fake-model", providerId: "cxu-relay", createdAt: 1792806405000 },
  }));

  const bridge = new CommandCodeAgentBridge(home);
  const items = await bridge.request("thread/items/list", { threadId }) as { items: Array<Record<string, unknown>> };
  const tool = items.items.find((entry) => entry.type === "toolCall");
  expect(tool).toBeDefined();
  expect(tool?.toolName).toBe("edit");
  expect(tool?.arguments).toEqual({ path: "src/a.ts" });
  expect(tool?.status).toBe("completed");
  bridge.stop();
});

test("bridge projects Task transcript blocks as collabAgentToolCall", async () => {
  const home = tempHome();
  const sessionId = "33333333-4444-5555-6666-777777777777";
  const threadId = "thread-task";
  const projectDir = join(home, ".commandcode", "projects", "tmp");
  mkdirSync(projectDir, { recursive: true });
  writeFileSync(join(projectDir, `${sessionId}.jsonl`), [
    JSON.stringify({ type: "session", version: 3, id: sessionId, timestamp: "2026-10-24T00:00:00.000Z", cwd: "/tmp" }),
    JSON.stringify({ type: "message", id: "m1", message: { role: "user", content: [{ type: "text", text: "explore" }] } }),
    JSON.stringify({
      type: "message",
      id: "m2",
      message: {
        role: "assistant",
        content: [{ type: "tool_use", id: "task-9", name: "Task", input: { description: "explore repo" } }],
      },
    }),
    "",
  ].join("\n"));
  writeFileSync(join(home, ".commandcode", "cxu-threads.json"), JSON.stringify({
    [threadId]: { sessionId, cwd: "/tmp", model: "fake-model", providerId: "cxu-relay", createdAt: 1792806405000 },
  }));

  const bridge = new CommandCodeAgentBridge(home);
  const items = await bridge.request("thread/items/list", { threadId }) as { items: Array<Record<string, unknown>> };
  const task = items.items.find((entry) => entry.id === "task-9");
  expect(task?.type).toBe("collabAgentToolCall");
  expect(task?.tool).toBe("task");
  expect(task?.prompt).toBe("explore repo");
  bridge.stop();
});
